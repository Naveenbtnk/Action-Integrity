import {
  Disposition,
  OutboundActionStatus,
  type OutboundActionType,
} from '@/generated/prisma/enums';
import { sha } from '@/lib/integrity/hash';
import type { PolicyConfig } from '@/lib/policy/config';
import { scoreRisk } from '@/lib/policy/risk';

const WRITES = new Set<Disposition>([Disposition.RELEASE_AFTER_CORRECTION, Disposition.COMPENSATE]);
export type PolicyInput = {
  caseRow: { exposureCount: number; estimatedValueMinor: bigint };
  report: {
    id: string;
    recommendedDisposition: Disposition;
    confidence: number;
    evidenceCompleteness: number;
    evidenceHash: string;
    isFallback: boolean;
  };
  action: {
    actionType: OutboundActionType;
    status: OutboundActionStatus;
    restorePointId: string | null;
  };
  policy: PolicyConfig;
  policyHash: string;
  now: Date;
};

export function evaluate(input: PolicyInput) {
  const { caseRow, report, action, policy } = input;
  const riskScore = scoreRisk({
    exposureCount: caseRow.exposureCount,
    estimatedValueMinor: caseRow.estimatedValueMinor,
    confidence: report.confidence,
    evidenceCompleteness: report.evidenceCompleteness,
    actionType: action.actionType,
    hasRestorePoint: !!action.restorePointId,
  });
  const reasons: string[] = [];
  let allowedDispositions = [...policy.allowedDispositions[action.actionType]];
  let disposition = report.recommendedDisposition;
  if (report.evidenceCompleteness < policy.evidenceCompletenessMinimum) {
    disposition = Disposition.HOLD_FOR_EVIDENCE;
    allowedDispositions = allowedDispositions.filter((value) => !WRITES.has(value));
    reasons.push('EVIDENCE_INCOMPLETE');
  } else if (report.confidence < policy.confidenceMinimum) {
    disposition = Disposition.ESCALATE;
    reasons.push('LOW_CONFIDENCE');
  } else {
    if (disposition === Disposition.BLOCK && action.status === OutboundActionStatus.EXECUTED)
      disposition = Disposition.COMPENSATE;
    if (disposition === Disposition.COMPENSATE && action.status === OutboundActionStatus.HELD)
      disposition = Disposition.BLOCK;
    if (disposition === Disposition.COMPENSATE && !action.restorePointId)
      disposition = Disposition.SAFE_REFUSAL;
    if (!allowedDispositions.includes(disposition)) {
      disposition = allowedDispositions.includes(Disposition.SAFE_REFUSAL)
        ? Disposition.SAFE_REFUSAL
        : Disposition.ESCALATE;
      reasons.push('RECOMMENDATION_CONSTRAINED');
    }
  }
  const write = WRITES.has(disposition);
  const highRisk =
    write &&
    (riskScore >= policy.riskBands.highRisk ||
      caseRow.exposureCount >= policy.quorum.exposureThreshold);
  const requiredApprovals = highRisk ? policy.quorum.highRiskApprovals : 1;
  return {
    riskScore,
    riskBand:
      riskScore >= policy.riskBands.highRisk
        ? 'HIGH'
        : riskScore >= policy.riskBands.approvalRequired
          ? 'MEDIUM'
          : 'LOW',
    disposition,
    allowedDispositions,
    approvalRequired: true,
    requiredApprovals,
    requiredRoles: highRisk ? ['SENIOR_REVIEWER'] : [],
    approvalExpiresAt: new Date(
      input.now.getTime() + policy.quorum.approvalWindowHours * 3_600_000,
    ),
    reasons,
    policyHash: input.policyHash,
    evidenceHash: report.evidenceHash,
    inputsHash: sha({
      caseRow: {
        exposureCount: caseRow.exposureCount,
        estimatedValueMinor: caseRow.estimatedValueMinor.toString(),
      },
      report: {
        id: report.id,
        confidence: report.confidence,
        evidenceCompleteness: report.evidenceCompleteness,
        evidenceHash: report.evidenceHash,
      },
      action,
      policyHash: input.policyHash,
    }),
    isFallback: report.isFallback,
  };
}
