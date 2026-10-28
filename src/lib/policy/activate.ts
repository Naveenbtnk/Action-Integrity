import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, CaseStatus, PolicyStatus } from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { enqueue } from '@/lib/outbox/enqueue';
import { verifiedPolicy } from '@/lib/policy/config';
import { transitionCase } from '@/lib/state-machine/case';

const OPEN = [
  CaseStatus.NEW,
  CaseStatus.TRIAGED,
  CaseStatus.HOLDING,
  CaseStatus.INVESTIGATING,
  CaseStatus.AWAITING_EVIDENCE,
  CaseStatus.AWAITING_APPROVAL,
  CaseStatus.APPROVED,
  CaseStatus.EXECUTING,
  CaseStatus.VERIFYING,
  CaseStatus.REJECTED,
  CaseStatus.SAFE_REFUSAL,
  CaseStatus.ESCALATED,
  CaseStatus.REOPENED,
];

export async function activatePolicy(
  tx: Prisma.TransactionClient,
  input: {
    version: string;
    hash: string;
    reviewTicket: string;
    actorId: string;
    requestId: string;
    traceId?: string;
  },
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(81657232002) IS NULL AS locked`;
  const candidate = await tx.policyVersion.findUnique({ where: { version: input.version } });
  if (!candidate) throw new NotFoundError('Policy version not found.');
  if (candidate.status !== PolicyStatus.DRAFT) throw new ConflictError('POLICY_NOT_DRAFT');
  if (candidate.hash !== input.hash) throw new ConflictError('POLICY_HASH_MISMATCH');
  await verifiedPolicy(candidate);
  if (candidate.reviewTicket !== input.reviewTicket)
    throw new ConflictError('POLICY_REVIEW_TICKET_MISMATCH');
  const previous = await tx.policyVersion.findFirst({ where: { status: PolicyStatus.ACTIVE } });
  const now = new Date();
  if (previous)
    await tx.policyVersion.update({
      where: { id: previous.id },
      data: { status: PolicyStatus.RETIRED, retiredAt: now },
    });
  const active = await tx.policyVersion.update({
    where: { id: candidate.id },
    data: { status: PolicyStatus.ACTIVE, activatedById: input.actorId, activatedAt: now },
  });
  const openCases = await tx.case.findMany({
    where: { status: { in: OPEN } },
    select: { id: true, status: true },
  });
  for (const caseRow of openCases) {
    const changed = await tx.approval.updateMany({
      where: { caseId: caseRow.id, status: 'VALID' },
      data: { status: 'SUPERSEDED' },
    });
    if (changed.count)
      await appendAuditEvent(tx, {
        eventType: 'APPROVAL_SUPERSEDED',
        actorType: ActorType.USER,
        actorId: input.actorId,
        caseId: caseRow.id,
        payload: { reason: 'POLICY_ACTIVATED', count: changed.count, policyVersion: input.version },
        requestId: input.requestId,
        traceId: input.traceId,
      });
    if (caseRow.status === CaseStatus.APPROVED)
      await transitionCase(tx, caseRow.id, CaseStatus.AWAITING_APPROVAL, {
        type: ActorType.USER,
        id: input.actorId,
        requestId: input.requestId,
        ...(input.traceId ? { traceId: input.traceId } : {}),
      });
  }
  await appendAuditEvent(tx, {
    eventType: 'POLICY_ACTIVATED',
    actorType: ActorType.USER,
    actorId: input.actorId,
    payload: {
      version: active.version,
      hash: active.hash,
      previousVersion: previous?.version ?? null,
      reviewTicket: input.reviewTicket,
    },
    requestId: input.requestId,
    traceId: input.traceId,
    policyVersion: active.version,
    policyHash: active.hash,
  });
  await enqueue(tx, {
    eventType: 'POLICY_ACTIVATED',
    aggregateType: 'PolicyVersion',
    aggregateId: active.id,
    payload: { version: active.version, hash: active.hash },
    dedupeKey: `policy-activated:${active.id}`,
  });
  return active;
}
