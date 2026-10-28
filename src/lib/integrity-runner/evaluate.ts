import 'server-only';

import { trace } from '@opentelemetry/api';

import { Prisma } from '@/generated/prisma/client';
import { IntegrityEventStatus, IntegrityEventType } from '@/generated/prisma/enums';
import { getSource, isSourceKey } from '@/lib/adapters/registry';
import type { SourceKey } from '@/lib/adapters/types';
import { db } from '@/lib/db';
import { DependencyUnavailableError, ValidationError } from '@/lib/errors';
import { evaluateChecks } from '@/lib/integrity/evaluate';
import { sha } from '@/lib/integrity/hash';
import type { IntegritySnapshot } from '@/lib/integrity/types';
import { logger } from '@/lib/observability/logger';
import { withSpan } from '@/lib/observability/tracing';

const PAGE_SIZE = 1_000;

function recordTime(record: Record<string, string | number | null>): string | null {
  for (const field of ['sourceUpdatedAt', 'ingestedAt', 'lastSeenAt', 'sourceCreatedAt']) {
    if (typeof record[field] === 'string') return record[field];
  }
  return null;
}

export async function captureSource(sourceKey: SourceKey): Promise<IntegritySnapshot> {
  const source = getSource(sourceKey);
  const descriptor = await source.describe();
  const records: IntegritySnapshot['records'] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await source.fetchRecords({ cursor, limit: PAGE_SIZE });
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
    const last = page.at(-1);
    const next = sourceKey === 'account' ? last?.accountId : last?.recordRef;
    if (typeof next !== 'string' || next === cursor) throw new Error('SOURCE_CURSOR_INVALID');
    cursor = next;
  }
  if (records.length !== descriptor.rowCount) throw new Error('SOURCE_ROW_COUNT_CHANGED');
  const sourceUpdatedAt =
    records
      .map(recordTime)
      .filter((time): time is string => !!time)
      .sort()[0] ?? descriptor.capturedAt;
  return {
    sourceKey,
    schemaHash: descriptor.schemaHash,
    payloadHash: sha({ records }),
    capturedAt: descriptor.capturedAt,
    sourceUpdatedAt,
    records,
  };
}

type EvaluationEvent = {
  id: string;
  contractId: string;
  type: IntegrityEventType;
  severity: string;
  status: IntegrityEventStatus;
  scopeSelector: unknown;
  evidenceSnapshotIds: string[];
  fingerprint: string;
};
export type EvaluationResult = {
  evaluated: number;
  eventsCreated: number;
  eventsSuppressed: number;
  events: EvaluationEvent[];
};
type Capture = (sourceKey: SourceKey) => Promise<IntegritySnapshot>;

function relatedSourceKeys(invariants: unknown): SourceKey[] {
  if (!Array.isArray(invariants)) return [];
  const keys = invariants.map((rule) =>
    rule && typeof rule === 'object' ? rule.otherSource : null,
  );
  return [
    ...new Set(keys.filter((key): key is SourceKey => typeof key === 'string' && isSourceKey(key))),
  ];
}

export async function evaluateContracts(
  contractKeys?: string[],
  capture: Capture = captureSource,
): Promise<EvaluationResult> {
  const contracts = await db.dataContract.findMany({
    where: { status: 'ACTIVE', ...(contractKeys ? { key: { in: contractKeys } } : {}) },
    orderBy: { key: 'asc' },
  });
  if (contractKeys && contracts.length !== new Set(contractKeys).size)
    throw new ValidationError('Unknown or inactive contract key.');
  const result: EvaluationResult = {
    evaluated: 0,
    eventsCreated: 0,
    eventsSuppressed: 0,
    events: [],
  };
  const failed: string[] = [];
  return withSpan(
    'integrity.checks',
    { 'integrity.contract_count': contracts.length },
    async () => {
      for (const contract of contracts) {
        if (!isSourceKey(contract.sourceKey)) {
          failed.push(contract.key);
          continue;
        }
        try {
          const snapshot = await capture(contract.sourceKey);
          const relatedSnapshots = await Promise.all(
            relatedSourceKeys(contract.invariants).map(capture),
          );
          const checks = evaluateChecks({ contract, snapshot, relatedSnapshots });
          const persisted = await db.$transaction(
            async (tx) => {
              const snapshots = [snapshot, ...relatedSnapshots];
              const ids: Record<string, string> = {};
              for (const item of snapshots) {
                const payloadHash = item.payloadHash;
                await tx.sourceSnapshot.createMany({
                  data: [
                    {
                      sourceKey: item.sourceKey,
                      contractId: contract.id,
                      capturedAt: new Date(item.capturedAt),
                      sourceUpdatedAt: new Date(item.sourceUpdatedAt),
                      schemaHash: item.schemaHash,
                      payloadHash,
                      rowCount: item.records.length,
                      payload: { records: item.records } as Prisma.InputJsonObject,
                    },
                  ],
                  skipDuplicates: true,
                });
                const saved = await tx.sourceSnapshot.findUniqueOrThrow({
                  where: { contractId_payloadHash: { contractId: contract.id, payloadHash } },
                  select: { id: true },
                });
                ids[item.sourceKey] = saved.id;
              }
              let created = 0;
              let suppressed = 0;
              const events: EvaluationEvent[] = [];
              for (const check of checks) {
                const payloadHash =
                  check.checkType === IntegrityEventType.CROSS_SOURCE
                    ? sha([
                        snapshot.payloadHash,
                        ...relatedSnapshots.map((item) => item.payloadHash),
                      ])
                    : snapshot.payloadHash;
                const fingerprint = sha(`${contract.id}|${check.checkType}|${payloadHash}`);
                const evidenceSnapshotIds =
                  check.checkType === IntegrityEventType.CROSS_SOURCE
                    ? snapshots.map((item) => ids[item.sourceKey]!)
                    : [ids[snapshot.sourceKey]!];
                const inserted = await tx.integrityEvent.createMany({
                  data: [
                    {
                      contractId: contract.id,
                      type: check.checkType,
                      severity: check.severity,
                      detectedAt: new Date(),
                      summary: check.summary,
                      scopeSelector: check.scopeSelector,
                      evidenceSnapshotIds,
                      status: IntegrityEventStatus.OPEN,
                      fingerprint,
                    },
                  ],
                  skipDuplicates: true,
                });
                if (inserted.count) created += 1;
                else suppressed += 1;
                const event = await tx.integrityEvent.findUniqueOrThrow({
                  where: { fingerprint },
                  select: {
                    id: true,
                    contractId: true,
                    type: true,
                    severity: true,
                    status: true,
                    scopeSelector: true,
                    evidenceSnapshotIds: true,
                    fingerprint: true,
                  },
                });
                events.push(event);
              }
              return { created, suppressed, events };
            },
            { timeout: 30_000, maxWait: 10_000 },
          );
          result.evaluated += 1;
          result.eventsCreated += persisted.created;
          result.eventsSuppressed += persisted.suppressed;
          result.events.push(...persisted.events);
        } catch (cause) {
          failed.push(contract.key);
          logger.warn(
            {
              contractKey: contract.key,
              errorType: cause instanceof Error ? cause.name : 'unknown',
            },
            'integrity.contract_failed',
          );
        }
      }
      trace.getActiveSpan()?.setAttribute('integrity.events_created', result.eventsCreated);
      logger.info(
        {
          evaluated: result.evaluated,
          eventsCreated: result.eventsCreated,
          eventsSuppressed: result.eventsSuppressed,
          failed: failed.length,
        },
        'integrity.checks',
      );
      if (failed.length) throw new DependencyUnavailableError({ failedContractKeys: failed });
      return result;
    },
  );
}
