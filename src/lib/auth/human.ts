import 'server-only';

import { getToken } from 'next-auth/jwt';

import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, ForbiddenError, SessionStaleError, UnauthenticatedError } from '@/lib/errors';

export type HumanPrincipal = { id: string; roles: Role[] };

export async function requireHuman(request: Request): Promise<HumanPrincipal> {
  if (
    request.headers.has('x-agent-key') ||
    request.headers.has('x-target-key') ||
    request.headers.has('x-ops-key') ||
    request.headers.has('authorization')
  ) {
    throw new AppError(
      'INVALID_SERVICE_CONTEXT',
      403,
      'A service principal cannot use a human route.',
    );
  }
  if (!request.headers.get('cookie')?.includes(`${env.SESSION_COOKIE_NAME}=`))
    throw new UnauthenticatedError();
  let token;
  try {
    token = await getToken({
      req: request,
      secret: env.AUTH_SECRET,
      cookieName: env.SESSION_COOKIE_NAME,
    });
  } catch {
    throw new UnauthenticatedError();
  }
  if (!token?.sub || typeof token.sessionEpoch !== 'number') throw new UnauthenticatedError();
  const user = await db.user.findUnique({
    where: { id: token.sub },
    select: { id: true, roles: true, sessionEpoch: true, isActive: true },
  });
  if (!user) throw new UnauthenticatedError();
  if (!user.isActive) throw new AppError('USER_INACTIVE', 403, 'User is inactive.');
  if (user.sessionEpoch !== token.sessionEpoch) throw new SessionStaleError();
  return { id: user.id, roles: user.roles };
}

export function requireIntegrityPermission(
  principal: HumanPrincipal,
  permission: 'integrity:read' | 'integrity:dismiss',
): void {
  if (permission === 'integrity:read') return;
  if (principal.roles.includes(Role.REVIEWER) || principal.roles.includes(Role.SENIOR_REVIEWER))
    return;
  throw new ForbiddenError();
}
