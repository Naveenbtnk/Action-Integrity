import { trace } from '@opentelemetry/api';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { logger } from '@/lib/observability/logger';
import { withSpan } from '@/lib/observability/tracing';
import { evaluateAndPersist } from '@/lib/policy/persist';
import { requireHumanPermission } from '@/lib/rbac';

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'case:compute_policy', context.requestId, context.traceId);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', `${actor.id}:${ref}`);
  const output = await withSpan('policy.decide', {}, async () => {
    const result = await withIdempotency(request, actor.id, {}, async (tx) => ({
      status: 201,
      data: await evaluateAndPersist(tx, ref, {
        id: actor.id,
        requestId: context.requestId,
        ...(context.traceId ? { traceId: context.traceId } : {}),
      }),
    }));
    const span = trace.getActiveSpan();
    span?.setAttribute('risk.score', result.data.riskScore);
    span?.setAttribute('policy.disposition', result.data.disposition);
    span?.setAttribute('policy.version', result.data.policyVersion);
    span?.setAttribute('policy.hash', result.data.policyHash);
    span?.setAttribute('approvals.required', result.data.requiredApprovals);
    return result;
  });
  logger.info(
    {
      requestId: context.requestId,
      caseRef: ref,
      policyVersion: output.data.policyVersion,
      policyHash: output.data.policyHash,
      riskScore: output.data.riskScore,
      disposition: output.data.disposition,
    },
    'policy.decided',
  );
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
