import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { investigate } from '@/lib/agent/investigator';
import { requireHuman } from '@/lib/auth/human';
import { db } from '@/lib/db';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotencyExternal } from '@/lib/idempotency';
import { requirePermission } from '@/lib/rbac';

const Body = z.object({ force: z.boolean().optional() }).strict();

export const POST = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'case:investigate');
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  const caseRow = await db.case.findUnique({ where: { ref }, select: { id: true } });
  if (!caseRow) throw new NotFoundError('Case not found.');
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid investigate request.');
  const output = await withIdempotencyExternal(request, principal.id, parsed.data, async () => {
    await enforceAdapterLimit('investigate', `${principal.id}:${caseRow.id}`);
    const result = await investigate(
      caseRow.id,
      {
        id: principal.id,
        requestId: context.requestId,
        traceId: context.traceId,
      },
      parsed.data.force ? { force: true } : {},
    );
    return {
      status: 202,
      data: {
        runId: result.report.runId,
        status: 'INVESTIGATING',
        cached: result.cached,
      },
      resourceType: 'InvestigationReport',
      resourceId: result.report.id,
    };
  });
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
