import { z } from 'zod';

import { EvidenceKind, EvidenceStance } from '@/generated/prisma/enums';
import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { addEvidence } from '@/lib/agent/evidence-write';
import { requireHuman } from '@/lib/auth/human';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { requirePermission } from '@/lib/rbac';

const Body = z
  .object({
    kind: z.enum(EvidenceKind),
    sourceKey: z.string().min(1).max(100),
    recordRef: z.string().min(1).max(200),
    excerpt: z.string().min(1).max(2_000),
    stance: z.enum(EvidenceStance),
  })
  .strict();

export const POST = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'case:add_evidence');
  const ref = new URL(request.url).pathname.split('/cases/')[1]?.split('/')[0];
  if (!ref) throw new ValidationError('Invalid case ref.');
  await enforceAdapterLimit('write', `${principal.id}:${ref}`);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid evidence.');
  const output = await withIdempotency(request, principal.id, parsed.data, async (tx) => ({
    status: 201,
    data: await addEvidence(tx, ref, parsed.data, {
      id: principal.id,
      requestId: context.requestId,
      traceId: context.traceId,
    }),
  }));
  return successResponse(output.data, context, {
    status: output.status,
    replayed: output.replayed,
  });
});
