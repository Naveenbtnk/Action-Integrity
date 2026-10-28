import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { requireHuman } from '@/lib/auth/human';
import { AppError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { dismissIntegrityEvent } from '@/lib/integrity-runner/dismiss';
import { requirePermission } from '@/lib/rbac';

const Body = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

export const POST = withRoute(async (request, context) => {
  const principal = await requireHuman(request);
  requirePermission(principal, 'integrity:dismiss');
  await enforceAdapterLimit('write', principal.id);
  const key = request.headers.get('idempotency-key');
  if (!key) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key is required.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new ValidationError('Invalid Idempotency-Key.');
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError('A dismissal reason of at least three characters is required.');
  const path = new URL(request.url).pathname;
  const id = path.split('/events/')[1]?.split('/')[0];
  if (!id) throw new ValidationError('Invalid event id.');
  const output = await dismissIntegrityEvent({
    eventId: id,
    actorId: principal.id,
    reason: parsed.data.reason,
    idempotencyKey: key,
    requestId: context.requestId,
    traceId: context.traceId,
  });
  return successResponse(output.event, context, { replayed: output.replayed });
});
