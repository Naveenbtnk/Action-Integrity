import { IntegrityEventType, Severity } from '@/generated/prisma/enums';
import { accountIds, type CheckInput, type CheckResult } from '@/lib/integrity/types';

export function crossSourceCheck({
  contract,
  snapshot,
  relatedSnapshots = [],
}: CheckInput): CheckResult | null {
  const rules = Array.isArray(contract.invariants) ? contract.invariants : [];
  if (
    !rules.some(
      (rule) =>
        rule &&
        typeof rule === 'object' &&
        rule.rule === 'billing_active_requires_contract_active' &&
        rule.otherSource === 'billing',
    )
  )
    return null;
  const billing = relatedSnapshots.find((related) => related.sourceKey === 'billing');
  if (!billing) return null;
  const active = new Set(
    billing.records
      .filter((record) => record.planStatus === 'ACTIVE')
      .map((record) => record.accountId),
  );
  const conflicting = snapshot.records.filter(
    (record) => record.status === 'SUSPENDED' && active.has(record.accountId),
  );
  if (conflicting.length === 0) return null;
  return {
    violated: true,
    checkType: IntegrityEventType.CROSS_SOURCE,
    severity: Severity.HIGH,
    summary: `Billing and contract status disagree for ${contract.key}.`,
    scopeSelector: { accountIds: accountIds(conflicting) },
    evidenceRefs: [],
  };
}
