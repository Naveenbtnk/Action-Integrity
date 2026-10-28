import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { encode } from 'next-auth/jwt';

import { IntegrityEventStatus, IntegrityEventType, Severity } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

const base = env.AIC_BASE_URL;
const accountId = `acc_${String(1000 + Math.floor(Math.random() * 4000)).padStart(5, '0')}`;

async function cookie(email: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const token = await encode({
    token: { sub: user.id, sessionEpoch: user.sessionEpoch },
    secret: env.AUTH_SECRET,
    salt: env.SESSION_COOKIE_NAME,
    maxAge: 3600,
  });
  return `${env.SESSION_COOKIE_NAME}=${token}`;
}

async function call(path: string, options: RequestInit = {}) {
  const response = await fetch(new URL(path, base), options);
  const body = (await response.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    meta?: { replayed?: boolean };
    error?: { code: string };
  };
  return { status: response.status, body };
}

try {
  const contract = await db.dataContract.findUniqueOrThrow({
    where: { key: 'billing.plan_status' },
  });
  await db.integrityEvent.create({
    data: {
      contractId: contract.id,
      type: IntegrityEventType.SEMANTIC,
      severity: Severity.HIGH,
      detectedAt: new Date(),
      summary: 'Synthetic HTTP gate test',
      scopeSelector: { accountIds: [accountId], values: ['CURRENT'] },
      evidenceSnapshotIds: [],
      status: IntegrityEventStatus.OPEN,
      fingerprint: `test:${randomUUID()}`,
    },
  });
  const key = `http_${randomUUID().replaceAll('-', '')}`;
  const body = {
    sourceAgent: 'entitlement-sync-agent',
    accountId,
    actionType: 'ENTITLEMENT_REVOKE',
    payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
    requestedAt: new Date().toISOString(),
  };
  const options = {
    method: 'POST',
    headers: {
      'x-agent-key': env.AGENT_SERVICE_KEY,
      'idempotency-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
  const beforeTarget = await db.tgtAudit.count();
  const first = await call('/api/v1/actions/ingest', options);
  assert.equal(first.status, 201, JSON.stringify(first.body.error));
  const firstData = first.body.data as {
    action: { id: string };
    gate: { decision: string; caseRef: string };
    pendingExecutor: boolean;
  };
  assert.equal(firstData.gate.decision, 'HOLD');
  assert.ok(firstData.gate.caseRef);
  assert.equal(firstData.pendingExecutor, false);
  const replay = await call('/api/v1/actions/ingest', options);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.meta?.replayed, true);
  const conflict = await call('/api/v1/actions/ingest', {
    ...options,
    body: JSON.stringify({ ...body, accountId: 'acc_00043' }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error?.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(await db.tgtAudit.count(), beforeTarget);

  const viewer = await cookie('viewer@aic.local');
  const detail = await call(`/api/v1/actions/${firstData.action.id}`, {
    headers: { cookie: viewer },
  });
  assert.equal(detail.status, 200);
  assert.equal((detail.body.data?.gate as { decision: string }).decision, 'HOLD');
  const caseDetail = await call(`/api/v1/cases/${firstData.gate.caseRef}`, {
    headers: { cookie: viewer },
  });
  assert.equal(caseDetail.status, 200);
  assert.equal((caseDetail.body.data?.case as { status: string }).status, 'HOLDING');
  assert.equal(
    (await call('/api/v1/actions?status=HELD', { headers: { cookie: viewer } })).status,
    200,
  );
  assert.equal(
    (await call('/api/v1/cases?status=HOLDING', { headers: { cookie: viewer } })).status,
    200,
  );
  const serviceRead = await call('/api/v1/cases', {
    headers: { 'x-agent-key': env.AGENT_SERVICE_KEY },
  });
  assert.equal(serviceRead.status, 403);
  const admin = await cookie('admin@aic.local');
  const adminIngest = await call('/api/v1/actions/ingest', {
    ...options,
    headers: {
      cookie: admin,
      'idempotency-key': `admin_${randomUUID()}`,
      'content-type': 'application/json',
    },
  });
  assert.equal(adminIngest.status, 403);

  const allow = await call('/api/v1/actions/ingest', {
    ...options,
    headers: { ...options.headers, 'idempotency-key': `allow_${randomUUID()}` },
    body: JSON.stringify({ ...body, accountId: 'acc_00043' }),
  });
  assert.equal(allow.status, 201, JSON.stringify(allow.body.error));
  assert.equal((allow.body.data?.gate as { decision: string }).decision, 'ALLOW');
  assert.equal(allow.body.data?.pendingExecutor, true);
  assert.equal(allow.body.data?.case, null);
  assert.equal(await db.tgtAudit.count(), beforeTarget);
  process.stdout.write('Phase 4 HTTP ingest, replay, RBAC, projections and ALLOW: passed\n');
} finally {
  await db.$disconnect();
}
