import { NextResponse } from 'next/server';

import { DegradationLevel } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { withRoute } from '@/lib/http';
import { verifiedPolicy } from '@/lib/policy/config';

async function readDegradation(): Promise<DegradationLevel> {
  const table = await db.$queryRaw<Array<{ present: string | null }>>`
    SELECT to_regclass('public.degradation_state')::text AS present
  `;
  if (!table[0]?.present) return DegradationLevel.L0_NORMAL;
  const result = await db.degradationState.findFirst({ orderBy: { changedAt: 'desc' } });
  return result?.level ?? DegradationLevel.L0_NORMAL;
}

export const GET = withRoute(async () => {
  let database: 'ok' | 'unavailable' = 'ok';
  let policy: { version: string; hash: string } | null = null;
  let policyVerified = false;
  let degradation: DegradationLevel = DegradationLevel.L0_NORMAL;

  try {
    await db.$queryRaw`SELECT 1`;
    degradation = await readDegradation();
    const active = await db.policyVersion.findFirst({ where: { status: 'ACTIVE' } });
    if (active) {
      policy = { version: active.version, hash: active.hash };
      try {
        await verifiedPolicy(active);
        policyVerified = true;
      } catch {
        policyVerified = false;
      }
    }
  } catch {
    database = 'unavailable';
  }

  const failing =
    database !== 'ok' || !policyVerified || degradation === DegradationLevel.L4_AUDIT_BROKEN;
  const degraded = degradation !== DegradationLevel.L0_NORMAL;
  return NextResponse.json(
    {
      status: failing ? 'failing' : degraded ? 'degraded' : 'ok',
      db: database,
      mode: env.INVESTIGATION_MODE.toUpperCase(),
      degradation,
      policyVersion: policy?.version ?? null,
      policyHash: policy?.hash ?? null,
      policyVerified,
      commit: env.GIT_SHA,
      checkedAt: new Date().toISOString(),
    },
    { status: failing ? 503 : 200 },
  );
});
