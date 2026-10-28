import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { db } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

export const GET = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'case:read');
  await enforceAdapterLimit('read', principal.id);
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  const caseRow = await db.case.findUnique({ where: { ref }, select: { id: true } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  const report = await db.investigationReport.findFirst({
    where: { caseId: caseRow.id },
    orderBy: { createdAt: 'desc' },
    include: { hypotheses: true },
  });
  return successResponse({ report }, context);
});
