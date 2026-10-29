import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { ValidationError } from '@/lib/errors';
import { reconcileExecutions } from '@/lib/executor/reconcile';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotencyExternal } from '@/lib/idempotency';
import { requirePermission } from '@/lib/rbac';
import { requireOpsKey } from '@/lib/target/auth';

const Body = z.object({ dryRun: z.boolean().optional() }).strict();

export const POST = withRoute(async (request, context) => {
  requireOpsKey(request);
  requirePermission({ service: 'SERVICE_OPS' }, 'ops:reconcile');
  await enforceAdapterLimit('write', 'service-ops');
  const raw = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid reconciliation request.');
  const output = await withIdempotencyExternal(request, 'service-ops', parsed.data, async () => ({
    status: 200,
    data: await reconcileExecutions({
      requestId: context.requestId,
      ...(parsed.data.dryRun === undefined ? {} : { dryRun: parsed.data.dryRun }),
    }),
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
