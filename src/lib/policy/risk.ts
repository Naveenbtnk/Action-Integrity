import type { OutboundActionType } from '@/generated/prisma/enums';

export type RiskInput = {
  exposureCount: number;
  estimatedValueMinor: bigint | number;
  confidence: number;
  evidenceCompleteness: number;
  actionType: OutboundActionType;
  hasRestorePoint: boolean;
};

/** Weights: exposure 30, value 25, confidence gap 15, evidence gap 15,
 * irreversible action 10, missing restore point 5. Rounded, clamped 0..100. */
export function scoreRisk(input: RiskInput): number {
  const fraction = (value: number) => Math.max(0, Math.min(1, value));
  const value = Number(input.estimatedValueMinor);
  const score =
    30 * fraction(input.exposureCount / 250) +
    25 * fraction(value / 2_500_000) +
    15 * (1 - fraction(input.confidence)) +
    15 * (1 - fraction(input.evidenceCompleteness)) +
    (input.actionType === 'ACCOUNT_STATUS_CHANGE' ? 10 : 0) +
    (input.hasRestorePoint ? 0 : 5);
  return Math.max(0, Math.min(100, Math.round(score)));
}
