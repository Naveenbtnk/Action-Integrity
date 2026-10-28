import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import {
  ActorType,
  CaseMode,
  CaseStatus,
  GateDecision,
  IntegrityEventStatus,
  OutboundActionStatus,
  type OutboundActionType,
} from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { env } from '@/lib/env';
import { ConflictError } from '@/lib/errors';
import { computeExposure } from '@/lib/exposure/compute';
import { decide } from '@/lib/gate/decide';
import { sha } from '@/lib/integrity/hash';
import { enqueue } from '@/lib/outbox/enqueue';
import { transitionCase } from '@/lib/state-machine/case';

export type IngestInput = {
  sourceAgent: string;
  accountId: string;
  actionType: OutboundActionType;
  payload: Prisma.InputJsonValue;
  requestedAt: Date;
  idempotencyKey: string;
  requestId: string;
  traceId?: string;
};

function ref(prefix: string, sequence: bigint): string {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

export async function ingestAction(tx: Prisma.TransactionClient, input: IngestInput) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(81657232002) IS NULL AS locked`;
  const payloadHash = sha(input.payload);
  const held = await tx.actionHold.findFirst({
    where: {
      releasedAt: null,
      outboundAction: {
        accountId: input.accountId,
        actionType: input.actionType,
        payloadHash,
      },
    },
    select: { id: true },
  });
  if (held) throw new ConflictError('ACTION_ALREADY_HELD', 'This action is already held.');

  const [account, events, actionNumber] = await Promise.all([
    tx.srcAccountRegistry.findUnique({
      where: { accountId: input.accountId },
      select: { id: true },
    }),
    tx.integrityEvent.findMany({
      where: { status: { in: [IntegrityEventStatus.OPEN, IntegrityEventStatus.LINKED] } },
      include: {
        contract: { select: { sourceKey: true, fieldPath: true } },
        cases: { select: { id: true, status: true } },
      },
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
    }),
    tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('action_ref_seq') AS value`,
  ]);
  const number = actionNumber[0];
  if (!number) throw new Error('Action reference sequence unavailable.');
  const active = events.filter(
    (event) =>
      event.status === IntegrityEventStatus.OPEN ||
      event.cases.some(
        (caseRow) =>
          !(
            [
              CaseStatus.CLOSED_RESOLVED,
              CaseStatus.CLOSED_NO_ACTION,
              CaseStatus.CLOSED_ESCALATED,
            ] as CaseStatus[]
          ).includes(caseRow.status),
      ),
  );
  const decision = decide(
    {
      id: 'submission',
      accountId: input.accountId,
      actionType: input.actionType,
      payload: input.payload,
      requestedAt: input.requestedAt,
    },
    {
      accountRegistered: !!account,
      openEvents: active.map((event) => {
        const linked = event.cases.find((caseRow) => caseRow.status === CaseStatus.HOLDING);
        return {
          id: event.id,
          detectedAt: event.detectedAt,
          scopeSelector: event.scopeSelector,
          contract: event.contract,
          ...(linked ? { caseId: linked.id } : {}),
        };
      }),
    },
  );
  const now = new Date();
  const action = await tx.outboundAction.create({
    data: {
      ref: ref('ACT', number.value),
      sourceAgent: input.sourceAgent,
      accountId: input.accountId,
      actionType: input.actionType,
      payload: input.payload,
      payloadHash,
      requestedAt: input.requestedAt,
      status:
        decision.decision === GateDecision.HOLD
          ? OutboundActionStatus.HELD
          : decision.decision === GateDecision.BLOCK
            ? OutboundActionStatus.BLOCKED
            : OutboundActionStatus.PENDING,
      gateDecision: decision.decision,
      gateEvaluatedAt: now,
      idempotencyKey: input.idempotencyKey,
      integrityEventId: decision.eventId ?? null,
    },
  });
  await appendAuditEvent(tx, {
    eventType: 'ACTION_INGESTED',
    actorType: ActorType.SERVICE,
    actorId: input.sourceAgent,
    payload: { actionRef: action.ref, decision: decision.decision, reasons: decision.reasons },
    requestId: input.requestId,
    traceId: input.traceId,
  });
  await enqueue(tx, {
    eventType: 'ACTION_INGESTED',
    aggregateType: 'OutboundAction',
    aggregateId: action.id,
    payload: { actionRef: action.ref, decision: decision.decision },
    dedupeKey: `action:${action.id}:ingested`,
  });

  if (decision.decision !== GateDecision.HOLD || !decision.eventId) {
    return {
      action,
      gate: { decision: decision.decision, reasons: decision.reasons },
      execution: null,
      case: null,
      pendingExecutor: decision.decision === GateDecision.ALLOW,
    };
  }
  const event = active.find((candidate) => candidate.id === decision.eventId);
  if (!event) throw new Error('Linked integrity event unavailable.');
  const caseNumber = await tx.$queryRaw<
    Array<{ value: bigint }>
  >`SELECT nextval('case_ref_seq') AS value`;
  const next = caseNumber[0];
  if (!next) throw new Error('Case reference sequence unavailable.');
  const windowMs = 24 * 3_600_000;
  const nearby = await tx.outboundAction.findMany({
    where: {
      id: { not: action.id },
      status: { in: [OutboundActionStatus.PENDING, OutboundActionStatus.EXECUTED] },
      requestedAt: {
        gte: new Date(event.detectedAt.getTime() - windowMs),
        lte: new Date(event.detectedAt.getTime() + windowMs),
      },
    },
  });
  const exposure = computeExposure(event, [
    { ...action, status: OutboundActionStatus.PENDING },
    ...nearby,
  ]);
  const estimated = await tx.srcBillingSubscription.aggregate({
    where: { accountId: { in: exposure.accountIds } },
    _sum: { mrrMinor: true },
  });
  const caseRow = await tx.case.create({
    data: {
      ref: ref('AIC', next.value),
      integrityEventId: event.id,
      title: `Integrity hold for ${input.actionType}`,
      status: CaseStatus.NEW,
      severity: event.severity,
      riskScore: 0,
      riskBand: 'LOW',
      exposureCount: exposure.accountIds.length,
      estimatedValueMinor: estimated._sum.mrrMinor ?? 0n,
      mode: env.INVESTIGATION_MODE === 'agent' ? CaseMode.AGENT : CaseMode.DETERMINISTIC,
      openedAt: now,
      lastTransitionAt: now,
      slaDueAt: new Date(now.getTime() + env.HOLD_SLA_HOURS * 3_600_000),
    },
  });
  await appendAuditEvent(tx, {
    eventType: 'CASE_OPENED',
    actorType: ActorType.SERVICE,
    actorId: input.sourceAgent,
    caseId: caseRow.id,
    payload: { caseRef: caseRow.ref, integrityEventId: event.id },
    requestId: input.requestId,
    traceId: input.traceId,
  });
  await enqueue(tx, {
    eventType: 'CASE_OPENED',
    aggregateType: 'Case',
    aggregateId: caseRow.id,
    payload: { caseRef: caseRow.ref },
    dedupeKey: `case:${caseRow.id}:opened`,
  });
  const actor = {
    type: ActorType.SERVICE,
    id: input.sourceAgent,
    requestId: input.requestId,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
  await transitionCase(tx, caseRow.id, CaseStatus.TRIAGED, actor);
  await transitionCase(tx, caseRow.id, CaseStatus.HOLDING, actor);
  await tx.outboundAction.update({ where: { id: action.id }, data: { caseId: caseRow.id } });
  await tx.caseExposedAccount.createMany({
    data: exposure.accountIds.map((accountId) => ({
      caseId: caseRow.id,
      accountId,
      outboundActionId:
        exposure.actions.find((exposed) => exposed.accountId === accountId)?.id ?? null,
      externalRef: accountId,
    })),
  });
  await tx.actionHold.create({
    data: {
      outboundActionId: action.id,
      caseId: caseRow.id,
      reason: decision.reasons.join(','),
      placedAt: now,
    },
  });
  await tx.integrityEvent.updateMany({
    where: { id: event.id, status: IntegrityEventStatus.OPEN },
    data: { status: IntegrityEventStatus.LINKED },
  });
  await appendAuditEvent(tx, {
    eventType: 'HOLD_PLACED',
    actorType: ActorType.SERVICE,
    actorId: input.sourceAgent,
    caseId: caseRow.id,
    payload: { actionRef: action.ref, caseRef: caseRow.ref },
    requestId: input.requestId,
    traceId: input.traceId,
  });
  await enqueue(tx, {
    eventType: 'HOLD_PLACED',
    aggregateType: 'ActionHold',
    aggregateId: action.id,
    payload: { actionRef: action.ref, caseRef: caseRow.ref },
    dedupeKey: `action:${action.id}:hold`,
  });
  return {
    action: { ...action, caseId: caseRow.id },
    gate: { decision: GateDecision.HOLD, reasons: decision.reasons, caseRef: caseRow.ref },
    execution: null,
    case: { ...caseRow, status: CaseStatus.HOLDING },
    pendingExecutor: false,
  };
}
