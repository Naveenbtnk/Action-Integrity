import 'server-only';

import { metrics } from '@opentelemetry/api';

import { Prisma, type ActionExecution } from '@/generated/prisma/client';
import {
  ActorType,
  BreakGlassStatus,
  CaseStatus,
  DegradationLevel,
  Disposition,
  ExecutionKind,
  OutboundActionStatus,
  Role,
} from '@/generated/prisma/enums';
import type { TargetAdapter } from '@/lib/adapters/types';
import { assertSeparationOfDuties, requireQuorum } from '@/lib/approval';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import {
  ConflictError,
  DegradationBlockedError,
  NotFoundError,
  QuorumNotMetError,
} from '@/lib/errors';
import { withSpan } from '@/lib/observability/tracing';
import { enqueue } from '@/lib/outbox/enqueue';
import { requirePermission } from '@/lib/rbac';
import { transitionCase } from '@/lib/state-machine/case';

import { objectRef, targetChange, targetRef } from './action';
import { compensationEligibility } from './compensation-eligibility';
import { captureRestorePoint, persistRestorePoint } from './restore-point';
import { createTargetClient } from './target-client';

type Actor = { id: string; roles: Role[]; requestId: string; traceId?: string };
type Kind = ExecutionKind | 'BLOCK';
type ExecutionOutput =
  | { execution: ActionExecution; noTargetWrite: false; caseStatus: CaseStatus }
  | { execution: null; noTargetWrite: true; caseStatus: CaseStatus };

const meter = metrics.getMeter('aic-web');
const executions = meter.createCounter('aic_executions_total');
const duration = meter.createHistogram('aic_execution_duration_seconds', { unit: 's' });
const targetRequests = meter.createCounter('aic_target_requests_total');

function transactionActor(actor: Actor) {
  return {
    type: ActorType.USER,
    id: actor.id,
    requestId: actor.requestId,
    ...(actor.traceId ? { traceId: actor.traceId } : {}),
  };
}

async function preconditions(
  tx: Prisma.TransactionClient,
  caseRef: string,
  kind: Kind,
  actor: Actor,
) {
  await tx.$queryRaw`SELECT id FROM "case" WHERE ref = ${caseRef} FOR UPDATE`;
  const caseRow = await tx.case.findUnique({ where: { ref: caseRef } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  if (caseRow.status === CaseStatus.EXECUTING || caseRow.status === CaseStatus.VERIFYING)
    throw new ConflictError('ALREADY_EXECUTING');
  if (caseRow.status !== CaseStatus.APPROVED) throw new ConflictError('INVALID_TRANSITION');
  const degradation = await tx.degradationState.findFirst({ orderBy: { changedAt: 'desc' } });
  if (
    degradation?.level === DegradationLevel.L2_TARGET_DEGRADED ||
    degradation?.level === DegradationLevel.L3_DB_DEGRADED ||
    degradation?.level === DegradationLevel.L4_AUDIT_BROKEN
  )
    throw new DegradationBlockedError({ level: degradation.level });
  const decision = await tx.policyDecision.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!decision) throw new ConflictError('POLICY_UNAVAILABLE');
  const expectedDisposition =
    kind === 'BLOCK'
      ? Disposition.BLOCK
      : kind === ExecutionKind.RELEASE
        ? Disposition.RELEASE_AFTER_CORRECTION
        : Disposition.COMPENSATE;
  if (decision.disposition !== expectedDisposition) throw new ConflictError('APPROVAL_CONFLICT');
  const quorum = await requireQuorum(tx, caseRow.id, decision);
  if (!quorum.met) throw new QuorumNotMetError();
  await assertSeparationOfDuties(tx, caseRow.id, actor.id);
  const breakGlass = await tx.approval.findFirst({
    where: {
      caseId: caseRow.id,
      reopenCount: caseRow.reopenCount,
      status: 'VALID',
      breakGlass: true,
    },
    select: { elevationId: true },
  });
  if (breakGlass) {
    const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
    const now = clock[0]?.now;
    if (!now) throw new Error('Database clock unavailable.');
    const elevation = breakGlass.elevationId
      ? await tx.breakGlassElevation.findUnique({ where: { id: breakGlass.elevationId } })
      : null;
    if (
      !elevation ||
      elevation.status !== BreakGlassStatus.ACTIVE ||
      elevation.expiresAt <= now ||
      elevation.requestedById !== actor.id ||
      !elevation.cosignedById
    )
      throw new ConflictError('BREAK_GLASS_INCOMPLETE');
  }
  const action = await tx.outboundAction.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { requestedAt: 'desc' },
    include: { restorePoint: true },
  });
  if (!action) throw new ConflictError('ACTION_UNAVAILABLE');
  if (
    kind === ExecutionKind.RESTORE_LAST_KNOWN_GOOD &&
    action.status !== OutboundActionStatus.EXECUTED
  )
    throw new ConflictError('ACTION_NOT_EXECUTED');
  if (
    (kind === ExecutionKind.RELEASE || kind === 'BLOCK') &&
    action.status !== OutboundActionStatus.HELD
  )
    throw new ConflictError('ACTION_NOT_HELD');
  return { caseRow, decision, action };
}

export async function executeCase(input: {
  caseRef: string;
  kind: Kind;
  actor: Actor;
  requestKey: string;
  client?: TargetAdapter;
}): Promise<ExecutionOutput> {
  const started = performance.now();
  return withSpan(
    'execution.execute',
    { 'case.ref': input.caseRef, 'execution.kind': input.kind },
    async () => {
      const client = input.client ?? createTargetClient();
      const existingCase = await db.case.findUnique({
        where: { ref: input.caseRef },
        select: { id: true, status: true, reopenCount: true },
      });
      if (!existingCase) throw new NotFoundError('Case not found.');
      if (input.kind !== 'BLOCK') {
        const prior = await db.actionExecution.findFirst({
          where: {
            caseId: existingCase.id,
            reopenCount: existingCase.reopenCount,
            kind: input.kind,
          },
        });
        if (prior) {
          const payload = prior.requestPayload;
          const routeKey =
            payload && typeof payload === 'object' && !Array.isArray(payload)
              ? payload.routeKey
              : null;
          if (routeKey !== input.requestKey) throw new ConflictError('ALREADY_EXECUTING');
          return { execution: prior, noTargetWrite: false, caseStatus: existingCase.status };
        }
      }
      if (input.kind === 'BLOCK') {
        return db.$transaction(async (raw) => {
          const tx = raw as Prisma.TransactionClient;
          const { caseRow, action } = await preconditions(
            tx,
            input.caseRef,
            input.kind,
            input.actor,
          );
          await tx.outboundAction.update({
            where: { id: action.id },
            data: { status: OutboundActionStatus.BLOCKED },
          });
          await tx.actionHold.updateMany({
            where: { outboundActionId: action.id, releasedAt: null },
            data: { releasedAt: new Date(), releasedById: input.actor.id },
          });
          await appendAuditEvent(tx, {
            eventType: 'ACTION_BLOCKED',
            actorType: ActorType.USER,
            actorId: input.actor.id,
            caseId: caseRow.id,
            payload: { actionRef: action.ref },
            requestId: input.actor.requestId,
            traceId: input.actor.traceId,
          });
          await transitionCase(tx, caseRow.id, CaseStatus.VERIFYING, transactionActor(input.actor));
          await enqueue(tx, {
            eventType: 'CASE_VERIFYING',
            aggregateType: 'Case',
            aggregateId: caseRow.id,
            payload: { caseRef: caseRow.ref, noTargetWrite: true },
            dedupeKey: `case:${caseRow.id}:${caseRow.reopenCount}:block`,
          });
          return { execution: null, noTargetWrite: true, caseStatus: CaseStatus.VERIFYING };
        });
      }

      const snapshot = await db.$transaction(async (raw) => {
        const tx = raw as Prisma.TransactionClient;
        const checked = await preconditions(tx, input.caseRef, input.kind, input.actor);
        if (input.kind === ExecutionKind.RESTORE_LAST_KNOWN_GOOD && !checked.action.restorePoint)
          return { refusal: true as const, caseId: checked.caseRow.id };
        return { refusal: false as const, ...checked };
      });
      if (snapshot.refusal) {
        await db.$transaction(async (raw) => {
          const tx = raw as Prisma.TransactionClient;
          await preconditions(tx, input.caseRef, input.kind, input.actor);
          await transitionCase(
            tx,
            snapshot.caseId,
            CaseStatus.SAFE_REFUSAL,
            transactionActor(input.actor),
          );
          await appendAuditEvent(tx, {
            eventType: 'SAFE_REFUSAL',
            actorType: ActorType.USER,
            actorId: input.actor.id,
            caseId: snapshot.caseId,
            payload: { reason: 'NO_RESTORE_POINT' },
            requestId: input.actor.requestId,
            traceId: input.actor.traceId,
          });
        });
        throw new ConflictError('NO_RESTORE_POINT');
      }
      const change = targetChange(snapshot.action);
      const ref = targetRef(change);
      const captured = await captureRestorePoint(client, ref);
      if (input.kind === ExecutionKind.RESTORE_LAST_KNOWN_GOOD) {
        const active = await db.policyVersion.findFirst({
          where: { status: 'ACTIVE' },
          select: { document: true },
        });
        const document = active?.document;
        const irreversibleActionTypes =
          document &&
          typeof document === 'object' &&
          !Array.isArray(document) &&
          'irreversibleActionTypes' in document &&
          Array.isArray(document.irreversibleActionTypes)
            ? document.irreversibleActionTypes.filter(
                (value): value is string => typeof value === 'string',
              )
            : [];
        const eligibility = compensationEligibility({
          action: snapshot.action,
          restorePoint: snapshot.action.restorePoint,
          targetExists: true,
          irreversibleActionTypes,
        });
        if (!eligibility.eligible)
          throw new ConflictError(eligibility.reason ?? 'COMPENSATION_NOT_ELIGIBLE');
      }
      const intent = await db.$transaction(async (raw) => {
        const tx = raw as Prisma.TransactionClient;
        const { caseRow, action } = await preconditions(tx, input.caseRef, input.kind, input.actor);
        const current = await tx.actionExecution.findFirst({
          where: { caseId: caseRow.id, reopenCount: caseRow.reopenCount },
        });
        if (current) throw new ConflictError('ALREADY_EXECUTING');
        let restorePointId = action.restorePointId;
        let preWriteRestorePointId: string;
        if (input.kind === ExecutionKind.RELEASE) {
          const point = await persistRestorePoint(tx, {
            outboundActionId: action.id,
            ref,
            snapshot: captured,
          });
          restorePointId = point.id;
          preWriteRestorePointId = point.id;
          await tx.outboundAction.update({ where: { id: action.id }, data: { restorePointId } });
        } else {
          const point = await persistRestorePoint(tx, { ref, snapshot: captured });
          preWriteRestorePointId = point.id;
        }
        const key =
          input.kind === ExecutionKind.RELEASE
            ? `release:${action.id}`
            : `comp:${caseRow.id}:${caseRow.reopenCount}:${objectRef(ref)}`;
        const execution = await tx.actionExecution.create({
          data: {
            caseId: caseRow.id,
            outboundActionId: action.id,
            reopenCount: caseRow.reopenCount,
            kind: input.kind as ExecutionKind,
            targetObjectType: ref.targetObjectType,
            targetObjectRef: objectRef(ref),
            restorePointId,
            preWriteRestorePointId,
            idempotencyKey: key,
            status: 'PENDING',
            requestPayload: {
              routeKey: input.requestKey,
              change,
              beforeState: captured.state,
              beforeStateHash: captured.stateHash,
            } as Prisma.InputJsonObject,
            startedAt: new Date(),
          },
        });
        await transitionCase(tx, caseRow.id, CaseStatus.EXECUTING, transactionActor(input.actor));
        await appendAuditEvent(tx, {
          eventType: 'EXECUTION_STARTED',
          actorType: ActorType.USER,
          actorId: input.actor.id,
          caseId: caseRow.id,
          payload: { executionId: execution.id, kind: input.kind, targetObjectRef: objectRef(ref) },
          requestId: input.actor.requestId,
          traceId: input.actor.traceId,
        });
        await enqueue(tx, {
          eventType: 'EXECUTION_STARTED',
          aggregateType: 'Case',
          aggregateId: caseRow.id,
          payload: { caseRef: caseRow.ref, executionId: execution.id },
          dedupeKey: `execution:${execution.id}:started`,
        });
        return execution;
      });
      let result;
      try {
        result =
          input.kind === ExecutionKind.RELEASE
            ? await client.applyChange(change, intent.idempotencyKey)
            : await client.restoreFromSnapshot(
                ref,
                snapshot.action.restorePoint?.state,
                intent.idempotencyKey,
              );
      } catch {
        result = {
          status: 'UNKNOWN' as const,
          response: null,
          failureCode: 'TARGET_RESPONSE_LOST',
        };
      }
      targetRequests.add(1, { operation: input.kind, outcome: result.status });
      const execution = await db.$transaction(async (raw) => {
        const tx = raw as Prisma.TransactionClient;
        const updated = await tx.actionExecution.update({
          where: { id: intent.id },
          data: {
            status: result.status,
            responsePayload:
              result.response == null
                ? Prisma.JsonNull
                : (result.response as Prisma.InputJsonValue),
            failureCode: result.failureCode ?? null,
            finishedAt: new Date(),
          },
        });
        await transitionCase(
          tx,
          snapshot.caseRow.id,
          CaseStatus.VERIFYING,
          transactionActor(input.actor),
        );
        await appendAuditEvent(tx, {
          eventType: 'EXECUTION_RESULT',
          actorType: ActorType.USER,
          actorId: input.actor.id,
          caseId: snapshot.caseRow.id,
          payload: {
            executionId: intent.id,
            status: result.status,
            failureCode: result.failureCode ?? null,
          },
          requestId: input.actor.requestId,
          traceId: input.actor.traceId,
        });
        return updated;
      });
      executions.add(1, { kind: input.kind, status: result.status });
      duration.record((performance.now() - started) / 1000, {
        kind: input.kind,
        status: result.status,
      });
      return { execution, noTargetWrite: false, caseStatus: CaseStatus.VERIFYING };
    },
  );
}

export async function executeApprovedCase(input: {
  caseRef: string;
  actor: Actor;
  requestKey: string;
  client?: TargetAdapter;
}): Promise<ExecutionOutput> {
  const caseRow = await db.case.findUnique({ where: { ref: input.caseRef }, select: { id: true } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  const decision = await db.policyDecision.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { createdAt: 'desc' },
    select: { disposition: true, riskScore: true },
  });
  if (!decision) throw new ConflictError('POLICY_UNAVAILABLE');
  if (decision.riskScore >= 70) requirePermission(input.actor, 'case:execute_high');
  const kind =
    decision.disposition === Disposition.BLOCK
      ? 'BLOCK'
      : decision.disposition === Disposition.RELEASE_AFTER_CORRECTION
        ? ExecutionKind.RELEASE
        : decision.disposition === Disposition.COMPENSATE
          ? ExecutionKind.RESTORE_LAST_KNOWN_GOOD
          : null;
  if (!kind) throw new ConflictError('APPROVAL_CONFLICT');
  return executeCase({ ...input, kind });
}
