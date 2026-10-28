import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { activatePolicy } from '@/lib/policy/activate';
import { requireHumanPermission } from '@/lib/rbac';

const Body = z
  .object({
    version: z.string().min(1),
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    reviewTicket: z.string().min(1),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'policy:activate', context.requestId, context.traceId);
  await enforceAdapterLimit('write', actor.id);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid policy activation.');
  const output = await withIdempotency(request, actor.id, parsed.data, async (tx) => ({
    status: 200,
    data: await activatePolicy(tx, {
      ...parsed.data,
      actorId: actor.id,
      requestId: context.requestId,
      ...(context.traceId ? { traceId: context.traceId } : {}),
    }),
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
