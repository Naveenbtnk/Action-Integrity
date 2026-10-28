import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import {
  ActorType,
  CaseStatus,
  GateDecision,
  IntegrityEventStatus,
  IntegrityEventType,
  OutboundActionType,
  Role,
  Severity,
} from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { InvalidTransitionError } from '@/lib/errors';
import { ingestAction } from '@/lib/gate/ingest';
import { withIdempotency } from '@/lib/idempotency';
import { requirePermission } from '@/lib/rbac';
import { transitionCase } from '@/lib/state-machine/case';

const requested = new Set(process.argv.slice(2));
const shouldRun = (name: string) => requested.size === 0 || requested.has(name);

try {
  if (shouldRun('rbac-routes')) {
    assert.throws(() => requirePermission({ roles: [Role.ADMIN] }, 'service:ingest'));
    assert.throws(() => requirePermission({ service: 'SERVICE_AGENT' }, 'case:read'));
    process.stdout.write('rbac-routes: passed\n');
  }
  if (shouldRun('ingest')) {
    const accountId = `acc_${String(1000 + Math.floor(Math.random() * 4000)).padStart(5, '0')}`;
    const contract = await db.dataContract.findUniqueOrThrow({
      where: { key: 'billing.plan_status' },
    });
    const event = await db.integrityEvent.create({
      data: {
        contractId: contract.id,
        type: IntegrityEventType.SEMANTIC,
        severity: Severity.HIGH,
        detectedAt: new Date(),
        summary: 'Phase 4 synthetic semantic drift test',
        scopeSelector: { accountIds: [accountId], values: ['CURRENT'] },
        evidenceSnapshotIds: [],
        status: IntegrityEventStatus.OPEN,
        fingerprint: `test:${randomUUID()}`,
      },
    });
    const before = {
      actions: await db.outboundAction.count(),
      cases: await db.case.count(),
      holds: await db.actionHold.count(),
      outbox: await db.outboxEvent.count(),
      target: await db.tgtAudit.count(),
    };
    const key = `test_${randomUUID().replaceAll('-', '')}`;
    const body = {
      sourceAgent: 'entitlement-sync-agent',
      accountId,
      actionType: OutboundActionType.ENTITLEMENT_REVOKE,
      payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
      requestedAt: new Date().toISOString(),
    };
    const makeRequest = () =>
      new Request('http://localhost:3000/api/v1/actions/ingest', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify(body),
      });
    let invocations = 0;
    const submit = () =>
      withIdempotency(makeRequest(), 'service-agent', body, async (tx) => {
        invocations += 1;
        return {
          status: 201,
          data: await ingestAction(tx, {
            ...body,
            payload: body.payload as Prisma.InputJsonObject,
            requestedAt: new Date(body.requestedAt),
            idempotencyKey: key,
            requestId: `test_${randomUUID()}`,
          }),
        };
      });
    const [first, second] = await Promise.all([submit(), submit()]);
    assert.equal(first.data.gate.decision, GateDecision.HOLD);
    assert.equal(second.data.gate.decision, GateDecision.HOLD);
    assert.equal(Number(first.replayed) + Number(second.replayed), 1);
    assert.equal(invocations, 1);
    assert.equal(await db.outboundAction.count(), before.actions + 1);
    assert.equal(await db.case.count(), before.cases + 1);
    assert.equal(await db.actionHold.count(), before.holds + 1);
    assert.equal(await db.outboxEvent.count(), before.outbox + 3);
    assert.equal(await db.tgtAudit.count(), before.target);
    const caseRow = await db.case.findUniqueOrThrow({ where: { ref: first.data.gate.caseRef } });
    assert.equal(caseRow.status, CaseStatus.HOLDING);
    assert.equal(
      await db.caseExposedAccount.count({ where: { caseId: caseRow.id, accountId } }),
      1,
    );
    assert.equal(
      await db.auditEvent.count({ where: { caseId: caseRow.id, eventType: 'CASE_OPENED' } }),
      1,
    );
    assert.equal(
      await db.auditEvent.count({ where: { caseId: caseRow.id, eventType: 'HOLD_PLACED' } }),
      1,
    );
    assert.equal(
      (await db.integrityEvent.findUniqueOrThrow({ where: { id: event.id } })).status,
      IntegrityEventStatus.LINKED,
    );

    await assert.rejects(
      withIdempotency(
        makeRequest(),
        'service-agent',
        { ...body, accountId: 'acc_00043' },
        async () => {
          throw new Error('Conflicting callback must not run.');
        },
      ),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    assert.equal(await db.outboundAction.count(), before.actions + 1);
    const rollback = Symbol('rollback');
    try {
      await db.$transaction(async (transaction) => {
        const tx = transaction as Prisma.TransactionClient;
        const auditBefore = await tx.auditEvent.count({ where: { caseId: caseRow.id } });
        await assert.rejects(
          transitionCase(tx, caseRow.id, CaseStatus.REOPENED, {
            type: ActorType.USER,
            requestId: 'test_invalid_transition',
          }),
          InvalidTransitionError,
        );
        assert.equal(await tx.auditEvent.count({ where: { caseId: caseRow.id } }), auditBefore);
        throw rollback;
      });
    } catch (cause) {
      if (cause !== rollback) throw cause;
    }
    process.stdout.write('ingest: passed\n');
  }
} finally {
  await db.$disconnect();
}
