import { AlertTriangle, Check, Circle, ShieldAlert } from 'lucide-react';

import { statusLabel } from '@/lib/ui/status-labels';

const warning = new Set(['UNKNOWN', 'AWAITING_EVIDENCE', 'AWAITING_APPROVAL', 'VERIFYING']);
const danger = new Set(['REOPENED', 'ESCALATED', 'FAILED', 'SAFE_REFUSAL', 'REJECTED']);
const success = new Set(['CLOSED_RESOLVED', 'SUCCEEDED', 'BLOCKED']);

export function StateBadge({ value }: { readonly value: string }) {
  const Icon = danger.has(value)
    ? ShieldAlert
    : warning.has(value)
      ? AlertTriangle
      : success.has(value)
        ? Check
        : Circle;
  const tone = danger.has(value)
    ? 'text-primary border-primary/40'
    : warning.has(value)
      ? 'text-operational-warning border-operational-warning/40'
      : success.has(value)
        ? 'text-operational-success border-operational-success/40'
        : 'text-operational-info border-operational-info/40';
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {statusLabel(value)}
    </span>
  );
}
