import { z } from 'zod';

import { OutboundActionStatus } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { listActions } from '@/lib/gate/queries';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

const Query = z
  .object({
    status: z.enum(OutboundActionStatus).optional(),
    accountId: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const GET = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'action:read');
  await enforceAdapterLimit('read', principal.id);
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw new ValidationError('Invalid action query.');
  return successResponse(await listActions(query.data), context);
});
