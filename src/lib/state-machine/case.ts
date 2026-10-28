import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, CaseStatus } from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { InvalidTransitionError, NotFoundError, QuorumNotMetError } from '@/lib/errors';

export const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  NEW: ['TRIAGED', 'CLOSED_NO_ACTION'],
  TRIAGED: ['HOLDING', 'CLOSED_NO_ACTION'],
  HOLDING: ['INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED'],
  INVESTIGATING: ['AWAITING_EVIDENCE', 'AWAITING_APPROVAL', 'ESCALATED'],
  AWAITING_EVIDENCE: ['INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED'],
  AWAITING_APPROVAL: ['INVESTIGATING', 'APPROVED', 'REJECTED', 'SAFE_REFUSAL', 'ESCALATED'],
  APPROVED: ['EXECUTING', 'VERIFYING', 'AWAITING_APPROVAL', 'SAFE_REFUSAL', 'ESCALATED'],
  EXECUTING: ['VERIFYING', 'SAFE_REFUSAL'],
  VERIFYING: ['CLOSED_RESOLVED', 'REOPENED', 'ESCALATED'],
  REJECTED: ['CLOSED_NO_ACTION', 'ESCALATED'],
  SAFE_REFUSAL: ['CLOSED_ESCALATED'],
  ESCALATED: ['INVESTIGATING', 'AWAITING_APPROVAL', 'CLOSED_ESCALATED'],
  REOPENED: ['INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED'],
  CLOSED_RESOLVED: ['REOPENED'],
  CLOSED_NO_ACTION: [],
  CLOSED_ESCALATED: [],
};

export type TransitionActor = {
  type: ActorType;
  id?: string | null;
  requestId: string;
  traceId?: string;
};

export async function transitionCase(
  tx: Prisma.TransactionClient,
  caseId: string,
  to: CaseStatus,
  actor: TransitionActor,
  meta: Prisma.InputJsonObject = {},
) {
  const current = await tx.case.findUnique({ where: { id: caseId } });
  if (!current) throw new NotFoundError('Case not found.');
  if (!TRANSITIONS[current.status].includes(to)) {
    throw new InvalidTransitionError({ from: current.status, to });
  }
  if (to === CaseStatus.APPROVED) {
    const decision = await tx.policyDecision.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!decision) throw new QuorumNotMetError();
    const valid = await tx.approval.findMany({
      where: {
        caseId,
        reopenCount: current.reopenCount,
        status: 'VALID',
        decision: 'APPROVE',
        expiresAt: { gt: new Date() },
      },
      include: { reviewer: { select: { roles: true } } },
    });
    const bound = valid.filter(
      (approval) =>
        approval.boundEvidenceHash === decision.evidenceHash &&
        approval.boundPolicyHash === decision.policyHash &&
        approval.boundReportId === decision.reportId &&
        approval.disposition === decision.disposition,
    );
    const distinct = new Set(bound.map((approval) => approval.reviewerId));
    const requiredRoles = decision.requiredRoles;
    if (
      distinct.size < decision.requiredApprovals ||
      requiredRoles.some(
        (role) =>
          !bound.some(
            (approval) =>
              approval.reviewer.roles.some((value) => value === role) ||
              (role === 'SENIOR_REVIEWER' && approval.breakGlass),
          ),
      )
    ) {
      throw new QuorumNotMetError();
    }
  }
  const now = new Date();
  const changed = await tx.case.updateMany({
    where: { id: caseId, status: current.status },
    data: {
      status: to,
      lastTransitionAt: now,
      ...(to === CaseStatus.REOPENED ? { reopenCount: { increment: 1 }, closedAt: null } : {}),
      ...((
        [
          CaseStatus.CLOSED_RESOLVED,
          CaseStatus.CLOSED_NO_ACTION,
          CaseStatus.CLOSED_ESCALATED,
        ] as CaseStatus[]
      ).includes(to)
        ? { closedAt: now }
        : {}),
    },
  });
  if (changed.count !== 1) throw new InvalidTransitionError({ from: current.status, to });
  await appendAuditEvent(tx, {
    eventType: 'CASE_TRANSITION',
    actorType: actor.type,
    actorId: actor.id ?? null,
    caseId,
    payload: { from: current.status, to, ...meta },
    requestId: actor.requestId,
    traceId: actor.traceId,
  });
  return tx.case.findUniqueOrThrow({ where: { id: caseId } });
}

export async function transition(
  caseId: string,
  to: CaseStatus,
  actor: TransitionActor,
  meta: Prisma.InputJsonObject = {},
) {
  return db.$transaction((tx) =>
    transitionCase(tx as Prisma.TransactionClient, caseId, to, actor, meta),
  );
}
