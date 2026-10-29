import 'server-only';

import { metrics } from '@opentelemetry/api';

import { Prisma } from '@/generated/prisma/client';
import {
  ActorType,
  CaseStatus,
  Disposition,
  ExecutionKind,
  OutboundActionStatus,
} from '@/generated/prisma/enums';
import type { TargetRef } from '@/lib/adapters/types';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { AppError, ConflictError, NotFoundError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';
import { withSpan } from '@/lib/observability/tracing';
import { enqueue } from '@/lib/outbox/enqueue';
import { transitionCase } from '@/lib/state-machine/case';

import { targetChange, targetRef } from '../executor/action';
import { createTargetReader, type TargetReader } from '../executor/target-client';

type Actor = { id: string; requestId: string; traceId?: string };
const meter = metrics.getMeter('aic-web');
const verifications = meter.createCounter('aic_verifications_total');
const unverifiedWrites = meter.createCounter('aic_unverified_write_total');
const duration = meter.createHistogram('aic_verification_duration_seconds', { unit: 's' });
const targetRequests = meter.createCounter('aic_target_requests_total');

function declaredState(
  disposition: Disposition,
  change: ReturnType<typeof targetChange>,
  restoreState: unknown,
): { field: string; value: string } {
  if (disposition === Disposition.COMPENSATE) {
    if (!restoreState || typeof restoreState !== 'object' || Array.isArray(restoreState))
      throw new ConflictError('NO_RESTORE_POINT');
    const expected = restoreState as Record<string, unknown>;
    const field = change.targetObjectType === 'entitlement' ? 'status' : 'state';
    if (typeof expected[field] !== 'string') throw new ConflictError('NO_RESTORE_POINT');
    return { field, value: expected[field] };
  }
  return {
    field: change.targetObjectType === 'entitlement' ? 'status' : 'state',
    value: disposition === Disposition.BLOCK ? (change.from ?? '') : change.to,
  };
}

async function readTarget(client: TargetReader, ref: TargetRef, attempts: number) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const state =
        ref.targetObjectType === 'entitlement'
          ? await client.getEntitlement(ref.accountId, ref.key)
          : await client.getServiceStatus(ref.accountId);
      targetRequests.add(1, { operation: 'read', outcome: 'ok' });
      return { state, attempt };
    } catch {
      targetRequests.add(1, { operation: 'read', outcome: 'error' });
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  return null;
}

export async function verifyCase(input: {
  caseRef: string;
  attempts?: number;
  actor: Actor;
  client?: TargetReader;
}) {
  const started = performance.now();
  const attempts = input.attempts ?? 2;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3)
    throw new AppError('VALIDATION_ERROR', 400, 'Attempts must be between 1 and 3.');
  return withSpan('verification.read', { 'case.ref': input.caseRef }, async () => {
    const caseRow = await db.case.findUnique({
      where: { ref: input.caseRef },
      include: {
        actions: { orderBy: { requestedAt: 'desc' }, take: 1, include: { restorePoint: true } },
        decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
        executions: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });
    if (!caseRow) throw new NotFoundError('Case not found.');
    if (caseRow.status !== CaseStatus.VERIFYING) {
      if (caseRow.status === CaseStatus.CLOSED_RESOLVED && caseRow.executions[0]) {
        const verified = await db.verificationResult.count({
          where: { executionId: caseRow.executions[0].id, passed: true },
        });
        if (!verified) unverifiedWrites.add(1);
      }
      throw new ConflictError('INVALID_TRANSITION');
    }
    const action = caseRow.actions[0];
    const decision = caseRow.decisions[0];
    if (!action || !decision) throw new ConflictError('ACTION_UNAVAILABLE');
    const change = targetChange(action);
    const ref = targetRef(change);
    const expected = declaredState(decision.disposition, change, action.restorePoint?.state);
    const execution = caseRow.executions[0] ?? null;
    if (decision.disposition !== Disposition.BLOCK && !execution)
      throw new ConflictError('EXECUTION_UNAVAILABLE');
    const read = await readTarget(input.client ?? createTargetReader(), ref, attempts);
    if (!read) {
      await db.$transaction(async (raw) => {
        const tx = raw as Prisma.TransactionClient;
        await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${caseRow.id} FOR UPDATE`;
        const current = await tx.case.findUniqueOrThrow({ where: { id: caseRow.id } });
        if (current.status !== CaseStatus.VERIFYING) throw new ConflictError('INVALID_TRANSITION');
        await transitionCase(tx, caseRow.id, CaseStatus.ESCALATED, {
          type: ActorType.USER,
          id: input.actor.id,
          requestId: input.actor.requestId,
          ...(input.actor.traceId ? { traceId: input.actor.traceId } : {}),
        });
        await enqueue(tx, {
          eventType: 'CASE_ESCALATED',
          aggregateType: 'Case',
          aggregateId: caseRow.id,
          payload: { caseRef: caseRow.ref, reason: 'TARGET_UNAVAILABLE' },
          dedupeKey: `case:${caseRow.id}:${caseRow.reopenCount}:target-unavailable`,
        });
      });
      verifications.add(1, { result: 'error', disposition: decision.disposition });
      throw new AppError('TARGET_UNAVAILABLE', 502, 'Target state could not be read.');
    }
    const observed = read.state as Record<string, unknown> | null;
    const observedValue = observed?.[expected.field];
    const passed = observedValue === expected.value;
    const mismatches = passed
      ? []
      : [{ field: expected.field, expected: expected.value, observed: observedValue ?? null }];
    const result = await db.$transaction(async (raw) => {
      const tx = raw as Prisma.TransactionClient;
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${caseRow.id} FOR UPDATE`;
      const current = await tx.case.findUniqueOrThrow({ where: { id: caseRow.id } });
      if (current.status !== CaseStatus.VERIFYING) throw new ConflictError('INVALID_TRANSITION');
      const verification = await tx.verificationResult.create({
        data: {
          caseId: caseRow.id,
          executionId: execution?.id ?? null,
          expectedState: { [expected.field]: expected.value },
          observedState: observed ? (observed as Prisma.InputJsonValue) : Prisma.JsonNull,
          observedStateHash: sha(read.state),
          passed,
          mismatches,
          attemptCount: read.attempt,
          checkedAt: new Date(),
        },
      });
      let updatedExecution = execution;
      if (execution && execution.status !== (passed ? 'SUCCEEDED' : 'FAILED')) {
        updatedExecution = await tx.actionExecution.update({
          where: { id: execution.id },
          data: {
            status: passed ? 'SUCCEEDED' : 'FAILED',
            resolvedByVerification: true,
            resolvedById: input.actor.id,
            resolvedAt: new Date(),
          },
        });
      }
      if (passed && execution) {
        await tx.outboundAction.update({
          where: { id: action.id },
          data: {
            status:
              execution.kind === ExecutionKind.RELEASE
                ? OutboundActionStatus.EXECUTED
                : OutboundActionStatus.COMPENSATED,
          },
        });
        if (execution.kind === ExecutionKind.RELEASE)
          await tx.actionHold.updateMany({
            where: { outboundActionId: action.id, releasedAt: null },
            data: { releasedAt: new Date(), releasedById: input.actor.id },
          });
      }
      if (!passed) {
        const escalation = await tx.escalationEvent.create({
          data: {
            caseId: caseRow.id,
            reason: 'VERIFICATION_MISMATCH',
            ownerTeam: 'operations',
            createdById: input.actor.id,
            createdAt: new Date(),
          },
        });
        await appendAuditEvent(tx, {
          eventType: 'VERIFICATION_FAILED',
          actorType: ActorType.USER,
          actorId: input.actor.id,
          caseId: caseRow.id,
          payload: { verificationId: verification.id, escalationId: escalation.id, mismatches },
          requestId: input.actor.requestId,
          traceId: input.actor.traceId,
        });
      } else {
        await appendAuditEvent(tx, {
          eventType: 'CASE_VERIFIED',
          actorType: ActorType.USER,
          actorId: input.actor.id,
          caseId: caseRow.id,
          payload: { verificationId: verification.id, executionId: execution?.id ?? null },
          requestId: input.actor.requestId,
          traceId: input.actor.traceId,
        });
      }
      const status = passed ? CaseStatus.CLOSED_RESOLVED : CaseStatus.REOPENED;
      const updatedCase = await transitionCase(tx, caseRow.id, status, {
        type: ActorType.USER,
        id: input.actor.id,
        requestId: input.actor.requestId,
        ...(input.actor.traceId ? { traceId: input.actor.traceId } : {}),
      });
      await enqueue(tx, {
        eventType: passed ? 'CASE_VERIFIED' : 'CASE_REOPENED',
        aggregateType: 'Case',
        aggregateId: caseRow.id,
        payload: { caseRef: caseRow.ref, verificationId: verification.id },
        dedupeKey: `case:${caseRow.id}:${caseRow.reopenCount}:verification:${verification.id}`,
      });
      return { verification, execution: updatedExecution, case: updatedCase };
    });
    verifications.add(1, { result: passed ? 'pass' : 'fail', disposition: decision.disposition });
    duration.record((performance.now() - started) / 1000, { result: passed ? 'pass' : 'fail' });
    return result;
  });
}
