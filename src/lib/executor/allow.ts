import 'server-only';

import { metrics } from '@opentelemetry/api';

import { Prisma } from '@/generated/prisma/client';
import {
  ActorType,
  DegradationLevel,
  GateDecision,
  OutboundActionStatus,
} from '@/generated/prisma/enums';
import type { TargetAdapter } from '@/lib/adapters/types';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { ConflictError, DegradationBlockedError, NotFoundError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';
import { enqueue } from '@/lib/outbox/enqueue';

import { objectRef, targetChange, targetRef } from './action';
import { captureRestorePoint, persistRestorePoint } from './restore-point';
import { createTargetClient } from './target-client';

const meter = metrics.getMeter('aic-web');
const executions = meter.createCounter('aic_executions_total');
const verifications = meter.createCounter('aic_verifications_total');
const targetRequests = meter.createCounter('aic_target_requests_total');

export async function executeAllowedAction(input: {
  actionId: string;
  requestId: string;
  traceId?: string;
  client?: TargetAdapter;
}) {
  const client = input.client ?? createTargetClient();
  const action = await db.outboundAction.findUnique({ where: { id: input.actionId } });
  if (!action) throw new NotFoundError('Action not found.');
  if (action.gateDecision !== GateDecision.ALLOW) throw new ConflictError('GATE_NOT_ALLOWED');
  const prior = await db.actionExecution.findUnique({
    where: { idempotencyKey: `allow:${action.id}` },
  });
  if (prior) {
    const verification = await db.verificationResult.findFirst({
      where: { executionId: prior.id },
    });
    return { execution: prior, verification };
  }
  if (action.status !== OutboundActionStatus.PENDING) throw new ConflictError('ACTION_NOT_PENDING');
  const change = targetChange(action);
  const ref = targetRef(change);
  const captured = await captureRestorePoint(client, ref);
  const execution = await db.$transaction(async (raw) => {
    const tx = raw as Prisma.TransactionClient;
    await tx.$queryRaw`SELECT id FROM outbound_action WHERE id = ${action.id} FOR UPDATE`;
    const current = await tx.outboundAction.findUniqueOrThrow({ where: { id: action.id } });
    if (current.status !== OutboundActionStatus.PENDING)
      throw new ConflictError('ACTION_NOT_PENDING');
    const degradation = await tx.degradationState.findFirst({ orderBy: { changedAt: 'desc' } });
    if (
      degradation?.level === DegradationLevel.L2_TARGET_DEGRADED ||
      degradation?.level === DegradationLevel.L3_DB_DEGRADED ||
      degradation?.level === DegradationLevel.L4_AUDIT_BROKEN
    )
      throw new DegradationBlockedError({ level: degradation.level });
    if (await tx.actionExecution.findUnique({ where: { idempotencyKey: `allow:${action.id}` } }))
      throw new ConflictError('ALREADY_EXECUTING');
    const restorePoint = await persistRestorePoint(tx, {
      outboundActionId: action.id,
      ref,
      snapshot: captured,
    });
    await tx.outboundAction.update({
      where: { id: action.id },
      data: { restorePointId: restorePoint.id },
    });
    const row = await tx.actionExecution.create({
      data: {
        caseId: null,
        outboundActionId: action.id,
        reopenCount: 0,
        kind: 'RELEASE',
        targetObjectType: ref.targetObjectType,
        targetObjectRef: objectRef(ref),
        restorePointId: restorePoint.id,
        preWriteRestorePointId: restorePoint.id,
        idempotencyKey: `allow:${action.id}`,
        status: 'PENDING',
        requestPayload: change as Prisma.InputJsonObject,
        startedAt: new Date(),
      },
    });
    await appendAuditEvent(tx, {
      eventType: 'EXECUTION_STARTED',
      actorType: ActorType.SERVICE,
      actorId: action.sourceAgent,
      payload: { executionId: row.id, actionRef: action.ref, gateDecision: GateDecision.ALLOW },
      requestId: input.requestId,
      traceId: input.traceId,
    });
    await enqueue(tx, {
      eventType: 'EXECUTION_STARTED',
      aggregateType: 'OutboundAction',
      aggregateId: action.id,
      payload: { actionRef: action.ref, executionId: row.id },
      dedupeKey: `execution:${row.id}:started`,
    });
    return row;
  });
  let result;
  try {
    result = await client.applyChange(change, execution.idempotencyKey);
  } catch {
    result = { status: 'UNKNOWN' as const, response: null, failureCode: 'TARGET_RESPONSE_LOST' };
  }
  targetRequests.add(1, { operation: 'ALLOW', outcome: result.status });
  executions.add(1, { kind: 'RELEASE', status: result.status });
  await db.$transaction(async (raw) => {
    const tx = raw as Prisma.TransactionClient;
    await tx.actionExecution.update({
      where: { id: execution.id },
      data: {
        status: result.status,
        responsePayload:
          result.response == null ? Prisma.JsonNull : (result.response as Prisma.InputJsonValue),
        failureCode: result.failureCode ?? null,
        finishedAt: new Date(),
      },
    });
    await appendAuditEvent(tx, {
      eventType: 'EXECUTION_RESULT',
      actorType: ActorType.SERVICE,
      actorId: action.sourceAgent,
      payload: {
        executionId: execution.id,
        status: result.status,
        failureCode: result.failureCode ?? null,
      },
      requestId: input.requestId,
      traceId: input.traceId,
    });
  });
  let observed;
  try {
    observed =
      ref.targetObjectType === 'entitlement'
        ? await client.getEntitlement(ref.accountId, ref.key)
        : await client.getServiceStatus(ref.accountId);
  } catch {
    targetRequests.add(1, { operation: 'read', outcome: 'error' });
    verifications.add(1, { result: 'error', disposition: 'ALLOW' });
    await db.$transaction(async (raw) => {
      const tx = raw as Prisma.TransactionClient;
      await tx.actionExecution.update({
        where: { id: execution.id },
        data: { status: 'UNKNOWN', failureCode: 'VERIFICATION_UNAVAILABLE' },
      });
      await appendAuditEvent(tx, {
        eventType: 'VERIFICATION_UNAVAILABLE',
        actorType: ActorType.SERVICE,
        actorId: action.sourceAgent,
        payload: { executionId: execution.id },
        requestId: input.requestId,
        traceId: input.traceId,
      });
    });
    return {
      execution: await db.actionExecution.findUniqueOrThrow({ where: { id: execution.id } }),
      verification: null,
    };
  }
  const field = ref.targetObjectType === 'entitlement' ? 'status' : 'state';
  targetRequests.add(1, { operation: 'read', outcome: 'ok' });
  const observedValue = (observed as Record<string, unknown> | null)?.[field];
  const passed = observedValue === change.to;
  verifications.add(1, { result: passed ? 'pass' : 'fail', disposition: 'ALLOW' });
  const verification = await db.$transaction(async (raw) => {
    const tx = raw as Prisma.TransactionClient;
    const row = await tx.verificationResult.create({
      data: {
        caseId: null,
        executionId: execution.id,
        expectedState: { [field]: change.to },
        observedState: observed ? (observed as Prisma.InputJsonValue) : Prisma.JsonNull,
        observedStateHash: sha(observed),
        passed,
        mismatches: passed ? [] : [{ field, expected: change.to, observed: observedValue ?? null }],
        attemptCount: 1,
        checkedAt: new Date(),
      },
    });
    if (result.status !== (passed ? 'SUCCEEDED' : 'FAILED'))
      await tx.actionExecution.update({
        where: { id: execution.id },
        data: {
          status: passed ? 'SUCCEEDED' : 'FAILED',
          resolvedByVerification: true,
          resolvedAt: new Date(),
        },
      });
    if (passed)
      await tx.outboundAction.update({
        where: { id: action.id },
        data: { status: OutboundActionStatus.EXECUTED },
      });
    await appendAuditEvent(tx, {
      eventType: passed ? 'ACTION_VERIFIED' : 'VERIFICATION_FAILED',
      actorType: ActorType.SERVICE,
      actorId: action.sourceAgent,
      payload: { executionId: execution.id, verificationId: row.id, passed },
      requestId: input.requestId,
      traceId: input.traceId,
    });
    return row;
  });
  return {
    execution: await db.actionExecution.findUniqueOrThrow({ where: { id: execution.id } }),
    verification,
  };
}
