import { z } from 'zod';

import { IntegrityEventStatus, Severity } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman, requireIntegrityPermission } from '@/lib/auth/human';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';

const Query = z.object({
  status: z.enum(IntegrityEventStatus).optional(),
  severity: z.enum(Severity).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requireIntegrityPermission(principal, 'integrity:read');
  await enforceAdapterLimit('read', principal.id);
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw new ValidationError('Invalid event query.');
  const { status, severity, cursor, limit } = query.data;
  const rows = await db.integrityEvent.findMany({
    where: { ...(status ? { status } : {}), ...(severity ? { severity } : {}) },
    orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      contractId: true,
      type: true,
      severity: true,
      detectedAt: true,
      summary: true,
      scopeSelector: true,
      evidenceSnapshotIds: true,
      status: true,
      dismissedAt: true,
      dismissedById: true,
      fingerprint: true,
    },
  });
  return successResponse(
    { events: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]?.id : null },
    context,
  );
});
