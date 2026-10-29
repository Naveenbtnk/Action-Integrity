import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';
import { AppError, ForbiddenError, UnauthenticatedError } from '@/lib/errors';

function equalKey(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireServiceKey(
  request: Request,
  header: string,
  current: string,
  previous?: string,
): void {
  if (request.headers.has('cookie'))
    throw new AppError(
      'INVALID_SERVICE_CONTEXT',
      403,
      'A console session cannot use a service route.',
    );
  const supplied = request.headers.get(header);
  if (!supplied && request.headers.has(header === 'x-target-key' ? 'x-agent-key' : 'x-target-key'))
    throw new ForbiddenError();
  if (!supplied) throw new UnauthenticatedError();
  if (equalKey(supplied, current) || (previous && equalKey(supplied, previous))) return;
  if (request.headers.has(header === 'x-target-key' ? 'x-agent-key' : 'x-target-key'))
    throw new ForbiddenError();
  throw new UnauthenticatedError();
}

export function requireTargetKey(request: Request): void {
  requireServiceKey(
    request,
    'x-target-key',
    env.TARGET_SERVICE_KEY,
    env.TARGET_SERVICE_KEY_PREVIOUS,
  );
}

export function requireAgentKey(request: Request): void {
  requireServiceKey(request, 'x-agent-key', env.AGENT_SERVICE_KEY, env.AGENT_SERVICE_KEY_PREVIOUS);
}

export function requireOpsKey(request: Request): void {
  requireServiceKey(request, 'x-ops-key', env.OPS_SERVICE_KEY, env.OPS_SERVICE_KEY_PREVIOUS);
}
