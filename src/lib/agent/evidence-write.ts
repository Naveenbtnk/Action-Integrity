import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import {
  ActorType,
  CaseStatus,
  EvidenceRequestStatus,
  type EvidenceKind,
  type EvidenceStance,
} from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { AppError, NotFoundError } from '@/lib/errors';
import { transitionCase } from '@/lib/state-machine/case';

type Actor = { id: string; requestId: string; traceId?: string | undefined };

export async function addEvidence(
  tx: Prisma.TransactionClient,
  caseRef: string,
  input: {
    kind: EvidenceKind;
    sourceKey: string;
    recordRef: string;
    excerpt: string;
    stance: EvidenceStance;
  },
  actor: Actor,
) {
  const caseRow = await tx.case.findUnique({
    where: { ref: caseRef },
    include: {
      reports: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!caseRow) throw new NotFoundError('Case not found.');
  if (
    !(
      [
        CaseStatus.HOLDING,
        CaseStatus.INVESTIGATING,
        CaseStatus.AWAITING_EVIDENCE,
        CaseStatus.AWAITING_APPROVAL,
        CaseStatus.APPROVED,
      ] as CaseStatus[]
    ).includes(caseRow.status)
  )
    throw new AppError('INVALID_TRANSITION', 409, 'Evidence cannot be added to this case.');
  const evidence = await tx.evidenceItem.create({
    data: {
      caseId: caseRow.id,
      kind: input.kind,
      sourceKey: input.sourceKey,
      recordRef: input.recordRef,
      excerpt: input.excerpt,
      stance: input.stance,
      capturedAt: new Date(),
      addedById: actor.id,
    },
  });
  await appendAuditEvent(tx, {
    eventType: 'EVIDENCE_ADDED',
    actorType: ActorType.USER,
    actorId: actor.id,
    caseId: caseRow.id,
    payload: { evidenceId: evidence.id, kind: input.kind, recordRef: input.recordRef },
    requestId: actor.requestId,
    traceId: actor.traceId,
  });
  const superseded = await tx.approval.updateMany({
    where: { caseId: caseRow.id, status: 'VALID' },
    data: { status: 'SUPERSEDED' },
  });
  if (superseded.count)
    await appendAuditEvent(tx, {
      eventType: 'APPROVAL_SUPERSEDED',
      actorType: ActorType.USER,
      actorId: actor.id,
      caseId: caseRow.id,
      payload: { reason: 'EVIDENCE_ADDED', evidenceId: evidence.id, count: superseded.count },
      requestId: actor.requestId,
      traceId: actor.traceId,
    });
  let status = caseRow.status;
  if (status === CaseStatus.APPROVED) {
    status = CaseStatus.AWAITING_APPROVAL;
    await transitionCase(tx, caseRow.id, status, {
      type: ActorType.USER,
      id: actor.id,
      requestId: actor.requestId,
      ...(actor.traceId ? { traceId: actor.traceId } : {}),
    });
  }
  if (status === CaseStatus.AWAITING_EVIDENCE) {
    const latest = caseRow.reports[0];
    const satisfies = !!latest?.missingEvidence.length || input.stance === 'CONTRADICTS';
    status = satisfies ? CaseStatus.INVESTIGATING : CaseStatus.AWAITING_APPROVAL;
    await transitionCase(tx, caseRow.id, status, {
      type: ActorType.USER,
      id: actor.id,
      requestId: actor.requestId,
      ...(actor.traceId ? { traceId: actor.traceId } : {}),
    });
  }
  return { evidence, caseStatus: status };
}

export async function createEvidenceRequest(
  tx: Prisma.TransactionClient,
  caseRef: string,
  input: {
    ownerTeam: string;
    question: string;
    dueInHours: number;
  },
  actor: Actor,
) {
  const caseRow = await tx.case.findUnique({ where: { ref: caseRef } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  if (
    !([CaseStatus.INVESTIGATING, CaseStatus.AWAITING_EVIDENCE] as CaseStatus[]).includes(
      caseRow.status,
    )
  )
    throw new AppError('INVALID_TRANSITION', 409, 'Evidence cannot be requested in this state.');
  const request = await tx.evidenceRequest.create({
    data: {
      caseId: caseRow.id,
      ownerTeam: input.ownerTeam,
      question: input.question,
      status: EvidenceRequestStatus.REQUESTED,
      requestedAt: new Date(),
      dueAt: new Date(Date.now() + input.dueInHours * 3_600_000),
    },
  });
  await appendAuditEvent(tx, {
    eventType: 'EVIDENCE_REQUESTED',
    actorType: ActorType.USER,
    actorId: actor.id,
    caseId: caseRow.id,
    payload: { evidenceRequestId: request.id, ownerTeam: input.ownerTeam },
    requestId: actor.requestId,
    traceId: actor.traceId,
  });
  if (caseRow.status === CaseStatus.INVESTIGATING)
    await transitionCase(tx, caseRow.id, CaseStatus.AWAITING_EVIDENCE, {
      type: ActorType.USER,
      id: actor.id,
      requestId: actor.requestId,
      ...(actor.traceId ? { traceId: actor.traceId } : {}),
    });
  return { request, caseStatus: CaseStatus.AWAITING_EVIDENCE };
}
