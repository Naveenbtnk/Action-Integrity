export interface DecisionSnapshot {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly proofStatus: 'UNSIGNED_SNAPSHOT';
  readonly case: {
    readonly ref: string;
    readonly title: string;
    readonly status: string;
    readonly openedAt: string;
  };
  readonly integrityEvent: { readonly type: string; readonly summary: string };
  readonly evidence: ReadonlyArray<{
    readonly kind: string;
    readonly source: string;
    readonly ref: string;
    readonly stance: string;
    readonly excerpt: string;
    readonly capturedAt: string;
  }>;
  readonly recommendation: null | {
    readonly mode: string;
    readonly modelId: string | null;
    readonly fallback: boolean;
    readonly disposition: string;
    readonly reasoning: string;
    readonly hypotheses: ReadonlyArray<{
      readonly statement: string;
      readonly verdict: string;
      readonly supportingRefs: readonly string[];
      readonly contradictingRefs: readonly string[];
    }>;
  };
  readonly policy: null | {
    readonly disposition: string;
    readonly version: string;
    readonly hash: string;
    readonly evidenceHash: string;
    readonly riskScore: number;
    readonly requiredApprovals: number;
  };
  readonly approvals: ReadonlyArray<{
    readonly reviewer: string;
    readonly decision: string;
    readonly status: string;
    readonly rationale: string;
    readonly recordedAt: string;
  }>;
  readonly execution: null | { readonly kind: string; readonly status: string };
  readonly verification: null | {
    readonly passed: boolean;
    readonly checkedAt: string;
    readonly expectedState: unknown;
    readonly observedState: unknown;
    readonly mismatches: unknown;
  };
  readonly timeline: ReadonlyArray<{
    readonly sequence: string;
    readonly eventType: string;
    readonly recordedAt: string;
  }>;
}

function markdownText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/([\\`*_{}\[\]()#+.!>|-])/g, '\\$1');
}

export function formatDecisionSnapshot(snapshot: DecisionSnapshot): string {
  const lines = [
    `# Case ${markdownText(snapshot.case.ref)}`,
    '',
    '**Unsigned operator snapshot.** Read the live case for current state. This file is not an audit-chain proof.',
    '',
    `- Captured: ${snapshot.capturedAt}`,
    `- Title: ${markdownText(snapshot.case.title)}`,
    `- Status: ${markdownText(snapshot.case.status)}`,
    `- Opened: ${snapshot.case.openedAt}`,
    `- Integrity signal: ${markdownText(snapshot.integrityEvent.type)}`,
    `- Summary: ${markdownText(snapshot.integrityEvent.summary)}`,
    '',
    '## Evidence',
    '',
    ...(snapshot.evidence.length
      ? snapshot.evidence.map(
          (item) =>
            `- ${markdownText(item.kind)} / ${markdownText(item.source)} / ${markdownText(item.ref)} (${markdownText(item.stance)}): ${markdownText(item.excerpt)}`,
        )
      : ['- None recorded']),
    '',
    '## Agent recommendation',
    '',
    snapshot.recommendation
      ? `- ${markdownText(snapshot.recommendation.disposition)} (${snapshot.recommendation.fallback ? 'deterministic fallback' : markdownText(snapshot.recommendation.mode)})`
      : '- None recorded',
  ];
  if (snapshot.recommendation) {
    lines.push(`- Reasoning: ${markdownText(snapshot.recommendation.reasoning)}`);
    for (const hypothesis of snapshot.recommendation.hypotheses)
      lines.push(
        `- Hypothesis (${markdownText(hypothesis.verdict)}): ${markdownText(hypothesis.statement)}; supports ${markdownText(hypothesis.supportingRefs.join(', ') || 'none')}; contradicts ${markdownText(hypothesis.contradictingRefs.join(', ') || 'none')}`,
      );
  }
  lines.push('', '## Deterministic policy decision', '');
  if (snapshot.policy) {
    lines.push(
      `- Disposition: ${markdownText(snapshot.policy.disposition)}`,
      `- Version: ${markdownText(snapshot.policy.version)}`,
      `- Policy hash: ${snapshot.policy.hash}`,
      `- Evidence hash: ${snapshot.policy.evidenceHash}`,
      `- Risk score: ${snapshot.policy.riskScore}`,
      `- Required approvals: ${snapshot.policy.requiredApprovals}`,
    );
  } else lines.push('- None recorded');
  lines.push('', '## Human decisions', '');
  if (snapshot.approvals.length)
    for (const approval of snapshot.approvals)
      lines.push(
        `- ${markdownText(approval.reviewer)}: ${markdownText(approval.decision)} (${markdownText(approval.status)}), ${approval.recordedAt}. ${markdownText(approval.rationale)}`,
      );
  else lines.push('- None recorded');
  lines.push('', '## Outcome', '');
  lines.push(
    snapshot.execution
      ? `- Execution: ${markdownText(snapshot.execution.kind)} / ${markdownText(snapshot.execution.status)}`
      : '- Execution: none recorded',
    snapshot.verification
      ? `- Verification: ${snapshot.verification.passed ? 'passed' : 'failed'} at ${snapshot.verification.checkedAt}`
      : '- Verification: not recorded',
    '',
    '## Timeline',
    '',
    ...snapshot.timeline.map(
      (event) => `- #${event.sequence} ${event.recordedAt}: ${markdownText(event.eventType)}`,
    ),
    '',
  );
  return lines.join('\n');
}
