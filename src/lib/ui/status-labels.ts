export const statusLabels: Record<string, string> = {
  HOLDING: 'Holding',
  AWAITING_EVIDENCE: 'Awaiting evidence',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  EXECUTING: 'Executing',
  VERIFYING: 'Awaiting verification',
  CLOSED_RESOLVED: 'Closed · verified',
  REOPENED: 'Reopened',
  ESCALATED: 'Escalated',
  SAFE_REFUSAL: 'Safe refusal',
  REJECTED: 'Rejected',
  PENDING: 'Pending',
  HELD: 'Held',
  BLOCKED: 'Blocked',
  EXECUTED: 'Executed',
  RELEASED: 'Released',
  UNKNOWN: 'Outcome unconfirmed',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
};

export function statusLabel(value: string): string {
  return statusLabels[value] ?? value.replaceAll('_', ' ').toLowerCase();
}
