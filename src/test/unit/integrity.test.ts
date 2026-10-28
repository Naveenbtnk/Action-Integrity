import { describe, expect, it } from 'vitest';

import { evaluateChecks } from '@/lib/integrity/evaluate';
import type { CheckInput } from '@/lib/integrity/types';

const capturedAt = '2026-10-28T00:00:00.000Z';
function input(records: CheckInput['snapshot']['records']): CheckInput {
  return {
    contract: {
      id: 'contract-1',
      key: 'billing.plan_status',
      sourceKey: 'billing',
      fieldPath: 'planStatus',
      schemaHash: 'schema-1',
      requiredFields: ['accountId', 'planStatus'],
      semanticDefinition: 'ACTIVE means current.',
      expectedValues: ['ACTIVE', 'SUSPENDED'],
      aliasMap: {},
      invariants: [],
      freshnessSlaSeconds: 86_400,
    },
    snapshot: {
      sourceKey: 'billing',
      schemaHash: 'schema-1',
      payloadHash: 'payload-1',
      capturedAt,
      sourceUpdatedAt: capturedAt,
      records,
    },
  };
}

describe('pure integrity checks', () => {
  it('emits one semantic violation for CURRENT with affected account and no enum duplicate', () => {
    const results = evaluateChecks(
      input([{ accountId: 'acc_42', planStatus: 'CURRENT', sourceUpdatedAt: capturedAt }]),
    );
    expect(results.map((result) => result.checkType)).toEqual(['SEMANTIC']);
    expect(results[0]?.scopeSelector.accountIds).toEqual(['acc_42']);
  });

  it('emits nothing for a fresh unchanged meaning', () => {
    expect(
      evaluateChecks(
        input([{ accountId: 'acc_42', planStatus: 'ACTIVE', sourceUpdatedAt: capturedAt }]),
      ),
    ).toEqual([]);
  });

  it('accepts only aliases that map to an expected semantic value', () => {
    const sample = input([
      { accountId: 'acc_42', planStatus: 'CURRENT', sourceUpdatedAt: capturedAt },
    ]);
    sample.contract.aliasMap = { CURRENT: 'ACTIVE' };
    expect(evaluateChecks(sample)).toEqual([]);
    sample.contract.aliasMap = { CURRENT: 'UNKNOWN' };
    expect(evaluateChecks(sample).map((result) => result.checkType)).toEqual(['SEMANTIC']);
  });

  it('detects an old source once', () => {
    const sample = input([
      { accountId: 'acc_42', planStatus: 'ACTIVE', sourceUpdatedAt: '2026-10-25T00:00:00.000Z' },
    ]);
    expect(evaluateChecks(sample).map((result) => result.checkType)).toEqual(['FRESHNESS']);
  });

  it('detects billing ACTIVE against contract SUSPENDED', () => {
    const sample = input([{ accountId: 'acc_42', status: 'SUSPENDED', ingestedAt: capturedAt }]);
    sample.contract = {
      ...sample.contract,
      key: 'contract.entitlement_status',
      sourceKey: 'contract',
      fieldPath: 'status',
      requiredFields: ['accountId', 'status'],
      expectedValues: ['ACTIVE', 'SUSPENDED'],
      semanticDefinition: '',
      invariants: [{ otherSource: 'billing', rule: 'billing_active_requires_contract_active' }],
    };
    sample.snapshot.sourceKey = 'contract';
    sample.relatedSnapshots = [
      {
        sourceKey: 'billing',
        schemaHash: 'billing-schema',
        payloadHash: 'billing-payload',
        capturedAt,
        sourceUpdatedAt: capturedAt,
        records: [{ accountId: 'acc_42', planStatus: 'ACTIVE' }],
      },
    ];
    expect(evaluateChecks(sample).map((result) => result.checkType)).toEqual(['CROSS_SOURCE']);
  });

  it('detects missing fields and a schema hash mismatch as one schema event', () => {
    const sample = input([{ accountId: 'acc_42', sourceUpdatedAt: capturedAt }]);
    sample.snapshot.schemaHash = 'other';
    expect(evaluateChecks(sample).filter((result) => result.checkType === 'SCHEMA')).toHaveLength(
      1,
    );
  });
});
