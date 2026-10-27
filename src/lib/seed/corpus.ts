import { AccountSegment, AccountStatus, TargetEntitlementStatus } from '@/generated/prisma/enums';

export const seedTime = new Date('2026-10-26T09:00:00.000Z');

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function accountRef(index: number): string {
  return `acc_${String(index).padStart(5, '0')}`;
}

export function accountCorpus(seed: number, count = 5_000) {
  const random = seededRandom(seed);
  const segments = [AccountSegment.ENTERPRISE, AccountSegment.MIDMARKET, AccountSegment.SMB];
  const regions = ['AMER', 'EMEA', 'APAC'];
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const accountId = accountRef(index);
    const segment = segments[Math.floor(random() * segments.length)]!;
    const region = regions[Math.floor(random() * regions.length)]!;
    return { accountId, name: `Synthetic account ${index}`, segment, region };
  });
}

export function entitlementCorpus(accountId: string, index: number) {
  const keys = ['CORE'];
  if (index % 5 < 3) keys.push('SSO');
  if (index % 5 < 4) keys.push('ANALYTICS');
  return keys.map((entitlementKey) => ({
    accountId,
    entitlementKey,
    status: TargetEntitlementStatus.ACTIVE,
    sourceRef: `contract:${accountId}:${entitlementKey}`,
  }));
}

export function accountStatusFor(): AccountStatus {
  return AccountStatus.ACTIVE;
}
