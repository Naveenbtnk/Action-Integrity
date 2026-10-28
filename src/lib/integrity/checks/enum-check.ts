import { IntegrityEventType, Severity } from '@/generated/prisma/enums';
import {
  accountIds,
  aliasMap,
  valueAt,
  type CheckInput,
  type CheckResult,
} from '@/lib/integrity/types';

export function enumCheck({ contract, snapshot }: CheckInput): CheckResult | null {
  const allowed = new Set([
    ...contract.expectedValues,
    ...Object.keys(aliasMap(contract.aliasMap)),
  ]);
  const invalid = snapshot.records.filter(
    (record) => !allowed.has(String(valueAt(record, contract.fieldPath))),
  );
  if (invalid.length === 0) return null;
  return {
    violated: true,
    checkType: IntegrityEventType.ENUM,
    severity: Severity.HIGH,
    summary: `Observed values outside enum contract ${contract.key}.`,
    scopeSelector: {
      accountIds: accountIds(invalid),
      values: [
        ...new Set(invalid.map((record) => String(valueAt(record, contract.fieldPath)))),
      ].sort(),
    },
    evidenceRefs: [],
  };
}
