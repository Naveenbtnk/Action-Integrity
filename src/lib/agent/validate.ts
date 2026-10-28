import type { EvidenceRef, InvestigationReportInput } from '@/lib/agent/types';
import { InvestigationReportSchema } from '@/lib/agent/types';

export function validateReport(raw: unknown, evidence: EvidenceRef[]) {
  const report = InvestigationReportSchema.parse(raw);
  const allowed = new Set(evidence.map((item) => `${item.kind}:${item.ref}`));
  const refs = new Set(evidence.map((item) => item.ref));
  const citations = report.citations.filter((item) => allowed.has(`${item.kind}:${item.ref}`));
  const hypotheses = report.hypotheses.map((hypothesis) => ({
    ...hypothesis,
    supportingRefs: hypothesis.supportingRefs.filter((ref) => refs.has(ref)),
    contradictingRefs: hypothesis.contradictingRefs.filter((ref) => refs.has(ref)),
  }));
  const uncitedClaims =
    citations.length !== report.citations.length ||
    hypotheses.some(
      (item, index) =>
        item.supportingRefs.length !== report.hypotheses[index]?.supportingRefs.length ||
        item.contradictingRefs.length !== report.hypotheses[index]?.contradictingRefs.length,
    ) ||
    citations.length === 0;
  return {
    ...report,
    citations,
    hypotheses,
    confidence: uncitedClaims ? Math.min(report.confidence, 0.5) : report.confidence,
    uncitedClaims,
  } satisfies InvestigationReportInput & { uncitedClaims: boolean };
}
