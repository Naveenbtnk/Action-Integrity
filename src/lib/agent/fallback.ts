import { Disposition, EvidenceKind, HypothesisVerdict } from '@/generated/prisma/enums';
import type { EvidenceBundle, EvidenceRef, InvestigationReportInput } from '@/lib/agent/types';

const INSTRUCTION_PATTERN =
  /ignore (?:all |any )?(?:previous |prior )?instructions|approve (?:this|the) action|bypass (?:the )?(?:gate|policy)/i;

export function suspiciousEvidence(evidence: EvidenceRef[]): string[] {
  return evidence
    .filter((item) => INSTRUCTION_PATTERN.test(item.excerpt))
    .map((item) => `Instruction-like content in ${item.kind}:${item.ref}`);
}

export function deterministicInvestigation(bundle: EvidenceBundle): InvestigationReportInput {
  const contract = bundle.evidence.find((item) => item.kind === EvidenceKind.CONTRACT_RECORD);
  const billing = bundle.evidence.find((item) => item.kind === EvidenceKind.BILLING_RECORD);
  const clean = bundle.evidence.filter((item) => !INSTRUCTION_PATTERN.test(item.excerpt));
  const suspiciousContent = suspiciousEvidence(bundle.evidence);
  const payload =
    bundle.actionPayload && typeof bundle.actionPayload === 'object'
      ? (bundle.actionPayload as Record<string, unknown>)
      : {};
  const revoke = bundle.actionType === 'ENTITLEMENT_REVOKE' && payload.to === 'REMOVED';
  const contractActive = !!contract && /\bACTIVE\b/i.test(contract.excerpt);
  const billingCurrent = !!billing && /\bCURRENT\b/i.test(billing.excerpt);
  const cited = [contract, billing].filter((item): item is EvidenceRef => !!item);

  if (revoke && contractActive && billingCurrent) {
    const ownerConfirmed = bundle.evidence.some(
      (item) =>
        item.kind === EvidenceKind.OWNER_CONFIRMATION && !INSTRUCTION_PATTERN.test(item.excerpt),
    );
    return {
      recommendedDisposition: Disposition.BLOCK,
      confidence: 0.92,
      evidenceCompleteness: ownerConfirmed ? 1 : 0.75,
      reasoning:
        'The active contract contradicts the proposed entitlement revocation; billing uses a semantically drifted status. The action should remain held for a governed block decision.',
      hypotheses: [
        {
          statement: 'The entitlement remains contractually active.',
          confidence: 0.95,
          verdict: HypothesisVerdict.SUPPORTED,
          supportingRefs: [contract.ref],
          contradictingRefs: [],
        },
        {
          statement:
            'The billing status was interpreted as a revocation trigger despite indicating a current subscription.',
          confidence: 0.9,
          verdict: HypothesisVerdict.SUPPORTED,
          supportingRefs: [billing.ref],
          contradictingRefs: [],
        },
      ],
      missingEvidence: ownerConfirmed ? [] : ['Owner confirmation of active entitlement'],
      citations: cited.map(({ kind, ref, excerpt }) => ({
        kind,
        ref,
        excerpt: excerpt.slice(0, 500),
      })),
      suspiciousContent,
    };
  }
  const stale = clean.some((item) => /\bstale\b|\bexpired\b/i.test(item.excerpt));
  const conflict =
    bundle.eventType === 'SEMANTIC' || clean.some((item) => item.stance === 'CONTRADICTS');
  const disposition =
    stale || conflict
      ? Disposition.HOLD_FOR_EVIDENCE
      : clean.length >= 2 && clean.every((item) => item.stance === 'SUPPORTS')
        ? Disposition.RELEASE_AFTER_CORRECTION
        : Disposition.ESCALATE;
  return {
    recommendedDisposition: disposition,
    confidence: disposition === Disposition.RELEASE_AFTER_CORRECTION ? 0.7 : 0.45,
    evidenceCompleteness: Math.min(clean.length / 3, 1),
    reasoning: stale
      ? 'Source evidence is stale; obtain a current record.'
      : conflict
        ? 'Sources conflict without an authoritative winner.'
        : clean.length >= 2
          ? 'Available sources agree, subject to policy and human approval.'
          : 'The action cannot be mapped to enough evidence for a safe recommendation.',
    hypotheses: [
      {
        statement: stale
          ? 'The evidence is stale.'
          : 'The available records require further review.',
        confidence: 0.5,
        verdict: HypothesisVerdict.OPEN,
        supportingRefs: clean.slice(0, 2).map((item) => item.ref),
        contradictingRefs: [],
      },
    ],
    missingEvidence:
      disposition === Disposition.HOLD_FOR_EVIDENCE
        ? ['Current authoritative owner confirmation']
        : [],
    citations: clean
      .slice(0, 3)
      .map(({ kind, ref, excerpt }) => ({ kind, ref, excerpt: excerpt.slice(0, 500) })),
    suspiciousContent,
  };
}
