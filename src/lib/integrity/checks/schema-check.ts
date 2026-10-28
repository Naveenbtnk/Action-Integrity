import { IntegrityEventType, Severity } from '@/generated/prisma/enums';
import { accountIds, valueAt, type CheckInput, type CheckResult } from '@/lib/integrity/types';

export function schemaCheck({ contract, snapshot }: CheckInput): CheckResult | null {
  const missing = snapshot.records.filter((record) =>
    contract.requiredFields.some(
      (field) => valueAt(record, field) === undefined || valueAt(record, field) === null,
    ),
  );
  if (contract.schemaHash === snapshot.schemaHash && missing.length === 0) return null;
  return {
    violated: true,
    checkType: IntegrityEventType.SCHEMA,
    severity: Severity.HIGH,
    summary: `Schema contract ${contract.key} does not match the source projection.`,
    scopeSelector: { accountIds: accountIds(missing.length ? missing : snapshot.records) },
    evidenceRefs: [],
  };
}
