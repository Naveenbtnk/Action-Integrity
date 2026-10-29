import { AppShell } from '@/components/shell/AppShell';
import { pagePrincipal } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { ROLE_PERMISSIONS } from '@/lib/rbac';

import type { ReactNode } from 'react';

export default async function ApplicationLayout({ children }: { readonly children: ReactNode }) {
  const user = await pagePrincipal();
  const activePolicy = await db.policyVersion.findFirst({
    where: { status: 'ACTIVE' },
    select: { version: true, hash: true },
  });
  return (
    <AppShell
      user={{ name: user.name, roles: user.roles }}
      environment={env.NODE_ENV.toUpperCase()}
      mode={env.INVESTIGATION_MODE.toUpperCase()}
      policy={activePolicy ? { version: activePolicy.version, hash: activePolicy.hash } : null}
      can={(permission) => user.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission))}
    >
      {children}
    </AppShell>
  );
}
