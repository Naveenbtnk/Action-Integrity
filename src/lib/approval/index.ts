import 'server-only';

import { metrics } from '@opentelemetry/api';

import type { PolicyDecision, Prisma } from '@/generated/prisma/client';
import {
  ActorType,
  ApprovalDecision,
  CaseStatus,
  Disposition,
  Role,
} from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import {
  AppError,
  ConflictError,
  EvidenceIncompleteError,
  NotFoundError,
  QuorumNotMetError,
  SeparationOfDutiesError,
  ValidationError,
} from '@/lib/errors';
import { transitionCase } from '@/lib/state-machine/case';

const approvalCounter = metrics.getMeter('aic-web').createCounter('aic_approvals_total');

export async function assertQuorum(
  tx: Prisma.TransactionClient,
  caseId: string,
  decision: PolicyDecision,
) {
  const current = await tx.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { reopenCount: true },
  });
  const approvals = await tx.approval.findMany({
    where: {
      caseId,
      reopenCount: current.reopenCount,
      status: 'VALID',
      decision: ApprovalDecision.APPROVE,
    },
    include: { reviewer: { select: { roles: true } } },
  });
  const active = await tx.policyVersion.findFirst({
    where: { status: 'ACTIVE' },
    select: { hash: true },
  });
  if (!active || active.hash !== decision.policyHash) throw new ConflictError('POLICY_STALE');
  const latestReport = await tx.investigationReport.findFirst({
    where: { caseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, evidenceHash: true },
  });
  if (
    !latestReport ||
    latestReport.id !== decision.reportId ||
    latestReport.evidenceHash !== decision.evidenceHash
  )
    throw new ConflictError('EVIDENCE_CHANGED');
  const latestEvidence = await tx.evidenceItem.findFirst({
    where: { caseId },
    orderBy: { capturedAt: 'desc' },
    select: { capturedAt: true },
  });
  const reportTime = await tx.investigationReport.findUnique({
    where: { id: latestReport.id },
    select: { createdAt: true },
  });
  if (latestEvidence && reportTime && latestEvidence.capturedAt > reportTime.createdAt)
    throw new ConflictError('EVIDENCE_CHANGED');
  for (const row of approvals) {
    if (row.expiresAt <= new Date()) throw new ConflictError('APPROVAL_EXPIRED');
    if (row.boundPolicyHash !== decision.policyHash) throw new ConflictError('POLICY_STALE');
    if (row.boundEvidenceHash !== decision.evidenceHash || row.boundReportId !== decision.reportId)
      throw new ConflictError('EVIDENCE_CHANGED');
    if (row.disposition !== decision.disposition) throw new ConflictError('APPROVAL_CONFLICT');
  }
  const distinct = new Set(approvals.map((row) => row.reviewerId));
  const satisfiedRoles = new Set<string>();
  for (const row of approvals) {
    for (const role of row.reviewer.roles) satisfiedRoles.add(role);
    if (row.breakGlass) satisfiedRoles.add(Role.SENIOR_REVIEWER);
  }
  const missingRoles = decision.requiredRoles.filter((role) => !satisfiedRoles.has(role));
  const met = distinct.size >= decision.requiredApprovals && missingRoles.length === 0;
  if (
    !met &&
    (await tx.approval.count({
      where: {
        caseId,
        reopenCount: current.reopenCount,
        status: 'EXPIRED',
        decision: ApprovalDecision.APPROVE,
        boundPolicyHash: decision.policyHash,
        boundEvidenceHash: decision.evidenceHash,
        boundReportId: decision.reportId ?? undefined,
      },
    }))
  )
    throw new ConflictError('APPROVAL_EXPIRED');
  return {
    met,
    current: distinct.size,
    required: decision.requiredApprovals,
    requiredRoles: decision.requiredRoles,
    satisfiedRoles: [...satisfiedRoles],
    missingRoles,
  };
}

export async function assertSeparationOfDuties(
  tx: Prisma.TransactionClient,
  caseId: string,
  actorId: string,
) {
  const caseRow = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
  const approved = await tx.approval.findFirst({
    where: { caseId, reopenCount: caseRow.reopenCount, reviewerId: actorId, status: 'VALID' },
  });
  if (approved) throw new SeparationOfDutiesError();
  const authoredOverride = await tx.approval.findFirst({
    where: {
      caseId,
      reopenCount: caseRow.reopenCount,
      reviewerId: actorId,
      decision: ApprovalDecision.OVERRIDE,
    },
  });
  if (authoredOverride) throw new ConflictError('REVIEWER_CONFLICT');
}

export async function recordApproval(
  tx: Prisma.TransactionClient,
  input: {
    caseRef: string;
    actor: { id: string; roles: Role[]; requestId: string; traceId?: string };
    decision: ApprovalDecision;
    disposition: Disposition;
    rationale: string;
    elevationId?: string;
  },
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(81657232002) IS NULL AS locked`;
  await tx.$queryRaw`SELECT id FROM "case" WHERE ref = ${input.caseRef} FOR UPDATE`;
  const caseRow = await tx.case.findUnique({ where: { ref: input.caseRef } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  if (caseRow.status !== CaseStatus.AWAITING_APPROVAL)
    throw new ConflictError('INVALID_TRANSITION', 'Case is not awaiting approval.');
  const policy = await tx.policyDecision.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!policy || !policy.reportId) throw new ConflictError('POLICY_UNAVAILABLE');
  if (!policy.allowedDispositions.includes(input.disposition)) {
    if (
      (input.disposition === Disposition.RELEASE_AFTER_CORRECTION ||
        input.disposition === Disposition.COMPENSATE) &&
      Array.isArray(policy.reasons) &&
      policy.reasons.includes('EVIDENCE_INCOMPLETE')
    )
      throw new EvidenceIncompleteError();
    throw new AppError('DISPOSITION_NOT_ALLOWED', 422, 'Disposition is not permitted.');
  }
  if (input.disposition !== policy.disposition)
    throw new ConflictError('APPROVAL_CONFLICT', 'Disposition differs from the policy decision.');
  if (input.decision !== ApprovalDecision.APPROVE && input.rationale.trim().length < 20)
    throw new ValidationError('Rationale must contain at least 20 characters.');
  if (input.actor.roles.includes(Role.ADMIN) && !input.elevationId)
    throw new AppError('FORBIDDEN', 403, 'Administrators cannot approve business decisions.');
  if (
    !input.actor.roles.includes(Role.REVIEWER) &&
    !input.actor.roles.includes(Role.SENIOR_REVIEWER) &&
    !input.elevationId
  )
    throw new AppError('FORBIDDEN', 403, 'Reviewer role required.');
  const override = await tx.approval.findFirst({
    where: {
      caseId: caseRow.id,
      reopenCount: caseRow.reopenCount,
      decision: ApprovalDecision.OVERRIDE,
      reviewerId: input.actor.id,
    },
  });
  if (override && input.decision === ApprovalDecision.APPROVE)
    throw new ConflictError('REVIEWER_CONFLICT');
  if (
    await tx.approval.findUnique({
      where: {
        caseId_reopenCount_reviewerId: {
          caseId: caseRow.id,
          reopenCount: caseRow.reopenCount,
          reviewerId: input.actor.id,
        },
      },
    })
  )
    throw new ConflictError('DUPLICATE_APPROVER');
  const valid = await tx.approval.findMany({
    where: { caseId: caseRow.id, reopenCount: caseRow.reopenCount, status: 'VALID' },
    orderBy: { createdAt: 'asc' },
  });
  if (valid.some((row) => row.disposition !== input.disposition))
    throw new ConflictError('APPROVAL_CONFLICT');
  const latestReport = await tx.investigationReport.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { createdAt: 'desc' },
  });
  if (
    !latestReport ||
    latestReport.id !== policy.reportId ||
    latestReport.evidenceHash !== policy.evidenceHash
  )
    throw new ConflictError('EVIDENCE_CHANGED');
  const citations = Array.isArray(latestReport.citations) ? latestReport.citations : [];
  const cited = citations.filter(
    (item): item is { kind: string; ref: string } =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof item.kind === 'string' &&
      typeof item.ref === 'string',
  );
  if (cited.length) {
    const authored = await tx.evidenceItem.findMany({
      where: { caseId: caseRow.id, recordRef: { in: cited.map((item) => item.ref) } },
      select: { kind: true, recordRef: true, addedById: true },
    });
    if (
      cited.every((citation) =>
        authored.some(
          (item) =>
            item.kind === citation.kind &&
            item.recordRef === citation.ref &&
            item.addedById === input.actor.id,
        ),
      )
    )
      throw new ConflictError(
        'REVIEWER_CONFLICT',
        'A different reviewer must approve self-authored decisive evidence.',
      );
  }
  const latestEvidence = await tx.evidenceItem.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { capturedAt: 'desc' },
    select: { capturedAt: true },
  });
  if (latestEvidence && latestEvidence.capturedAt > latestReport.createdAt)
    throw new ConflictError('EVIDENCE_CHANGED');
  const active = await tx.policyVersion.findFirst({ where: { status: 'ACTIVE' } });
  if (!active || active.hash !== policy.policyHash) throw new ConflictError('POLICY_STALE');
  const expiry = valid[0]?.expiresAt ?? new Date(Date.now() + 12 * 3_600_000);
  if (expiry <= new Date()) throw new ConflictError('APPROVAL_EXPIRED');
  if (input.decision === ApprovalDecision.REJECT) {
    await tx.approval.updateMany({
      where: { caseId: caseRow.id, status: 'VALID' },
      data: { status: 'REVOKED' },
    });
  }
  const row = await tx.approval.create({
    data: {
      caseId: caseRow.id,
      reviewerId: input.actor.id,
      decision: input.decision,
      disposition: input.disposition,
      rationale: input.rationale,
      reopenCount: caseRow.reopenCount,
      status: 'VALID',
      boundEvidenceHash: policy.evidenceHash,
      boundPolicyHash: policy.policyHash,
      boundReportId: policy.reportId,
      expiresAt: expiry,
      breakGlass: !!input.elevationId,
      elevationId: input.elevationId ?? null,
      createdAt: new Date(),
    },
  });
  await appendAuditEvent(tx, {
    eventType:
      input.decision === ApprovalDecision.REJECT ? 'APPROVAL_REJECTED' : 'APPROVAL_RECORDED',
    actorType: ActorType.USER,
    actorId: input.actor.id,
    caseId: caseRow.id,
    payload: {
      approvalId: row.id,
      disposition: row.disposition,
      decision: row.decision,
      breakGlass: row.breakGlass,
    },
    requestId: input.actor.requestId,
    traceId: input.actor.traceId,
  });
  if (input.decision === ApprovalDecision.REJECT) {
    await transitionCase(tx, caseRow.id, CaseStatus.REJECTED, {
      type: ActorType.USER,
      id: input.actor.id,
      requestId: input.actor.requestId,
      ...(input.actor.traceId ? { traceId: input.actor.traceId } : {}),
    });
    approvalCounter.add(1, { decision: input.decision, quorum_met: 'false' });
    return {
      approval: row,
      quorum: {
        met: false,
        current: 0,
        required: policy.requiredApprovals,
        requiredRoles: policy.requiredRoles,
        satisfiedRoles: [],
        missingRoles: policy.requiredRoles,
      },
    };
  }
  const quorum = await assertQuorum(tx, caseRow.id, policy);
  if (input.decision === ApprovalDecision.OVERRIDE) {
    approvalCounter.add(1, { decision: input.decision, quorum_met: 'false' });
    return { approval: row, quorum };
  }
  if (quorum.met)
    await transitionCase(tx, caseRow.id, CaseStatus.APPROVED, {
      type: ActorType.USER,
      id: input.actor.id,
      requestId: input.actor.requestId,
      ...(input.actor.traceId ? { traceId: input.actor.traceId } : {}),
    });
  approvalCounter.add(1, { decision: input.decision, quorum_met: String(quorum.met) });
  return { approval: row, quorum };
}

export async function requireQuorum(
  tx: Prisma.TransactionClient,
  caseId: string,
  decision: PolicyDecision,
) {
  const quorum = await assertQuorum(tx, caseId, decision);
  if (!quorum.met) throw new QuorumNotMetError(quorum);
  return quorum;
}

export async function expireApprovals(
  tx: Prisma.TransactionClient,
  caseId: string,
  requestId: string,
  now = new Date(),
) {
  const expired = await tx.approval.findMany({
    where: { caseId, status: 'VALID', decision: ApprovalDecision.APPROVE, expiresAt: { lte: now } },
    select: { id: true },
  });
  if (!expired.length) return 0;
  await tx.approval.updateMany({
    where: { id: { in: expired.map((row) => row.id) }, status: 'VALID' },
    data: { status: 'EXPIRED' },
  });
  await appendAuditEvent(tx, {
    eventType: 'APPROVAL_EXPIRED',
    actorType: ActorType.SYSTEM,
    caseId,
    payload: { approvalIds: expired.map((row) => row.id), count: expired.length },
    requestId,
  });
  const caseRow = await tx.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { status: true },
  });
  if (caseRow.status === CaseStatus.APPROVED)
    await transitionCase(tx, caseId, CaseStatus.AWAITING_APPROVAL, {
      type: ActorType.SYSTEM,
      requestId,
    });
  return expired.length;
}
