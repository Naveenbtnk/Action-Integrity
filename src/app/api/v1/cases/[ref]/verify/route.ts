import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotencyExternal } from '@/lib/idempotency';
import { requireHumanPermission } from '@/lib/rbac';
import { verifyCase } from '@/lib/verifier/verify';

const Body = z.object({ attempts: z.number().int().min(1).max(3).optional() }).strict();

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'case:verify', context.requestId, context.traceId);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', `${actor.id}:${ref}`);
  const raw = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid verification request.');
  const output = await withIdempotencyExternal(
    request,
    actor.id,
    { ref, ...parsed.data },
    async () => ({
      status: 201,
      data: await verifyCase({
        caseRef: ref,
        ...(parsed.data.attempts ? { attempts: parsed.data.attempts } : {}),
        actor: {
          id: actor.id,
          requestId: context.requestId,
          ...(context.traceId ? { traceId: context.traceId } : {}),
        },
      }),
    }),
  );
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
