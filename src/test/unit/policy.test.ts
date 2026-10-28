import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Disposition, OutboundActionStatus, OutboundActionType } from '@/generated/prisma/enums';
import { evaluate } from '@/lib/policy/evaluate';
import { scoreRisk } from '@/lib/policy/risk';

const policy = {
  version: '2026.10.2',
  exposureWindowHours: 24,
  evidenceCompletenessMinimum: 0.8,
  confidenceMinimum: 0.7,
  riskBands: { approvalRequired: 40, highRisk: 70 },
  quorum: { highRiskApprovals: 2, exposureThreshold: 250, approvalWindowHours: 12 },
  valueThresholdsMinor: { mandatoryApproval: 2_500_000 },
  irreversibleActionTypes: [OutboundActionType.ACCOUNT_STATUS_CHANGE],
  allowedDispositions: {
    ENTITLEMENT_REVOKE: [
      Disposition.BLOCK,
      Disposition.HOLD_FOR_EVIDENCE,
      Disposition.RELEASE_AFTER_CORRECTION,
      Disposition.COMPENSATE,
      Disposition.ESCALATE,
      Disposition.SAFE_REFUSAL,
    ],
    ENTITLEMENT_GRANT: [
      Disposition.BLOCK,
      Disposition.HOLD_FOR_EVIDENCE,
      Disposition.RELEASE_AFTER_CORRECTION,
      Disposition.ESCALATE,
      Disposition.SAFE_REFUSAL,
    ],
    ACCOUNT_STATUS_CHANGE: [
      Disposition.BLOCK,
      Disposition.HOLD_FOR_EVIDENCE,
      Disposition.COMPENSATE,
      Disposition.ESCALATE,
      Disposition.SAFE_REFUSAL,
    ],
  },
};
const base = {
  caseRow: { exposureCount: 1, estimatedValueMinor: 0n },
  report: {
    id: 'report',
    recommendedDisposition: Disposition.RELEASE_AFTER_CORRECTION,
    confidence: 1,
    evidenceCompleteness: 1,
    evidenceHash: 'hash',
    isFallback: false,
  },
  action: {
    actionType: OutboundActionType.ENTITLEMENT_REVOKE,
    status: OutboundActionStatus.HELD,
    restorePointId: 'restore',
  },
  policy,
  policyHash: 'sha256:policy',
  now: new Date('2026-10-28T00:00:00Z'),
};

describe('policy risk and disposition', () => {
  it('keeps the policy module outside agent and adapter imports', () => {
    const directory = join(process.cwd(), 'src', 'lib', 'policy');
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(directory, file), 'utf8');
      expect(source).not.toMatch(/from ['"]@\/lib\/(agent|adapters)/);
    }
  });
  it('has exact approval and high-risk boundaries', () => {
    const input = {
      exposureCount: 242,
      estimatedValueMinor: 1_000_000n,
      confidence: 1,
      evidenceCompleteness: 1,
      actionType: OutboundActionType.ENTITLEMENT_REVOKE,
      hasRestorePoint: true,
    };
    expect(scoreRisk(input)).toBe(39);
    expect(scoreRisk({ ...input, exposureCount: 250 })).toBe(40);
    expect(
      scoreRisk({
        ...input,
        exposureCount: 250,
        estimatedValueMinor: 2_500_000n,
        confidence: 0.07,
      }),
    ).toBe(69);
    expect(
      scoreRisk({ ...input, exposureCount: 250, estimatedValueMinor: 2_500_000n, confidence: 0 }),
    ).toBe(70);
  });
  it('holds incomplete evidence and removes write dispositions', () => {
    const result = evaluate({ ...base, report: { ...base.report, evidenceCompleteness: 0.6 } });
    expect(result.disposition).toBe(Disposition.HOLD_FOR_EVIDENCE);
    expect(result.allowedDispositions).not.toContain(Disposition.RELEASE_AFTER_CORRECTION);
    expect(result.allowedDispositions).not.toContain(Disposition.COMPENSATE);
  });
  it('requires two reviewers and a senior for a high-risk write', () => {
    const result = evaluate({
      ...base,
      caseRow: { exposureCount: 250, estimatedValueMinor: 2_500_000n },
    });
    expect(result.requiredApprovals).toBe(2);
    expect(result.requiredRoles).toEqual(['SENIOR_REVIEWER']);
  });
  it('never compensates without a restore point', () => {
    const result = evaluate({
      ...base,
      report: { ...base.report, recommendedDisposition: Disposition.COMPENSATE },
      action: { ...base.action, status: OutboundActionStatus.EXECUTED, restorePointId: null },
    });
    expect(result.disposition).toBe(Disposition.SAFE_REFUSAL);
  });
  it('escalates a low-confidence recommendation', () => {
    const result = evaluate({ ...base, report: { ...base.report, confidence: 0.69 } });
    expect(result.disposition).toBe(Disposition.ESCALATE);
    expect(result.approvalRequired).toBe(true);
  });
  it('converts a block on an executed action into compensation when restore exists', () => {
    const result = evaluate({
      ...base,
      report: { ...base.report, recommendedDisposition: Disposition.BLOCK },
      action: { ...base.action, status: OutboundActionStatus.EXECUTED },
    });
    expect(result.disposition).toBe(Disposition.COMPENSATE);
  });
});
