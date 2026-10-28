import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { encode } from 'next-auth/jwt';

import type { Prisma } from '@/generated/prisma/client';
import {
  IntegrityEventStatus,
  IntegrityEventType,
  OutboundActionType,
  Severity,
} from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { ingestAction } from '@/lib/gate/ingest';

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
  const response = await fetch(new URL(path, env.AIC_BASE_URL), options);
  const body = (await response.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    meta?: { replayed?: boolean };
    error?: { code: string };
  };
  return { status: response.status, body };
}

try {
  const accountId = `acc_${String(2000 + Math.floor(Math.random() * 2000)).padStart(5, '0')}`;
  const contract = await db.dataContract.findUniqueOrThrow({
    where: { key: 'billing.plan_status' },
  });
  await db.integrityEvent.create({
    data: {
      contractId: contract.id,
      type: IntegrityEventType.SEMANTIC,
      severity: Severity.HIGH,
      detectedAt: new Date(),
      summary: 'Phase 5 HTTP test event',
      scopeSelector: { accountIds: [accountId], values: ['CURRENT'] },
      evidenceSnapshotIds: [],
      status: IntegrityEventStatus.OPEN,
      fingerprint: `http-agent:${randomUUID()}`,
    },
  });
  const ingested = await db.$transaction((tx) =>
    ingestAction(tx as Prisma.TransactionClient, {
      sourceAgent: 'entitlement-sync-agent',
      accountId,
      actionType: OutboundActionType.ENTITLEMENT_REVOKE,
      payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED', testRunId: randomUUID() },
      requestedAt: new Date(),
      idempotencyKey: `agent_${randomUUID().replaceAll('-', '')}`,
      requestId: `test_${randomUUID()}`,
    }),
  );
  const ref = ingested.gate.caseRef;
  assert.ok(ref);
  const analyst = await cookie('analyst@aic.local');
  const viewer = await cookie('viewer@aic.local');
  const auditor = await cookie('auditor@aic.local');
  const key = `investigate_${randomUUID().replaceAll('-', '')}`;
  const investigateOptions = {
    method: 'POST',
    headers: {
      cookie: analyst,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify({}),
  };
  const first = await call(`/api/v1/cases/${ref}/investigate`, investigateOptions);
  assert.equal(first.status, 202, JSON.stringify(first.body.error));
  const replay = await call(`/api/v1/cases/${ref}/investigate`, investigateOptions);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.meta?.replayed, true);
  const report = await call(`/api/v1/cases/${ref}/report`, { headers: { cookie: analyst } });
  assert.equal(report.status, 200);
  assert.ok(report.body.data?.report);
  const caseDetail = await call(`/api/v1/cases/${ref}`, { headers: { cookie: viewer } });
  assert.equal(caseDetail.status, 200);
  assert.ok(caseDetail.body.data?.investigation);
  const viewerMutation = await call(`/api/v1/cases/${ref}/investigate`, {
    ...investigateOptions,
    headers: { ...investigateOptions.headers, cookie: viewer },
  });
  assert.equal(viewerMutation.status, 403);
  const auditorMutation = await call(`/api/v1/cases/${ref}/evidence`, {
    method: 'POST',
    headers: {
      cookie: auditor,
      'content-type': 'application/json',
      'idempotency-key': `evidence_${randomUUID().replaceAll('-', '')}`,
    },
    body: JSON.stringify({
      kind: 'OWNER_CONFIRMATION',
      sourceKey: 'owner',
      recordRef: 'owner-1',
      excerpt: 'Confirmed',
      stance: 'SUPPORTS',
    }),
  });
  assert.equal(auditorMutation.status, 403);
  const terminal = await db.case.findFirst({
    where: { status: 'CLOSED_RESOLVED' },
    select: { ref: true },
  });
  assert.ok(terminal);
  const terminalEvidence = await call(`/api/v1/cases/${terminal.ref}/evidence`, {
    method: 'POST',
    headers: {
      cookie: analyst,
      'content-type': 'application/json',
      'idempotency-key': `terminal_${randomUUID().replaceAll('-', '')}`,
    },
    body: JSON.stringify({
      kind: 'OWNER_CONFIRMATION',
      sourceKey: 'owner',
      recordRef: 'owner-terminal',
      excerpt: 'Confirmed',
      stance: 'SUPPORTS',
    }),
  });
  assert.equal(terminalEvidence.status, 409);
  const request = await call(`/api/v1/cases/${ref}/evidence-requests`, {
    method: 'POST',
    headers: {
      cookie: analyst,
      'content-type': 'application/json',
      'idempotency-key': `request_${randomUUID().replaceAll('-', '')}`,
    },
    body: JSON.stringify({
      ownerTeam: 'contract-owner',
      question: 'Confirm entitlement',
      dueInHours: 24,
    }),
  });
  assert.equal(request.status, 201, JSON.stringify(request.body.error));
  process.stdout.write('Phase 5 HTTP report, replay, RBAC and evidence request: passed\n');
} finally {
  await db.$disconnect();
}
