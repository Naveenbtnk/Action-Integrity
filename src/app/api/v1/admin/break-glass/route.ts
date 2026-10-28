import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import { BreakGlassStatus } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { expireElevations, requestElevation } from '@/lib/break-glass';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { requireHumanPermission, requirePermission } from '@/lib/rbac';

const Body = z
  .object({
    caseRef: z.string().min(1),
    reason: z.string().min(50).max(2000),
    ttlMinutes: z.number().int().min(1).max(60),
  })
  .strict();
const Query = z
  .object({
    status: z.enum(BreakGlassStatus).optional(),
    caseRef: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'break_glass:request', context.requestId, context.traceId);
  await enforceAdapterLimit('write', actor.id);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid elevation request.');
  const output = await withIdempotency(request, actor.id, parsed.data, async (tx) => ({
    status: 201,
    data: await requestElevation(tx, {
      ...parsed.data,
      actor: {
        ...actor,
        requestId: context.requestId,
        ...(context.traceId ? { traceId: context.traceId } : {}),
      },
    }),
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});

export const GET = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  requirePermission(actor, 'break_glass:read');
  await enforceAdapterLimit('read', actor.id);
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw new ValidationError('Invalid elevation query.');
  await db.$transaction((tx) =>
    expireElevations(tx as Prisma.TransactionClient, context.requestId),
  );
  const rows = await db.breakGlassElevation.findMany({
    where: {
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.caseRef ? { caseRef: query.data.caseRef } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.data.limit + 1,
    ...(query.data.cursor ? { cursor: { id: query.data.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      caseRef: true,
      status: true,
      requestedById: true,
      cosignedById: true,
      cosignExpiresAt: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
    },
  });
  return successResponse(
    {
      elevations: rows.slice(0, query.data.limit),
      nextCursor: rows.length > query.data.limit ? (rows[query.data.limit - 1]?.id ?? null) : null,
    },
    context,
  );
});
