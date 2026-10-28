import { z } from 'zod';

import { CaseMode, CaseStatus, Disposition, Severity } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { listCases } from '@/lib/gate/queries';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

const Query = z
  .object({
    status: z.enum(CaseStatus).optional(),
    severity: z.enum(Severity).optional(),
    mode: z.enum(CaseMode).optional(),
    riskBand: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    disposition: z.enum(Disposition).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const GET = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'case:read');
  await enforceAdapterLimit('read', principal.id);
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw new ValidationError('Invalid case query.');
  return successResponse(await listCases(query.data), context);
});
