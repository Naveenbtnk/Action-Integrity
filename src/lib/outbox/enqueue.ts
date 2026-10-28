import 'server-only';

import type { Prisma } from '@/generated/prisma/client';

export async function enqueue(
  tx: Prisma.TransactionClient,
  event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Prisma.InputJsonValue;
    dedupeKey: string;
  },
) {
  return tx.outboxEvent.create({
    data: {
      ...event,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
    },
  });
}
