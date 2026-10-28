import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { Role } from '@/generated/prisma/enums';
import { canonicalJson } from '@/lib/canonical-json';
import { db } from '@/lib/db';
import { DependencyUnavailableError, ForbiddenError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';
import { dismissIntegrityEvent } from '@/lib/integrity-runner/dismiss';
import { evaluateContracts } from '@/lib/integrity-runner/evaluate';
import { requirePermission } from '@/lib/rbac';

export async function runIntegrityTests(requested: Set<string>): Promise<void> {
  if (requested.has('evaluate-all')) {
    const baseline = await evaluateContracts();
    assert.equal(baseline.evaluated, 8);
    assert.equal(baseline.eventsCreated, 0);
    assert.equal(baseline.events.length, 0);
    process.stdout.write('evaluate-all: passed\n');
  }
  if (requested.has('evaluate')) {
    const billing = await db.srcBillingSubscription.findUniqueOrThrow({
      where: { recordRef: 'billing:acc_00042' },
    });
    const contract = await db.srcContractEntitlement.findUniqueOrThrow({
      where: { recordRef: 'contract:acc_00042:CORE' },
    });
    try {
      const clean = await evaluateContracts(['billing.plan_status']);
      assert.equal(clean.eventsCreated, 0, 'fresh unchanged billing should create no event');
      await db.srcBillingSubscription.update({
        where: { id: billing.id },
        data: { planStatus: 'CURRENT' },
      });
      const first = await evaluateContracts(['billing.plan_status']);
      assert.equal(first.events.length, 1);
      assert.equal(first.events[0]?.type, 'SEMANTIC');
      assert.ok(
        (first.events[0]?.scopeSelector as { accountIds: string[] }).accountIds.includes(
          'acc_00042',
        ),
      );
      assert.ok(first.events[0]?.evidenceSnapshotIds.length);
      const evidence = await db.sourceSnapshot.findUniqueOrThrow({
        where: { id: first.events[0]!.evidenceSnapshotIds[0]! },
      });
      assert.equal(evidence.payloadHash, sha(evidence.payload));
      const auditCount = await db.auditEvent.count();
      const second = await evaluateContracts(['billing.plan_status']);
      assert.equal(second.eventsCreated, 0);
      assert.equal(second.eventsSuppressed, 1);
      assert.equal(await db.auditEvent.count(), auditCount, 'suppression must not append audit');
      await db.srcBillingSubscription.update({
        where: { id: billing.id },
        data: {
          planStatus: billing.planStatus,
          sourceUpdatedAt: new Date('2023-01-01T00:00:00.000Z'),
        },
      });
      const stale = await evaluateContracts(['billing.plan_status']);
      assert.equal(stale.events.filter((event) => event.type === 'FRESHNESS').length, 1);
      await db.srcBillingSubscription.update({
        where: { id: billing.id },
        data: { sourceUpdatedAt: billing.sourceUpdatedAt },
      });
      await db.srcContractEntitlement.update({
        where: { id: contract.id },
        data: { status: 'SUSPENDED' },
      });
      const cross = await evaluateContracts(['contract.entitlement_status']);
      assert.equal(cross.events.filter((event) => event.type === 'CROSS_SOURCE').length, 1);
      assert.ok(
        (
          cross.events.find((event) => event.type === 'CROSS_SOURCE')?.scopeSelector as {
            accountIds: string[];
          }
        ).accountIds.includes('acc_00042'),
      );
      const beforeSnapshots = await db.sourceSnapshot.count({
        where: {
          contractId: (
            await db.dataContract.findUniqueOrThrow({ where: { key: 'billing.plan_status' } })
          ).id,
        },
      });
      const beforeEvents = await db.integrityEvent.count();
      await assert.rejects(
        evaluateContracts(['billing.plan_status'], async () => {
          throw new Error('synthetic source outage');
        }),
        DependencyUnavailableError,
      );
      assert.equal(
        await db.sourceSnapshot.count({
          where: {
            contractId: (
              await db.dataContract.findUniqueOrThrow({ where: { key: 'billing.plan_status' } })
            ).id,
          },
        }),
        beforeSnapshots,
      );
      assert.equal(await db.integrityEvent.count(), beforeEvents);
      process.stdout.write('evaluate: passed\n');
    } finally {
      await db.srcBillingSubscription.update({
        where: { id: billing.id },
        data: { planStatus: billing.planStatus, sourceUpdatedAt: billing.sourceUpdatedAt },
      });
      await db.srcContractEntitlement.update({
        where: { id: contract.id },
        data: { status: contract.status },
      });
    }
  }

  if (requested.has('dismiss')) {
    for (const role of [Role.ANALYST, Role.VIEWER, Role.AUDITOR]) {
      assert.throws(
        () => requirePermission({ roles: [role] }, 'integrity:dismiss'),
        ForbiddenError,
      );
    }
    const reviewer = await db.user.findUniqueOrThrow({ where: { email: 'reviewer@aic.local' } });
    requirePermission({ roles: reviewer.roles }, 'integrity:dismiss');
    const contract = await db.dataContract.findUniqueOrThrow({
      where: { key: 'billing.plan_status' },
    });
    const event = await db.integrityEvent.create({
      data: {
        contractId: contract.id,
        type: 'SEMANTIC',
        severity: 'HIGH',
        detectedAt: new Date(),
        summary: 'Synthetic dismissal test',
        scopeSelector: { accountIds: ['acc_00042'] },
        evidenceSnapshotIds: [],
        status: 'OPEN',
        fingerprint: `test_${randomUUID()}`,
      },
    });
    const key = `test_${randomUUID()}`;
    const before = await db.auditEvent.count({ where: { eventType: 'INTEGRITY_DISMISSED' } });
    const first = await dismissIntegrityEvent({
      eventId: event.id,
      actorId: reviewer.id,
      reason: 'Verified source correction.',
      idempotencyKey: key,
      requestId: 'test-dismiss-request',
    });
    assert.equal(first.event.status, 'DISMISSED');
    assert.equal(first.event.dismissedReason, 'Verified source correction.');
    const replay = await dismissIntegrityEvent({
      eventId: event.id,
      actorId: reviewer.id,
      reason: 'Verified source correction.',
      idempotencyKey: key,
      requestId: 'test-dismiss-replay',
    });
    assert.equal(replay.replayed, true);
    assert.equal(
      await db.auditEvent.count({ where: { eventType: 'INTEGRITY_DISMISSED' } }),
      before + 1,
    );
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { eventType: 'INTEGRITY_DISMISSED', requestId: 'test-dismiss-request' },
      orderBy: { seq: 'desc' },
    });
    const body = {
      eventType: audit.eventType,
      actorType: audit.actorType,
      actorId: audit.actorId,
      caseId: audit.caseId,
      payload: audit.payload,
      createdAt: audit.createdAt.toISOString(),
    };
    const expectedHash = `sha256:${createHash('sha256')
      .update(`${audit.prevHash ?? ''}|${audit.seq}|${canonicalJson(body)}`)
      .digest('hex')}`;
    assert.equal(audit.hash, expectedHash);
    const previous = await db.auditEvent.findFirst({
      where: { seq: { lt: audit.seq } },
      orderBy: { seq: 'desc' },
    });
    assert.equal(audit.prevHash, previous?.hash ?? null);
    process.stdout.write('dismiss: passed\n');
  }
}
