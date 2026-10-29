import 'server-only';

import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db';
import type { Permission } from '@/lib/rbac';
import { requirePermission } from '@/lib/rbac';

export async function pagePrincipal() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect('/login');
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, roles: true, sessionEpoch: true, isActive: true },
  });
  if (!user?.isActive) redirect('/login?reason=user_inactive');
  if (user.sessionEpoch !== session.user.sessionEpoch) redirect('/login?reason=session_stale');
  return user;
}

export async function pagePrincipalWith(permission: Permission) {
  const user = await pagePrincipal();
  try {
    requirePermission(user, permission);
  } catch {
    redirect(`/forbidden?permission=${encodeURIComponent(permission)}`);
  }
  return user;
}
