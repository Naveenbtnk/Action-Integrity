import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import {
  EvidenceKind,
  EvidenceStance,
  IntegrityEventStatus,
  IntegrityEventType,
  OutboundActionType,
  Role,
  Severity,
} from '@/generated/prisma/enums';
import { addEvidence, createEvidenceRequest } from '@/lib/agent/evidence-write';
import { investigate } from '@/lib/agent/investigator';
import { db } from '@/lib/db';
import { ingestAction } from '@/lib/gate/ingest';
import { requirePermission } from '@/lib/rbac';

const requested = new Set(process.argv.slice(2));
const shouldRun = (name: string) => requested.size === 0 || requested.has(name);

try {
  if (shouldRun('investigate') || shouldRun('evidence')) {
    const accountId = 'acc_00042';
    const billing = await db.srcBillingSubscription.findUniqueOrThrow({
      where: { recordRef: `billing:${accountId}` },
    });
    const analyst = await db.user.findUniqueOrThrow({ where: { email: 'analyst@aic.local' } });
    const beforeTarget = await db.tgtAudit.count();
    try {
      await db.srcBillingSubscription.update({
        where: { id: billing.id },
        data: { planStatus: 'CURRENT' },
      });
      const contract = await db.dataContract.findUniqueOrThrow({
        where: { key: 'billing.plan_status' },
      });
      const event = await db.integrityEvent.create({
        data: {
          contractId: contract.id,
          type: IntegrityEventType.SEMANTIC,
          severity: Severity.HIGH,
          detectedAt: new Date(),
          summary: 'Scenario A semantic drift',
          scopeSelector: { accountIds: [accountId], values: ['CURRENT'] },
          evidenceSnapshotIds: [],
          status: IntegrityEventStatus.OPEN,
          fingerprint: `phase5:${randomUUID()}`,
        },
      });
      const action = await db.$transaction((transaction) =>
        ingestAction(transaction as Prisma.TransactionClient, {
          sourceAgent: 'entitlement-sync-agent',
          accountId,
          actionType: OutboundActionType.ENTITLEMENT_REVOKE,
          payload: {
            entitlementKey: 'SSO',
            from: 'ACTIVE',
            to: 'REMOVED',
            testRunId: randomUUID(),
          },
          requestedAt: new Date(),
          idempotencyKey: `agent_${randomUUID().replaceAll('-', '')}`,
          requestId: `test_${randomUUID()}`,
        }),
      );
      assert.equal(action.gate.decision, 'HOLD');
      assert.equal(action.action.integrityEventId, event.id);
      const caseRef = action.gate.caseRef;
      assert.ok(caseRef);
      const caseRow = await db.case.findUniqueOrThrow({ where: { ref: caseRef } });
      const actor = { id: analyst.id, requestId: `test_${randomUUID()}` };
      const first = await investigate(caseRow.id, actor);
      assert.equal(first.cached, false);
      assert.equal(first.report.isFallback, true);
      assert.equal(first.report.modelId, null);
      assert.equal(first.report.tokensUsed, null);
      assert.equal(first.report.recommendedDisposition, 'BLOCK');
      assert.equal(first.report.hypotheses.length, 2);
      assert.deepEqual(
        (first.report.citations as { kind: string }[]).map((item) => item.kind).slice(0, 2),
        [EvidenceKind.CONTRACT_RECORD, EvidenceKind.BILLING_RECORD],
      );
      assert.equal(
        (await db.case.findUniqueOrThrow({ where: { id: caseRow.id } })).status,
        'AWAITING_EVIDENCE',
      );
      assert.equal(
        await db.auditEvent.count({
          where: { caseId: caseRow.id, eventType: 'AGENT_FALLBACK_USED' },
        }),
        1,
      );
      const cached = await investigate(caseRow.id, actor);
      assert.equal(cached.cached, true);
      assert.equal(cached.report.id, first.report.id);
      const request = await db.$transaction((tx) =>
        createEvidenceRequest(
          tx as Prisma.TransactionClient,
          caseRef,
          {
            ownerTeam: 'contract-owner',
            question: 'Confirm SSO entitlement is active',
            dueInHours: 24,
          },
          actor,
        ),
      );
      assert.equal(request.caseStatus, 'AWAITING_EVIDENCE');
      await db.$transaction((tx) =>
        addEvidence(
          tx as Prisma.TransactionClient,
          caseRef,
          {
            kind: EvidenceKind.OWNER_CONFIRMATION,
            sourceKey: 'contract-owner',
            recordRef: `owner:${randomUUID()}`,
            excerpt: 'Owner confirms entitlement SSO ACTIVE',
            stance: EvidenceStance.SUPPORTS,
          },
          actor,
        ),
      );
      const second = await investigate(caseRow.id, actor);
      assert.equal(second.cached, false);
      assert.equal(second.report.recommendedDisposition, 'BLOCK');
      assert.equal(second.report.missingEvidence.length, 0);
      assert.equal(
        (await db.case.findUniqueOrThrow({ where: { id: caseRow.id } })).status,
        'AWAITING_APPROVAL',
      );
      assert.equal(await db.tgtAudit.count(), beforeTarget);
      assert.throws(() => requirePermission({ roles: [Role.VIEWER] }, 'case:investigate'));
      assert.throws(() => requirePermission({ roles: [Role.AUDITOR] }, 'case:add_evidence'));
      assert.doesNotThrow(() => requirePermission({ roles: [Role.ANALYST] }, 'case:investigate'));
      process.stdout.write('investigate evidence: passed\n');
    } finally {
      await db.srcBillingSubscription.update({
        where: { id: billing.id },
        data: { planStatus: billing.planStatus },
      });
    }
  }
} finally {
  await db.$disconnect();
}
