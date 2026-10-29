import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { requireHumanPermission } from '@/lib/rbac';
import { reopenCase } from '@/lib/verifier/reopen';

const Body = z.object({ reason: z.string().trim().min(20).max(2000) }).strict();

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'case:reopen', context.requestId, context.traceId);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', `${actor.id}:${ref}`);
  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid reopen request.');
  const output = await withIdempotency(request, actor.id, { ref, ...parsed.data }, async (tx) => ({
    status: 200,
    data: {
      case: await reopenCase(tx, {
        caseRef: ref,
        reason: parsed.data.reason,
        actorId: actor.id,
        requestId: context.requestId,
        ...(context.traceId ? { traceId: context.traceId } : {}),
      }),
    },
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
