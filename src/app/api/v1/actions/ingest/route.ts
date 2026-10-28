import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import { OutboundActionType } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { ValidationError } from '@/lib/errors';
import { ingestAction } from '@/lib/gate/ingest';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { requirePermission } from '@/lib/rbac';
import { requireAgentKey } from '@/lib/target/auth';

const Body = z
  .object({
    sourceAgent: z.string().trim().min(1).max(128),
    accountId: z.string().regex(/^acc_\d{5}$/),
    actionType: z.enum(OutboundActionType),
    payload: z.unknown().refine((value) => value !== undefined),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  requireAgentKey(request);
  requirePermission({ service: 'SERVICE_AGENT' }, 'service:ingest');
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid ingest request.');
  await enforceAdapterLimit('ingest', `agent:${parsed.data.accountId}`);
  const output = await withIdempotency(request, 'service-agent', parsed.data, async (tx) => ({
    status: 201,
    data: await ingestAction(tx, {
      ...parsed.data,
      payload: parsed.data.payload as Prisma.InputJsonValue,
      requestedAt: new Date(parsed.data.requestedAt),
      idempotencyKey: request.headers.get('idempotency-key') ?? '',
      requestId: context.requestId,
      ...(context.traceId ? { traceId: context.traceId } : {}),
    }),
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
