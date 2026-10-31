import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { ActorType, CaseStatus } from '@/generated/prisma/enums';
import { expireApprovals } from '@/lib/approval';
import { appendAuditEvent } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { enqueue } from '@/lib/outbox/enqueue';
import { transitionCase } from '@/lib/state-machine/case';

import { reconcileAllowedUnknown } from './reconcile-allow';

type Summary = {
  executionsMarkedUnknown: number;
  evidenceRequestsExpired: number;
  approvalsExpired: number;
  casesEscalated: number;
  outboxRequeued: number;
};

export async function reconcileExecutions(input: {
  requestId: string;
  dryRun?: boolean;
}): Promise<Summary> {
  const started = new Date();
  if (!input.dryRun)
    await db.jobHeartbeat.upsert({
      where: { job: 'reconcile' },
      create: { job: 'reconcile', lastStartedAt: started },
      update: { lastStartedAt: started },
    });
  try {
    const result = await db.$transaction(
      async (raw) => {
        const tx = raw as Prisma.TransactionClient;
        const lock = await tx.$queryRaw<
          Array<{ acquired: boolean }>
        >`SELECT pg_try_advisory_xact_lock(81657232007) AS acquired`;
        if (!lock[0]?.acquired) return null;
        const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
        const now = clock[0]?.now ?? new Date();
        const staleBefore = new Date(now.getTime() - env.EXECUTION_TIMEOUT_MS);
        const pending = await tx.actionExecution.findMany({
          where: { status: 'PENDING', startedAt: { lt: staleBefore } },
          include: { case: { select: { status: true, ref: true, reopenCount: true } } },
        });
        const evidence = await tx.evidenceRequest.findMany({
          where: { status: 'REQUESTED', dueAt: { lte: now } },
          include: { case: { select: { status: true, ref: true, reopenCount: true } } },
        });
        const approvals = await tx.approval.findMany({
          where: { status: 'VALID', decision: 'APPROVE', expiresAt: { lte: now } },
          select: { caseId: true },
          distinct: ['caseId'],
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          take: 5,
        });
        const orphanedOutbox = await tx.outboxEvent.findMany({
          where: {
            status: 'PUBLISHING',
            nextAttemptAt: { lte: new Date(now.getTime() - 300_000) },
          },
          select: { id: true, eventType: true },
        });
        const summary: Summary = {
          executionsMarkedUnknown: pending.length,
          evidenceRequestsExpired: evidence.length,
          approvalsExpired: 0,
          casesEscalated: 0,
          outboxRequeued: 0,
        };
        if (input.dryRun) {
          summary.approvalsExpired = await tx.approval.count({
            where: { status: 'VALID', decision: 'APPROVE', expiresAt: { lte: now } },
          });
          summary.casesEscalated = evidence.filter(
            (row) => row.case.status === CaseStatus.AWAITING_EVIDENCE,
          ).length;
          summary.outboxRequeued = orphanedOutbox.length;
          return summary;
        }
        for (const row of pending) {
          const changed = await tx.actionExecution.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: { status: 'UNKNOWN', failureCode: 'EXECUTION_TIMED_OUT', finishedAt: now },
          });
          if (!changed.count) continue;
          await appendAuditEvent(tx, {
            eventType: 'EXECUTION_RECONCILED_UNKNOWN',
            actorType: ActorType.SYSTEM,
            caseId: row.caseId,
            payload: { executionId: row.id, from: 'PENDING', to: 'UNKNOWN' },
            requestId: input.requestId,
          });
          if (row.caseId && row.case?.status === CaseStatus.EXECUTING)
            await transitionCase(tx, row.caseId, CaseStatus.VERIFYING, {
              type: ActorType.SYSTEM,
              requestId: input.requestId,
            });
        }
        for (const row of evidence) {
          const changed = await tx.evidenceRequest.updateMany({
            where: { id: row.id, status: 'REQUESTED' },
            data: { status: 'EXPIRED', resolvedAt: now },
          });
          if (!changed.count) continue;
          await appendAuditEvent(tx, {
            eventType: 'EVIDENCE_REQUEST_EXPIRED',
            actorType: ActorType.SYSTEM,
            caseId: row.caseId,
            payload: { evidenceRequestId: row.id },
            requestId: input.requestId,
          });
          if (row.case.status === CaseStatus.AWAITING_EVIDENCE) {
            await transitionCase(tx, row.caseId, CaseStatus.ESCALATED, {
              type: ActorType.SYSTEM,
              requestId: input.requestId,
            });
            await enqueue(tx, {
              eventType: 'CASE_ESCALATED',
              aggregateType: 'Case',
              aggregateId: row.caseId,
              payload: { caseRef: row.case.ref, reason: 'EVIDENCE_REQUEST_EXPIRED' },
              dedupeKey: `case:${row.caseId}:${row.case.reopenCount}:evidence-expired:${row.id}`,
            });
            summary.casesEscalated++;
          }
        }
        for (const row of approvals)
          summary.approvalsExpired += await expireApprovals(tx, row.caseId, input.requestId, now);
        for (const row of orphanedOutbox) {
          const changed = await tx.outboxEvent.updateMany({
            where: { id: row.id, status: 'PUBLISHING' },
            data: { status: 'PENDING', nextAttemptAt: now },
          });
          if (!changed.count) continue;
          summary.outboxRequeued++;
          await appendAuditEvent(tx, {
            eventType: 'OUTBOX_REQUEUED',
            actorType: ActorType.SYSTEM,
            payload: { outboxEventId: row.id, eventType: row.eventType },
            requestId: input.requestId,
          });
        }
        return summary;
      },
      { timeout: 30_000 },
    );
    if (!input.dryRun) await reconcileAllowedUnknown(input.requestId);
    if (!input.dryRun)
      await db.jobHeartbeat.update({
        where: { job: 'reconcile' },
        data: { lastSuccessAt: new Date(), lastError: null, consecutiveFailures: 0 },
      });
    return (
      result ?? {
        executionsMarkedUnknown: 0,
        evidenceRequestsExpired: 0,
        approvalsExpired: 0,
        casesEscalated: 0,
        outboxRequeued: 0,
      }
    );
  } catch (error) {
    if (!input.dryRun)
      await db.jobHeartbeat
        .update({
          where: { job: 'reconcile' },
          data: {
            lastError: error instanceof Error ? error.name : 'UNKNOWN',
            consecutiveFailures: { increment: 1 },
          },
        })
        .catch(() => undefined);
    throw error;
  }
}
