import { z } from 'zod';

import { ActorType, CaseStatus } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { appendAuditEvent } from '@/lib/audit/append';
import { requireHuman } from '@/lib/auth/human';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { requireHumanPermission } from '@/lib/rbac';
import { transitionCase } from '@/lib/state-machine/case';

const Body = z
  .object({
    reason: z.string().min(20).max(2000),
    ownerTeam: z.string().min(1).max(100),
    note: z.string().max(2000).optional(),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  await requireHumanPermission(actor, 'case:escalate', context.requestId, context.traceId);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', actor.id);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid escalation.');
  const output = await withIdempotency(request, actor.id, parsed.data, async (tx) => {
    const caseRow = await tx.case.findUnique({ where: { ref } });
    if (!caseRow) throw new NotFoundError('Case not found.');
    const escalation = await tx.escalationEvent.create({
      data: {
        caseId: caseRow.id,
        reason: parsed.data.reason,
        ownerTeam: parsed.data.ownerTeam,
        note: parsed.data.note ?? null,
        createdById: actor.id,
        createdAt: new Date(),
      },
    });
    await appendAuditEvent(tx, {
      eventType: 'CASE_ESCALATED',
      actorType: ActorType.USER,
      actorId: actor.id,
      caseId: caseRow.id,
      payload: { escalationId: escalation.id, ownerTeam: parsed.data.ownerTeam },
      requestId: context.requestId,
      traceId: context.traceId,
    });
    const updated =
      caseRow.status === CaseStatus.ESCALATED
        ? caseRow
        : await transitionCase(tx, caseRow.id, CaseStatus.ESCALATED, {
            type: ActorType.USER,
            id: actor.id,
            requestId: context.requestId,
            ...(context.traceId ? { traceId: context.traceId } : {}),
          });
    return { status: 201, data: { escalation, caseStatus: updated.status } };
  });
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
