import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { getAction } from '@/lib/gate/queries';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

export const GET = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'action:read');
  await enforceAdapterLimit('read', principal.id);
  const id = new URL(request.url).pathname.split('/actions/')[1];
  if (!id) throw new ValidationError('Invalid action id.');
  return successResponse(await getAction(id), context);
});
