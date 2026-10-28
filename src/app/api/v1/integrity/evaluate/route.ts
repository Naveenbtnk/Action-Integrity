import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { AppError, ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { evaluateIdempotently } from '@/lib/integrity-runner/request';
import { requireAgentKey } from '@/lib/target/auth';

const Body = z
  .object({ contractKeys: z.array(z.string().min(1).max(128)).max(100).optional() })
  .strict();

export const POST = withRoute(async (request, context) => {
  requireAgentKey(request);
  const key = request.headers.get('idempotency-key');
  if (!key) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key is required.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new ValidationError('Invalid Idempotency-Key.');
  await enforceAdapterLimit('integrity', 'agent');
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid evaluate request.');
  const output = await evaluateIdempotently(parsed.data.contractKeys, key);
  return successResponse(output.result, context, { replayed: output.replayed });
});
