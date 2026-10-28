import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { encode } from 'next-auth/jwt';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

const base = env.AIC_BASE_URL;
const agent = env.AGENT_SERVICE_KEY;
const cookieName = env.SESSION_COOKIE_NAME;

async function call(path: string, options: RequestInit = {}) {
  const response = await fetch(new URL(path, base), options);
  const body = (await response.json()) as {
    ok: boolean;
    data?: { eventsCreated?: number };
    meta?: { replayed?: boolean };
    error?: { code: string };
  };
  return { status: response.status, body };
}
async function cookie(email: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const token = await encode({
    token: { sub: user.id, sessionEpoch: user.sessionEpoch },
    secret: env.AUTH_SECRET,
    salt: cookieName,
    maxAge: 3600,
  });
  return `${cookieName}=${token}`;
}

try {
  const evaluateKey = `test_${randomUUID()}`;
  const evaluateOptions = {
    method: 'POST',
    headers: {
      'x-agent-key': agent,
      'content-type': 'application/json',
      'idempotency-key': evaluateKey,
    },
    body: JSON.stringify({ contractKeys: ['billing.plan_status'] }),
  };
  const evaluated = await call('/api/v1/integrity/evaluate', evaluateOptions);
  assert.equal(evaluated.status, 200);
  const replay = await call('/api/v1/integrity/evaluate', evaluateOptions);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.meta?.replayed, true);
  assert.equal(replay.body.data?.eventsCreated, evaluated.body.data?.eventsCreated);
  const conflict = await call('/api/v1/integrity/evaluate', {
    ...evaluateOptions,
    body: JSON.stringify({ contractKeys: ['account.segment'] }),
  });
  assert.equal(conflict.status, 409);
  const wrongService = await call('/api/v1/integrity/evaluate', {
    ...evaluateOptions,
    headers: {
      'x-target-key': env.TARGET_SERVICE_KEY,
      'content-type': 'application/json',
      'idempotency-key': `test_${randomUUID()}`,
    },
  });
  assert.equal(wrongService.status, 403);

  const anonymous = await call('/api/v1/integrity/events');
  assert.equal(anonymous.status, 401);
  const viewer = await cookie('viewer@aic.local');
  const listed = await call('/api/v1/integrity/events?status=OPEN&limit=2', {
    headers: { cookie: viewer },
  });
  assert.equal(listed.status, 200);
  const viewerRow = await db.user.findUniqueOrThrow({ where: { email: 'viewer@aic.local' } });
  const staleToken = await encode({
    token: { sub: viewerRow.id, sessionEpoch: viewerRow.sessionEpoch + 1 },
    secret: env.AUTH_SECRET,
    salt: cookieName,
    maxAge: 3600,
  });
  const stale = await call('/api/v1/integrity/events', {
    headers: { cookie: `${cookieName}=${staleToken}` },
  });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.error?.code, 'SESSION_STALE');
  const contract = await db.dataContract.findUniqueOrThrow({
    where: { key: 'billing.plan_status' },
  });
  const event = await db.integrityEvent.create({
    data: {
      contractId: contract.id,
      type: 'SEMANTIC',
      severity: 'HIGH',
      detectedAt: new Date(),
      summary: 'Synthetic route dismissal test',
      scopeSelector: { accountIds: ['acc_00042'] },
      evidenceSnapshotIds: [],
      status: 'OPEN',
      fingerprint: `test_${randomUUID()}`,
    },
  });
  const path = `/api/v1/integrity/events/${event.id}/dismiss`;
  const key = `test_${randomUUID()}`;
  const body = JSON.stringify({ reason: 'Source was corrected.' });
  for (const email of ['analyst@aic.local', 'viewer@aic.local', 'auditor@aic.local']) {
    const denied = await call(path, {
      method: 'POST',
      headers: {
        cookie: await cookie(email),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body,
    });
    assert.equal(denied.status, 403, `${email} must not dismiss`);
  }
  const reviewer = await cookie('reviewer@aic.local');
  const missingReason = await call(path, {
    method: 'POST',
    headers: { cookie: reviewer, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ reason: '' }),
  });
  assert.equal(missingReason.status, 400);
  const before = await db.auditEvent.count({ where: { eventType: 'INTEGRITY_DISMISSED' } });
  const approved = await call(path, {
    method: 'POST',
    headers: { cookie: reviewer, 'content-type': 'application/json', 'idempotency-key': key },
    body,
  });
  assert.equal(approved.status, 200);
  const approvedReplay = await call(path, {
    method: 'POST',
    headers: { cookie: reviewer, 'content-type': 'application/json', 'idempotency-key': key },
    body,
  });
  assert.equal(approvedReplay.body.meta?.replayed, true);
  assert.equal(
    await db.auditEvent.count({ where: { eventType: 'INTEGRITY_DISMISSED' } }),
    before + 1,
  );
  process.stdout.write('Integrity HTTP evaluate, replay, list, RBAC and dismiss: passed\n');
} finally {
  await db.$disconnect();
}
