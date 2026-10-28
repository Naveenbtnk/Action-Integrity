import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { IntegrityEventStatus } from '@/generated/prisma/enums';
import { appendIntegrityDismissal } from '@/lib/audit/append';
import { db } from '@/lib/db';
import { AppError, ConflictError, NotFoundError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';

export async function dismissIntegrityEvent(input: {
  eventId: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  requestId: string;
  traceId?: string | undefined;
}) {
  const scope = `integrity:dismiss:${input.actorId}`;
  const requestHash = sha({ eventId: input.eventId, reason: input.reason });
  const existing = await db.idempotencyRecord.findUnique({
    where: { scope_key: { scope, key: input.idempotencyKey } },
  });
  if (existing) {
    if (existing.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'The key was used with a different request.');
    if (existing.status !== 'COMPLETED')
      throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'The request is still in progress.');
    const event = await db.integrityEvent.findUniqueOrThrow({ where: { id: input.eventId } });
    return { event, replayed: true };
  }
  return db.$transaction(async (tx) => {
    const inserted = await tx.idempotencyRecord.createMany({
      data: [
        {
          scope,
          key: input.idempotencyKey,
          requestHash,
          status: 'IN_PROGRESS',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
      skipDuplicates: true,
    });
    if (!inserted.count)
      throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'The request is still in progress.');
    const changed = await tx.integrityEvent.updateMany({
      where: { id: input.eventId, status: IntegrityEventStatus.OPEN },
      data: {
        status: IntegrityEventStatus.DISMISSED,
        dismissedReason: input.reason,
        dismissedById: input.actorId,
        dismissedAt: new Date(),
      },
    });
    if (!changed.count) {
      const event = await tx.integrityEvent.findUnique({
        where: { id: input.eventId },
        select: { status: true },
      });
      if (!event) throw new NotFoundError('Integrity event not found.');
      throw new AppError('INTEGRITY_EVENT_NOT_OPEN', 409, 'Integrity event is not open.');
    }
    await appendIntegrityDismissal(tx as Prisma.TransactionClient, {
      eventId: input.eventId,
      actorId: input.actorId,
      reasonHash: sha(input.reason),
      requestId: input.requestId,
      traceId: input.traceId,
    });
    await tx.idempotencyRecord.update({
      where: { scope_key: { scope, key: input.idempotencyKey } },
      data: {
        status: 'COMPLETED',
        responseStatus: 200,
        responseBody: { eventId: input.eventId },
        resourceType: 'IntegrityEvent',
        resourceId: input.eventId,
        completedAt: new Date(),
      },
    });
    const event = await tx.integrityEvent.findUniqueOrThrow({ where: { id: input.eventId } });
    return { event, replayed: false };
  });
}
