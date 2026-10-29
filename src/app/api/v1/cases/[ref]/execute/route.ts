import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { executeApprovedCase } from '@/lib/executor/execute';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotencyExternal } from '@/lib/idempotency';
import { requireHumanPermission } from '@/lib/rbac';

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'case:execute', context.requestId, context.traceId);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', `${actor.id}:${ref}`);
  const key = request.headers.get('idempotency-key') ?? '';
  const output = await withIdempotencyExternal(request, actor.id, { ref }, async () => {
    const data = await executeApprovedCase({
      caseRef: ref,
      actor: {
        ...actor,
        requestId: context.requestId,
        ...(context.traceId ? { traceId: context.traceId } : {}),
      },
      requestKey: key,
    });
    return { status: data.noTargetWrite ? 200 : 202, data };
  });
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
