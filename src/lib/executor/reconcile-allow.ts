import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { ActorType, OutboundActionStatus } from '@/generated/prisma/enums';
import type { TargetAdapter } from '@/lib/adapters/types';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { sha } from '@/lib/integrity/hash';
import { enqueue } from '@/lib/outbox/enqueue';

import { targetChange, targetRef } from './action';
import { createTargetClient } from './target-client';

export async function reconcileAllowedUnknown(
  requestId: string,
  client?: TargetAdapter,
): Promise<number> {
  const rows = await db.actionExecution.findMany({
    where: { caseId: null, status: 'UNKNOWN', outboundActionId: { not: null } },
    include: { outboundAction: true },
    orderBy: { startedAt: 'asc' },
    take: 50,
  });
  let resolved = 0;
  for (const row of rows) {
    const action = row.outboundAction;
    if (!action) continue;
    const change = targetChange(action);
    const ref = targetRef(change);
    let observed;
    try {
      const target = client ?? createTargetClient();
      observed =
        ref.targetObjectType === 'entitlement'
          ? await target.getEntitlement(ref.accountId, ref.key)
          : await target.getServiceStatus(ref.accountId);
    } catch {
      continue;
    }
    const field = ref.targetObjectType === 'entitlement' ? 'status' : 'state';
    const observedValue = (observed as Record<string, unknown> | null)?.[field];
    const passed = observedValue === change.to;
    const changed = await db.$transaction(async (raw) => {
      const tx = raw as Prisma.TransactionClient;
      await tx.$queryRaw`SELECT id FROM action_execution WHERE id = ${row.id} FOR UPDATE`;
      const current = await tx.actionExecution.findUniqueOrThrow({ where: { id: row.id } });
      if (current.status !== 'UNKNOWN') return false;
      const verification = await tx.verificationResult.create({
        data: {
          caseId: null,
          executionId: row.id,
          expectedState: { [field]: change.to },
          observedState: observed ? (observed as Prisma.InputJsonValue) : Prisma.JsonNull,
          observedStateHash: sha(observed),
          passed,
          mismatches: passed
            ? []
            : [{ field, expected: change.to, observed: observedValue ?? null }],
          attemptCount: 1,
          checkedAt: new Date(),
        },
      });
      await tx.actionExecution.update({
        where: { id: row.id },
        data: {
          status: passed ? 'SUCCEEDED' : 'FAILED',
          resolvedByVerification: true,
          resolvedAt: new Date(),
        },
      });
      if (passed)
        await tx.outboundAction.update({
          where: { id: action.id },
          data: { status: OutboundActionStatus.EXECUTED },
        });
      await appendAuditEvent(tx, {
        eventType: passed ? 'ACTION_VERIFIED' : 'VERIFICATION_FAILED',
        actorType: ActorType.SYSTEM,
        actorId: 'reconcile',
        payload: { executionId: row.id, verificationId: verification.id, passed },
        requestId,
      });
      await enqueue(tx, {
        eventType: passed ? 'ACTION_VERIFIED' : 'VERIFICATION_FAILED',
        aggregateType: 'OutboundAction',
        aggregateId: action.id,
        payload: { actionRef: action.ref, verificationId: verification.id },
        dedupeKey: `execution:${row.id}:reconciled`,
      });
      return true;
    });
    if (changed) resolved++;
  }
  return resolved;
}
