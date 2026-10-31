import { describe, expect, it } from 'vitest';

import type { DecisionSnapshot } from '@/lib/ui/decision-snapshot';
import { formatDecisionSnapshot } from '@/lib/ui/decision-snapshot';

const snapshot: DecisionSnapshot = {
  schemaVersion: 1,
  capturedAt: '2026-10-31T09:00:00.000Z',
  proofStatus: 'UNSIGNED_SNAPSHOT',
  case: {
    ref: 'AIC-1',
    title: 'Conflicting billing evidence',
    status: 'VERIFYING',
    openedAt: '2026-10-31T08:00:00.000Z',
  },
  integrityEvent: { type: 'SEMANTIC', summary: 'Source value changed meaning.' },
  evidence: [
    {
      kind: 'BILLING_RECORD',
      source: 'billing',
      ref: 'bill-1',
      stance: 'CONTRADICTS',
      excerpt: 'Value CURRENT; target still active.',
      capturedAt: '2026-10-31T08:01:00.000Z',
    },
  ],
  recommendation: {
    mode: 'AGENT',
    modelId: 'gemini-test',
    fallback: false,
    disposition: 'BLOCK',
    reasoning: 'Billing conflicts with contract.',
    hypotheses: [
      {
        statement: 'The source drifted.',
        verdict: 'SUPPORTED',
        supportingRefs: ['bill-1'],
        contradictingRefs: [],
      },
    ],
  },
  policy: {
    disposition: 'BLOCK',
    version: '2026.10.2',
    hash: 'sha256:policy',
    evidenceHash: 'sha256:evidence',
    riskScore: 40,
    requiredApprovals: 1,
  },
  approvals: [
    {
      reviewer: 'Reviewer',
      decision: 'APPROVE',
      status: 'VALID',
      rationale: 'Reviewed the records.',
      recordedAt: '2026-10-31T08:30:00.000Z',
    },
  ],
  execution: null,
  verification: null,
  timeline: [
    { sequence: '8', eventType: 'APPROVAL_RECORDED', recordedAt: '2026-10-31T08:30:00.000Z' },
  ],
};

describe('decision snapshot', () => {
  it('keeps recommendation, policy, approval and unverified outcome distinct', () => {
    const markdown = formatDecisionSnapshot(snapshot);
    expect(markdown).toContain('Unsigned operator snapshot');
    expect(markdown).toContain('## Agent recommendation');
    expect(markdown).toContain('## Deterministic policy decision');
    expect(markdown).toContain('Reviewer: APPROVE (VALID)');
    expect(markdown).toContain('Verification: not recorded');
    expect(markdown).not.toContain('Verification: passed');
  });

  it('escapes evidence text so it cannot insert a Markdown section', () => {
    const markdown = formatDecisionSnapshot({
      ...snapshot,
      evidence: [{ ...snapshot.evidence[0]!, excerpt: 'bad\n# Forged approval' }],
    });
    expect(markdown).toContain('bad \\# Forged approval');
    expect(markdown).not.toContain('\n# Forged approval');
  });
});
