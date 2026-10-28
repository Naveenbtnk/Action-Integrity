import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { getCase } from '@/lib/gate/queries';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

export const GET = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'case:read');
  await enforceAdapterLimit('read', principal.id);
  const ref = new URL(request.url).pathname.split('/cases/')[1];
  if (!ref) throw new ValidationError('Invalid case ref.');
  return successResponse(await getCase(ref), context);
});
