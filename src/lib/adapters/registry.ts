import 'server-only';

import { createHash } from 'node:crypto';

import type { SourceAdapter, SourceDescriptor, SourceKey, SourceQuery } from '@/lib/adapters/types';
import { db } from '@/lib/db';

const fields: Record<SourceKey, Record<string, string>> = {
  contract: {
    recordRef: 'string',
    accountId: 'string',
    entitlementKey: 'string',
    status: 'enum',
    contractVersion: 'string',
    effectiveFrom: 'datetime',
    effectiveTo: 'datetime|null',
    ingestedAt: 'datetime',
  },
  billing: {
    recordRef: 'string',
    accountId: 'string',
    planCode: 'string',
    planStatus: 'string',
    seats: 'integer',
    mrrMinor: 'decimal-string',
    periodStart: 'datetime',
    periodEnd: 'datetime',
    sourceUpdatedAt: 'datetime',
  },
  usage: {
    recordRef: 'string',
    accountId: 'string',
    featureKey: 'string',
    eventDate: 'date',
    eventCount: 'integer',
    lastSeenAt: 'datetime',
  },
  support: {
    recordRef: 'string',
    accountId: 'string',
    subject: 'string',
    status: 'string',
    severity: 'string',
    sourceCreatedAt: 'datetime',
  },
  account: {
    accountId: 'string',
    name: 'string',
    segment: 'enum',
    region: 'string',
    ownerTeam: 'string',
    accountStatus: 'enum',
    sourceUpdatedAt: 'datetime',
  },
};

function descriptor(key: SourceKey, rowCount: number): SourceDescriptor {
  const schemaHash = createHash('sha256')
    .update(
      Object.entries(fields[key])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => `${name}:${type}`)
        .join('|'),
    )
    .digest('hex');
  return { key, schemaHash, rowCount, capturedAt: new Date().toISOString() };
}

async function bounded<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SOURCE_TIMEOUT')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeRead<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await bounded(work);
  } catch {
    return bounded(work);
  }
}

const adapters: Record<SourceKey, SourceAdapter> = {
  contract: {
    key: 'contract',
    fetchRecords: ({ accountId, limit }: SourceQuery) =>
      safeRead(async () =>
        (
          await db.srcContractEntitlement.findMany({
            where: { accountId },
            orderBy: { recordRef: 'asc' },
            take: limit,
            select: {
              recordRef: true,
              accountId: true,
              entitlementKey: true,
              status: true,
              contractVersion: true,
              effectiveFrom: true,
              effectiveTo: true,
              ingestedAt: true,
            },
          })
        ).map((r) => ({
          ...r,
          effectiveFrom: r.effectiveFrom.toISOString(),
          effectiveTo: r.effectiveTo?.toISOString() ?? null,
          ingestedAt: r.ingestedAt.toISOString(),
        })),
      ),
    describe: async () =>
      descriptor('contract', await safeRead(() => db.srcContractEntitlement.count())),
  },
  billing: {
    key: 'billing',
    fetchRecords: ({ accountId, limit }: SourceQuery) =>
      safeRead(async () =>
        (
          await db.srcBillingSubscription.findMany({
            where: { accountId },
            orderBy: { recordRef: 'asc' },
            take: limit,
            select: {
              recordRef: true,
              accountId: true,
              planCode: true,
              planStatus: true,
              seats: true,
              mrrMinor: true,
              periodStart: true,
              periodEnd: true,
              sourceUpdatedAt: true,
            },
          })
        ).map((r) => ({
          ...r,
          mrrMinor: r.mrrMinor.toString(),
          periodStart: r.periodStart.toISOString(),
          periodEnd: r.periodEnd.toISOString(),
          sourceUpdatedAt: r.sourceUpdatedAt.toISOString(),
        })),
      ),
    describe: async () =>
      descriptor('billing', await safeRead(() => db.srcBillingSubscription.count())),
  },
  usage: {
    key: 'usage',
    fetchRecords: ({ accountId, limit }: SourceQuery) =>
      safeRead(async () =>
        (
          await db.srcUsageEventDaily.findMany({
            where: { accountId },
            orderBy: { recordRef: 'asc' },
            take: limit,
            select: {
              recordRef: true,
              accountId: true,
              featureKey: true,
              eventDate: true,
              eventCount: true,
              lastSeenAt: true,
            },
          })
        ).map((r) => ({
          ...r,
          eventDate: r.eventDate.toISOString().slice(0, 10),
          lastSeenAt: r.lastSeenAt.toISOString(),
        })),
      ),
    describe: async () => descriptor('usage', await safeRead(() => db.srcUsageEventDaily.count())),
  },
  support: {
    key: 'support',
    fetchRecords: ({ accountId, limit }: SourceQuery) =>
      safeRead(async () =>
        (
          await db.srcSupportTicket.findMany({
            where: { accountId },
            orderBy: { recordRef: 'asc' },
            take: limit,
            select: {
              recordRef: true,
              accountId: true,
              subject: true,
              status: true,
              severity: true,
              sourceCreatedAt: true,
            },
          })
        ).map((r) => ({ ...r, sourceCreatedAt: r.sourceCreatedAt.toISOString() })),
      ),
    describe: async () => descriptor('support', await safeRead(() => db.srcSupportTicket.count())),
  },
  account: {
    key: 'account',
    fetchRecords: ({ accountId }: SourceQuery) =>
      safeRead(async () =>
        (
          await db.srcAccountRegistry.findMany({
            where: { accountId },
            take: 1,
            select: {
              accountId: true,
              name: true,
              segment: true,
              region: true,
              ownerTeam: true,
              accountStatus: true,
              sourceUpdatedAt: true,
            },
          })
        ).map((r) => ({ ...r, sourceUpdatedAt: r.sourceUpdatedAt.toISOString() })),
      ),
    describe: async () =>
      descriptor('account', await safeRead(() => db.srcAccountRegistry.count())),
  },
};

export function getSource(key: SourceKey): SourceAdapter {
  return adapters[key];
}
export function isSourceKey(value: string): value is SourceKey {
  return value in adapters;
}
export const sourceSchemaFields = fields;
