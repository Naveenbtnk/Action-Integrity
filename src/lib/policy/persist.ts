import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, CaseStatus, PolicyStatus } from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { verifiedPolicy } from '@/lib/policy/config';
import { evaluate } from '@/lib/policy/evaluate';
import { transitionCase } from '@/lib/state-machine/case';

export async function evaluateAndPersist(
  tx: Prisma.TransactionClient,
  caseRef: string,
  actor: { id: string; requestId: string; traceId?: string },
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(81657232002) IS NULL AS locked`;
  const policyRow = await tx.policyVersion.findFirst({ where: { status: PolicyStatus.ACTIVE } });
  if (!policyRow) throw new ConflictError('POLICY_UNAVAILABLE', 'No active policy version.');
  const policy = await verifiedPolicy(policyRow);
  const caseRow = await tx.case.findUnique({
    where: { ref: caseRef },
    include: {
      reports: { orderBy: { createdAt: 'desc' }, take: 1 },
      actions: { orderBy: { requestedAt: 'desc' }, take: 1 },
    },
  });
  if (!caseRow) throw new NotFoundError('Case not found.');
  const report = caseRow.reports[0];
  const action = caseRow.actions[0];
  if (!report || !action)
    throw new ConflictError('POLICY_INPUT_MISSING', 'Investigation and action are required.');
  const latestEvidence = await tx.evidenceItem.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { capturedAt: 'desc' },
    select: { capturedAt: true },
  });
  if (latestEvidence && latestEvidence.capturedAt > report.createdAt)
    throw new ConflictError('EVIDENCE_CHANGED', 'Investigate the newly added evidence first.');
  if (
    !(
      [
        CaseStatus.AWAITING_APPROVAL,
        CaseStatus.AWAITING_EVIDENCE,
        CaseStatus.INVESTIGATING,
      ] as CaseStatus[]
    ).includes(caseRow.status)
  )
    throw new ConflictError('INVALID_TRANSITION', 'Case is not ready for policy evaluation.');
  const result = evaluate({
    caseRow,
    report: {
      id: report.id,
      recommendedDisposition: report.recommendedDisposition,
      confidence: Number(report.confidence),
      evidenceCompleteness: Number(report.evidenceCompleteness),
      evidenceHash: report.evidenceHash,
      isFallback: report.isFallback,
    },
    action,
    policy,
    policyHash: policyRow.hash,
    now: new Date(),
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
      payload: { reason: 'POLICY_REEVALUATED', count: superseded.count },
      requestId: actor.requestId,
      traceId: actor.traceId,
    });
  const decision = await tx.policyDecision.create({
    data: {
      caseId: caseRow.id,
      reportId: report.id,
      riskScore: result.riskScore,
      riskBand: result.riskBand,
      disposition: result.disposition,
      allowedDispositions: result.allowedDispositions,
      approvalRequired: result.approvalRequired,
      requiredApprovals: result.requiredApprovals,
      requiredRoles: result.requiredRoles,
      approvalExpiresAt: result.approvalExpiresAt,
      reasons: result.reasons,
      policyVersion: policyRow.version,
      policyHash: policyRow.hash,
      evidenceHash: result.evidenceHash,
      inputsHash: result.inputsHash,
      isFallback: result.isFallback,
      createdAt: new Date(),
    },
  });
  await tx.case.update({
    where: { id: caseRow.id },
    data: {
      riskScore: result.riskScore,
      riskBand: result.riskBand,
      approvalExpiresAt: result.approvalExpiresAt,
    },
  });
  await appendAuditEvent(tx, {
    eventType: 'POLICY_EVALUATED',
    actorType: ActorType.USER,
    actorId: actor.id,
    caseId: caseRow.id,
    payload: {
      decisionId: decision.id,
      policyVersion: policyRow.version,
      policyHash: policyRow.hash,
      evidenceHash: result.evidenceHash,
      disposition: result.disposition,
    },
    requestId: actor.requestId,
    traceId: actor.traceId,
    policyVersion: policyRow.version,
    policyHash: policyRow.hash,
  });
  if (
    caseRow.status === CaseStatus.INVESTIGATING ||
    caseRow.status === CaseStatus.AWAITING_EVIDENCE
  )
    await transitionCase(tx, caseRow.id, CaseStatus.AWAITING_APPROVAL, {
      type: ActorType.USER,
      id: actor.id,
      requestId: actor.requestId,
      ...(actor.traceId ? { traceId: actor.traceId } : {}),
    });
  return decision;
}
