import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { revokeElevation } from '@/lib/break-glass';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { requireHumanPermission } from '@/lib/rbac';

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'break_glass:request', context.requestId, context.traceId);
  const id = new URL(request.url).pathname.split('/break-glass/')[1]?.split('/')[0];
  if (!id) throw new ValidationError('Invalid elevation id.');
  await enforceAdapterLimit('write', actor.id);
  const output = await withIdempotency(request, actor.id, {}, async (tx) => ({
    status: 200,
    data: await revokeElevation(tx, id, {
      ...actor,
      requestId: context.requestId,
      ...(context.traceId ? { traceId: context.traceId } : {}),
    }),
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
