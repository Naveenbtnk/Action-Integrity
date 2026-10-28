import { crossSourceCheck } from '@/lib/integrity/checks/cross-source-check';
import { enumCheck } from '@/lib/integrity/checks/enum-check';
import { freshnessCheck } from '@/lib/integrity/checks/freshness-check';
import { schemaCheck } from '@/lib/integrity/checks/schema-check';
import { semanticCheck } from '@/lib/integrity/checks/semantic-check';
import type { CheckInput, CheckResult } from '@/lib/integrity/types';

export function evaluateChecks(input: CheckInput): CheckResult[] {
  const results = [
    schemaCheck(input),
    input.contract.semanticDefinition.trim() ? semanticCheck(input) : enumCheck(input),
    freshnessCheck(input),
    crossSourceCheck(input),
  ];
  return results.filter((result): result is CheckResult => result !== null);
}
