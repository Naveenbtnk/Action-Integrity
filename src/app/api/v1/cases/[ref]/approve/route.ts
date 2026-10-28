import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import { ApprovalDecision, Disposition } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { recordApproval } from '@/lib/approval';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { logger } from '@/lib/observability/logger';
import { withSpan } from '@/lib/observability/tracing';
import { requireHumanPermission } from '@/lib/rbac';

const Body = z
  .object({
    decision: z.enum(ApprovalDecision),
    disposition: z.enum(Disposition),
    rationale: z.string().max(2000),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'case:approve', context.requestId, context.traceId);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', `${actor.id}:${ref}`);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid approval.');
  const output = await withSpan('approval.record', {}, async () => {
    const result = await withIdempotency(request, actor.id, parsed.data, async (tx) => ({
      status: 201,
      data: await recordApproval(tx, {
        caseRef: ref,
        actor: {
          ...actor,
          requestId: context.requestId,
          ...(context.traceId ? { traceId: context.traceId } : {}),
        },
        ...parsed.data,
      }),
    }));
    const span = trace.getActiveSpan();
    span?.setAttribute('approval.decision', result.data.approval.decision);
    span?.setAttribute('approval.disposition', result.data.approval.disposition);
    span?.setAttribute('approval.break_glass', result.data.approval.breakGlass);
    span?.setAttribute('quorum.current', result.data.quorum.current);
    span?.setAttribute('quorum.required', result.data.quorum.required);
    return result;
  });
  logger.info(
    {
      requestId: context.requestId,
      caseRef: ref,
      approvalId: output.data.approval.id,
      decision: output.data.approval.decision,
      quorumCurrent: output.data.quorum.current,
      quorumRequired: output.data.quorum.required,
    },
    'approval.recorded',
  );
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
