import type { Prisma } from '@/generated/prisma/client';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { expireElevations } from '@/lib/break-glass';
import { db } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';

export const GET = withRoute(async (request, context) => {
  const actor = await requireHuman(request);
  requirePermission(actor, 'break_glass:read');
  const id = new URL(request.url).pathname.split('/break-glass/')[1]?.split('/')[0];
  if (!id) throw new ValidationError('Invalid elevation id.');
  await enforceAdapterLimit('read', actor.id);
  await db.$transaction((tx) =>
    expireElevations(tx as Prisma.TransactionClient, context.requestId),
  );
  const row = await db.breakGlassElevation.findUnique({
    where: { id },
    include: { approvals: true },
  });
  if (!row) throw new NotFoundError('Elevation not found.');
  return successResponse(row, context);
});
