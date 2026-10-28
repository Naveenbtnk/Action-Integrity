import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import { GateDecision, IntegrityEventType, OutboundActionType } from '@/generated/prisma/enums';
import { addEvidence } from '@/lib/agent/evidence-write';
import { investigate } from '@/lib/agent/investigator';
import { db } from '@/lib/db';
import { ingestAction } from '@/lib/gate/ingest';
import { withIdempotency } from '@/lib/idempotency';
import { evaluateContracts } from '@/lib/integrity-runner/evaluate';
import { evaluateAndPersist } from '@/lib/policy/persist';

const options = new Set(process.argv.slice(2));
if (
  !options.has('--scenario=A') ||
  (!options.has('--upto=ingest') && !options.has('--upto=policy'))
) {
  throw new Error('Supported scenario: --scenario=A --upto=ingest|policy.');
}

const accountId = `acc_${String(1000 + Math.floor(Math.random() * 4000)).padStart(5, '0')}`;
const billing = await db.srcBillingSubscription.findUniqueOrThrow({
  where: { recordRef: `billing:${accountId}` },
});
try {
  await db.srcBillingSubscription.update({
    where: { id: billing.id },
    data: { planStatus: 'CURRENT' },
  });
  const evaluated = await evaluateContracts(['billing.plan_status']);
  const event = evaluated.events.find(
    (candidate) =>
      candidate.type === IntegrityEventType.SEMANTIC &&
      (candidate.scopeSelector as { accountIds?: string[] }).accountIds?.includes(accountId),
  );
  assert.ok(event, 'semantic drift must produce an event covering the account');
  const key = `scenario_${randomUUID().replaceAll('-', '')}`;
  const body = {
    sourceAgent: 'entitlement-sync-agent',
    accountId,
    actionType: OutboundActionType.ENTITLEMENT_REVOKE,
    payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
    requestedAt: new Date().toISOString(),
  };
  const request = () =>
    new Request('http://localhost:3000/api/v1/actions/ingest', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(body),
    });
  const targetBefore = await db.tgtAudit.count();
  const submit = () =>
    withIdempotency(request(), 'service-agent', body, async (tx) => ({
      status: 201,
      data: await ingestAction(tx, {
        ...body,
        requestedAt: new Date(body.requestedAt),
        idempotencyKey: key,
        requestId: `scenario_${randomUUID()}`,
      }),
    }));
  const first = await submit();
  const replay = await submit();
  assert.equal(first.data.gate.decision, GateDecision.HOLD);
  assert.equal(replay.replayed, true);
  assert.equal(await db.tgtAudit.count(), targetBefore, 'ingest must not write to target');
  assert.equal(
    await db.actionHold.count({ where: { outboundAction: { idempotencyKey: key } } }),
    1,
  );
  if (options.has('--upto=policy')) {
    const caseRef = first.data.gate.caseRef;
    assert.ok(caseRef);
    const caseRow = await db.case.findUniqueOrThrow({ where: { ref: caseRef } });
    const analyst = await db.user.findUniqueOrThrow({ where: { email: 'analyst@aic.local' } });
    const actor = { id: analyst.id, requestId: `scenario_${randomUUID()}` };
    const initial = await investigate(caseRow.id, actor);
    assert.equal(initial.report.recommendedDisposition, 'BLOCK');
    await db.$transaction((tx) =>
      addEvidence(
        tx as Prisma.TransactionClient,
        caseRef,
        {
          kind: 'OWNER_CONFIRMATION',
          sourceKey: 'contract-owner',
          recordRef: `owner:${randomUUID()}`,
          excerpt: 'Contract owner confirms the current entitlement must remain active.',
          stance: 'SUPPORTS',
        },
        actor,
      ),
    );
    const revised = await investigate(caseRow.id, actor);
    assert.equal(revised.report.missingEvidence.length, 0);
    const decision = await db.$transaction((tx) =>
      evaluateAndPersist(tx as Prisma.TransactionClient, caseRef, actor),
    );
    assert.equal(decision.disposition, 'BLOCK');
    assert.equal(decision.requiredApprovals, 1);
    await db.$transaction((tx) =>
      addEvidence(
        tx as Prisma.TransactionClient,
        caseRef,
        {
          kind: 'OWNER_CONFIRMATION',
          sourceKey: 'contract-owner',
          recordRef: `owner:${randomUUID()}`,
          excerpt: 'A second owner reconfirms the entitlement remains active.',
          stance: 'SUPPORTS',
        },
        actor,
      ),
    );
    const refreshed = await investigate(caseRow.id, actor);
    assert.notEqual(refreshed.report.id, revised.report.id);
    const refreshedDecision = await db.$transaction((tx) =>
      evaluateAndPersist(tx as Prisma.TransactionClient, caseRef, actor),
    );
    assert.equal(refreshedDecision.disposition, 'BLOCK');
    assert.equal(await db.tgtAudit.count(), targetBefore);
    process.stdout.write('Scenario A through policy: passed\n');
  } else process.stdout.write('Scenario A through ingest: passed\n');
} finally {
  await db.srcBillingSubscription.update({
    where: { id: billing.id },
    data: { planStatus: billing.planStatus },
  });
  await db.$disconnect();
}
