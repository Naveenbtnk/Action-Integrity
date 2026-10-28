import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { db } from '@/lib/db';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

export const GET = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  requirePermission(actor, 'policy:read');
  await enforceAdapterLimit('read', actor.id);
  const policies = await db.policyVersion.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      version: true,
      hash: true,
      status: true,
      reviewTicket: true,
      activatedAt: true,
      retiredAt: true,
      createdAt: true,
    },
  });
  return successResponse(policies, context);
});
