import type { IntegrityEventType, Severity } from '@/generated/prisma/enums';

export type IntegrityRecord = Readonly<Record<string, string | number | null>>;
export type ContractDefinition = {
  id: string;
  key: string;
  sourceKey: string;
  fieldPath: string;
  schemaHash: string;
  requiredFields: string[];
  semanticDefinition: string;
  expectedValues: string[];
  aliasMap: unknown;
  invariants: unknown;
  freshnessSlaSeconds: number;
};
export type IntegritySnapshot = {
  sourceKey: string;
  schemaHash: string;
  payloadHash: string;
  capturedAt: string;
  sourceUpdatedAt: string;
  records: IntegrityRecord[];
};
export type CheckInput = {
  contract: ContractDefinition;
  snapshot: IntegritySnapshot;
  relatedSnapshots?: IntegritySnapshot[];
};
export type CheckResult = {
  violated: true;
  checkType: IntegrityEventType;
  severity: Severity;
  summary: string;
  scopeSelector: { accountIds: string[]; values?: string[] };
  evidenceRefs: string[];
};

export function accountIds(records: IntegrityRecord[]): string[] {
  return [
    ...new Set(
      records
        .map((record) => record.accountId)
        .filter((value): value is string => typeof value === 'string'),
    ),
  ].sort();
}
export function valueAt(record: IntegrityRecord, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      record,
    );
}
export function aliasMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
