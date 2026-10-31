import 'server-only';

import type { getCase } from '@/lib/gate/queries';
import type { DecisionSnapshot } from '@/lib/ui/decision-snapshot';

type CaseDetail = Awaited<ReturnType<typeof getCase>>;

export function buildDecisionSnapshot(detail: CaseDetail, capturedAt: Date): DecisionSnapshot {
  const row = detail.case;
  const report = detail.investigation;
  const policy = detail.policy;
  const execution = detail.execution[0];
  const verification = detail.verifications[0];
  return {
    schemaVersion: 1,
    capturedAt: capturedAt.toISOString(),
    proofStatus: 'UNSIGNED_SNAPSHOT',
    case: {
      ref: row.ref,
      title: row.title,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
    },
    integrityEvent: { type: detail.event.type, summary: detail.event.summary },
    evidence: detail.evidence.map((item) => ({
      kind: item.kind,
      source: item.sourceKey,
      ref: item.recordRef,
      stance: item.stance,
      excerpt: item.excerpt,
      capturedAt: item.capturedAt.toISOString(),
    })),
    recommendation: report
      ? {
          mode: report.mode,
          modelId: report.modelId,
          fallback: report.isFallback,
          disposition: report.recommendedDisposition,
          reasoning: report.reasoning,
          hypotheses: report.hypotheses.map((item) => ({
            statement: item.statement,
            verdict: item.verdict,
            supportingRefs: item.supportingRefs,
            contradictingRefs: item.contradictingRefs,
          })),
        }
      : null,
    policy: policy
      ? {
          disposition: policy.disposition,
          version: policy.policyVersion,
          hash: policy.policyHash,
          evidenceHash: policy.evidenceHash,
          riskScore: policy.riskScore,
          requiredApprovals: policy.requiredApprovals,
        }
      : null,
    approvals: detail.approvals.map((item) => ({
      reviewer: item.reviewer.name,
      decision: item.decision,
      status: item.status,
      rationale: item.rationale,
      recordedAt: item.createdAt.toISOString(),
    })),
    execution: execution ? { kind: execution.kind, status: execution.status } : null,
    verification: verification
      ? {
          passed: verification.passed,
          checkedAt: verification.checkedAt.toISOString(),
          expectedState: verification.expectedState,
          observedState: verification.observedState,
          mismatches: verification.mismatches,
        }
      : null,
    timeline: detail.timeline.map((item) => ({
      sequence: item.seq,
      eventType: item.eventType,
      recordedAt: item.createdAt.toISOString(),
    })),
  };
}
