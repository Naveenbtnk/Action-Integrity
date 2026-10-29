import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { ActorType, CaseStatus } from '@/generated/prisma/enums';
import { appendAuditEvent } from '@/lib/audit/append';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { transitionCase } from '@/lib/state-machine/case';

export async function reopenCase(
  tx: Prisma.TransactionClient,
  input: { caseRef: string; reason: string; actorId: string; requestId: string; traceId?: string },
) {
  const row = await tx.case.findUnique({ where: { ref: input.caseRef } });
  if (!row) throw new NotFoundError('Case not found.');
  if (row.status !== CaseStatus.CLOSED_RESOLVED) throw new ConflictError('INVALID_TRANSITION');
  const updated = await transitionCase(tx, row.id, CaseStatus.REOPENED, {
    type: ActorType.USER,
    id: input.actorId,
    requestId: input.requestId,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  });
  await appendAuditEvent(tx, {
    eventType: 'CASE_REOPENED',
    actorType: ActorType.USER,
    actorId: input.actorId,
    caseId: row.id,
    payload: { reason: input.reason },
    requestId: input.requestId,
    traceId: input.traceId,
  });
  return updated;
}
