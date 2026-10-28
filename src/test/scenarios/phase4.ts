import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { GateDecision, IntegrityEventType, OutboundActionType } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { ingestAction } from '@/lib/gate/ingest';
import { withIdempotency } from '@/lib/idempotency';
import { evaluateContracts } from '@/lib/integrity-runner/evaluate';

const options = new Set(process.argv.slice(2));
if (!options.has('--scenario=A') || !options.has('--upto=ingest')) {
  throw new Error('Only --scenario=A --upto=ingest is implemented in Phase 4.');
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
  process.stdout.write('Scenario A through ingest: passed\n');
} finally {
  await db.srcBillingSubscription.update({
    where: { id: billing.id },
    data: { planStatus: billing.planStatus },
  });
  await db.$disconnect();
}
