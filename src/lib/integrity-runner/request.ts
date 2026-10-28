import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError } from '@/lib/errors';
import { sha } from '@/lib/integrity/hash';
import { evaluateContracts, type EvaluationResult } from '@/lib/integrity-runner/evaluate';

export async function evaluateIdempotently(
  contractKeys: string[] | undefined,
  key: string,
): Promise<{ result: EvaluationResult; replayed: boolean }> {
  const scope = 'integrity:evaluate:service-agent';
  const requestHash = sha({ contractKeys: contractKeys ?? null });
  const lookup = { scope_key: { scope, key } };
  const previous = await db.idempotencyRecord.findUnique({ where: lookup });
  if (previous) {
    if (previous.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'The key was used with a different request.');
    if (previous.status !== 'COMPLETED' || !previous.responseBody)
      throw new ConflictError('IDEMPOTENCY_IN_PROGRESS', 'The request is still in progress.');
    return { result: previous.responseBody as EvaluationResult, replayed: true };
  }
  const inserted = await db.idempotencyRecord.createMany({
    data: [
      {
        scope,
        key,
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
  try {
    const result = await evaluateContracts(contractKeys);
    await db.idempotencyRecord.update({
      where: lookup,
      data: {
        status: 'COMPLETED',
        responseStatus: 200,
        responseBody: result as Prisma.InputJsonObject,
        completedAt: new Date(),
      },
    });
    return { result, replayed: false };
  } catch (cause) {
    await db.idempotencyRecord.deleteMany({ where: { scope, key, status: 'IN_PROGRESS' } });
    throw cause;
  }
}
