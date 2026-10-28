import type { Prisma } from '@/generated/prisma/client';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { assertQuorum } from '@/lib/approval';
import { requireHuman } from '@/lib/auth/human';
import { db } from '@/lib/db';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

export const GET = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  requirePermission(actor, 'case:read');
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('read', actor.id);
  const caseRow = await db.case.findUnique({
    where: { ref },
    select: { id: true, reopenCount: true },
  });
  if (!caseRow) throw new NotFoundError('Case not found.');
  const approvals = await db.approval.findMany({
    where: { caseId: caseRow.id, reopenCount: caseRow.reopenCount },
    orderBy: { createdAt: 'asc' },
    include: { reviewer: { select: { id: true, name: true, roles: true } } },
  });
  const decision = await db.policyDecision.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { createdAt: 'desc' },
  });
  let quorum = null;
  if (decision) {
    try {
      const summary = await db.$transaction((tx) =>
        assertQuorum(tx as Prisma.TransactionClient, caseRow.id, decision),
      );
      quorum = {
        ...summary,
        expiresAt:
          approvals.find((row) => row.status === 'VALID')?.expiresAt ?? decision.approvalExpiresAt,
        disposition: decision.disposition,
        evidenceHash: decision.evidenceHash,
        policyHash: decision.policyHash,
      };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      quorum = {
        met: false,
        current: 0,
        required: decision.requiredApprovals,
        requiredRoles: decision.requiredRoles,
        satisfiedRoles: [],
        missingRoles: decision.requiredRoles,
        expiresAt: decision.approvalExpiresAt,
        disposition: decision.disposition,
        evidenceHash: decision.evidenceHash,
        policyHash: decision.policyHash,
        invalidReason: error.code,
      };
    }
  }
  return successResponse({ approvals, quorum }, context);
});
