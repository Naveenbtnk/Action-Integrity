import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.AIC_BASE_URL ?? 'http://localhost:3000';
const agent = process.env.AGENT_SERVICE_KEY;
const target = process.env.TARGET_SERVICE_KEY;
assert.ok(agent && target, 'Service keys must be configured.');

type SmokePayload = {
  db: string;
  ok: boolean;
  data: {
    records: Record<string, unknown>[];
    result: { status: string };
    auditId: string;
    status: string;
    state: { status: string };
    stateHash: string;
  };
};

async function request(
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: SmokePayload; headers: Headers }> {
  const response = await fetch(new URL(path, base), options);
  const body = (await response.json()) as SmokePayload;
  return { status: response.status, body, headers: response.headers };
}

const health = await request('/api/v1/health');
assert.equal(health.status, 200);
assert.equal(health.body.db, 'ok');
const app = await fetch(new URL('/app', base), { redirect: 'manual' });
assert.equal(app.status, 307);
assert.equal(app.headers.get('location'), '/login');
const source = await request('/api/v1/sources/billing/records?accountId=acc_00042', {
  headers: { 'x-agent-key': agent },
});
assert.equal(source.status, 200);
assert.equal(source.body.ok, true);
assert.ok(source.body.data.records.length > 0);
assert.ok(source.body.data.records.every((r: Record<string, unknown>) => !('payload' in r)));
const denied = await request('/api/v1/target/entitlements/change', {
  method: 'POST',
  headers: {
    'x-agent-key': agent,
    'content-type': 'application/json',
    'idempotency-key': `test_${randomUUID()}`,
  },
  body: JSON.stringify({ accountId: 'acc_00042', entitlementKey: 'SSO', to: 'SUSPENDED' }),
});
assert.equal(denied.status, 403);
const cookieDenied = await request('/api/v1/target/entitlements?accountId=acc_00042&key=SSO', {
  headers: { 'x-target-key': target, cookie: 'aic_session=example' },
});
assert.equal(cookieDenied.status, 403);
const state = await request('/api/v1/target/entitlements?accountId=acc_00042&key=SSO', {
  headers: { 'x-target-key': target },
});
assert.equal(state.status, 200);
assert.ok(state.body.data);
const capture = await request(
  '/api/v1/target/restore-point?targetObjectType=entitlement&accountId=acc_00042&key=SSO',
  { headers: { 'x-target-key': target } },
);
assert.equal(capture.status, 200);
const original = capture.body.data;
const next = original.state.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
const key = `test_${randomUUID()}`;
const body = JSON.stringify({ accountId: 'acc_00042', entitlementKey: 'SSO', to: next });
const writeOptions = {
  method: 'POST',
  headers: {
    'x-target-key': target,
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-request-id': 'test_phase2_request',
  },
  body,
};
try {
  const changed = await request('/api/v1/target/entitlements/change', writeOptions);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.result.status, 'SUCCEEDED');
  const replay = await request('/api/v1/target/entitlements/change', writeOptions);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.auditId, changed.body.data.auditId);
  const reread = await request('/api/v1/target/entitlements?accountId=acc_00042&key=SSO', {
    headers: { 'x-target-key': target },
  });
  assert.equal(reread.body.data.status, next);
} finally {
  const restore = await request('/api/v1/target/entitlements/restore', {
    method: 'POST',
    headers: {
      'x-target-key': target,
      'content-type': 'application/json',
      'idempotency-key': `test_${randomUUID()}`,
    },
    body: JSON.stringify({
      accountId: 'acc_00042',
      entitlementKey: 'SSO',
      snapshot: original.state,
    }),
  });
  assert.equal(restore.status, 200);
  const restored = await request(
    '/api/v1/target/restore-point?targetObjectType=entitlement&accountId=acc_00042&key=SSO',
    { headers: { 'x-target-key': target } },
  );
  assert.equal(restored.body.data.stateHash, original.stateHash);
}
process.stdout.write('HTTP source, target, auth, replay and restore: passed\n');
