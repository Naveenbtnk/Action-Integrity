import { IntegrityEventType, Severity } from '@/generated/prisma/enums';
import {
  accountIds,
  aliasMap,
  valueAt,
  type CheckInput,
  type CheckResult,
} from '@/lib/integrity/types';

export function semanticCheck({ contract, snapshot }: CheckInput): CheckResult | null {
  const expected = new Set(contract.expectedValues);
  const aliases = aliasMap(contract.aliasMap);
  const invalid = snapshot.records.filter((record) => {
    const observed = String(valueAt(record, contract.fieldPath));
    return !expected.has(observed) && !expected.has(aliases[observed] ?? '');
  });
  if (invalid.length === 0) return null;
  return {
    violated: true,
    checkType: IntegrityEventType.SEMANTIC,
    severity: Severity.HIGH,
    summary: `Observed values violate the business meaning of ${contract.key}.`,
    scopeSelector: {
      accountIds: accountIds(invalid),
      values: [
        ...new Set(invalid.map((record) => String(valueAt(record, contract.fieldPath)))),
      ].sort(),
    },
    evidenceRefs: [],
  };
}
