import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { AppError, ConflictError, ValidationError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';

type WorkResult<T> = { status: number; data: T; resourceType?: string; resourceId?: string };

export async function withIdempotency<T>(
  request: Request,
  actorKey: string,
  body: unknown,
  work: (tx: Prisma.TransactionClient) => Promise<WorkResult<T>>,
): Promise<{ status: number; data: T; replayed: boolean }> {
  const key = request.headers.get('idempotency-key');
  if (!key) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key is required.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new ValidationError('Invalid Idempotency-Key.');
  const scope = `${new URL(request.url).pathname}:${actorKey}`;
  const requestHash = sha(body);
  const lookup = { scope_key: { scope, key } };

  async function existingResult() {
    const existing = await db.idempotencyRecord.findUnique({ where: lookup });
    if (!existing) return null;
    if (existing.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'The key was used with a different request.');
    if (existing.status === 'COMPLETED' && existing.responseBody && existing.responseStatus) {
      return { status: existing.responseStatus, data: existing.responseBody as T, replayed: true };
    }
    return null;
  }

  const prior = await existingResult();
  if (prior) return prior;
  const now = new Date();
  const inserted = await db.idempotencyRecord.createMany({
    data: [
      {
        scope,
        key,
        requestHash,
        status: 'IN_PROGRESS',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      },
    ],
    skipDuplicates: true,
  });
  if (!inserted.count) {
    const deadline = Date.now() + 5_000;
    do {
      const completed = await existingResult();
      if (completed) return completed;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'The request is still in progress.', {
      retryAfter: 1,
    });
  }
  try {
    const result = await db.$transaction(
      async (transaction) => {
        const tx = transaction as Prisma.TransactionClient;
        const response = await work(tx);
        const normalized = JSON.parse(
          JSON.stringify(response.data, (_, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        ) as T;
        await tx.idempotencyRecord.update({
          where: lookup,
          data: {
            status: 'COMPLETED',
            responseStatus: response.status,
            responseBody: normalized as Prisma.InputJsonValue,
            resourceType: response.resourceType ?? null,
            resourceId: response.resourceId ?? null,
            completedAt: new Date(),
          },
        });
        return { ...response, data: normalized };
      },
      { timeout: 15_000 },
    );
    return { status: result.status, data: result.data, replayed: false };
  } catch (cause) {
    await db.idempotencyRecord
      .deleteMany({ where: { scope, key, status: 'IN_PROGRESS' } })
      .catch(() => undefined);
    throw cause;
  }
}
