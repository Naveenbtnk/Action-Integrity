import { IntegrityEventType, Severity } from '@/generated/prisma/enums';
import {
  accountIds,
  type CheckInput,
  type CheckResult,
  type IntegrityRecord,
} from '@/lib/integrity/types';

function updatedAt(record: IntegrityRecord, fallback: string): string {
  for (const key of ['sourceUpdatedAt', 'ingestedAt', 'lastSeenAt', 'sourceCreatedAt']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return fallback;
}

export function freshnessCheck({ contract, snapshot }: CheckInput): CheckResult | null {
  const captured = Date.parse(snapshot.capturedAt);
  const stale = snapshot.records.filter(
    (record) =>
      captured - Date.parse(updatedAt(record, snapshot.sourceUpdatedAt)) >
      contract.freshnessSlaSeconds * 1000,
  );
  if (stale.length === 0) return null;
  return {
    violated: true,
    checkType: IntegrityEventType.FRESHNESS,
    severity: Severity.HIGH,
    summary: `Source data for ${contract.key} exceeded its freshness limit.`,
    scopeSelector: { accountIds: accountIds(stale) },
    evidenceRefs: [],
  };
}
