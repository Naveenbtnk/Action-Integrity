import { Activity } from 'lucide-react';
import Link from 'next/link';

import { AppNavigation } from '@/components/shell/AppNavigation';
import { GlobalSearch } from '@/components/shell/GlobalSearch';
import type { Role } from '@/generated/prisma/enums';
import { signOut } from '@/lib/auth/config';
import type { Permission } from '@/lib/rbac';

import type { ReactNode } from 'react';

interface AppShellProps {
  readonly can: (permission: Permission) => boolean;
  readonly children: ReactNode;
  readonly user: { name: string; roles: Role[] };
  readonly environment: string;
  readonly mode: string;
  readonly policy: { version: string; hash: string } | null;
}

export function AppShell({ can, children, user, environment, mode, policy }: AppShellProps) {
  const permissions = (['case:read', 'action:read', 'policy:read', 'audit:read'] as const).filter(
    can,
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] border-r border-border bg-card xl:flex xl:flex-col">
        <div className="flex h-16 items-center border-b border-border px-6">
          <Link href="/app/overview" className="text-sm font-medium tracking-[-.045em]">
            ACTION INTEGRITY
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <AppNavigation permissions={[...permissions]} />
        </div>
        <div className="border-t border-border px-6 py-5">
          <p data-instrument className="text-[10px] text-operational-muted">
            CONTROL PLANE / {environment}
          </p>
        </div>
      </aside>
      <div className="xl:pl-[248px]">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-5 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <Activity className="size-4 text-operational-success" aria-hidden="true" />
            <span data-instrument className="text-xs text-operational-muted">
              {environment}
            </span>
            <span className="border-l border-border pl-3 font-mono text-[11px] text-operational-muted">
              {mode}
            </span>
            {policy && (
              <Link
                href="/app/policies"
                title={policy.hash}
                className="hidden border-l border-border pl-3 font-mono text-[11px] text-operational-muted hover:text-foreground sm:inline"
              >
                POLICY {policy.version}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <GlobalSearch />
            <span className="hidden text-operational-muted md:inline">{user.name}</span>
            <span
              data-instrument
              className="hidden border border-border px-2 py-1 text-[10px] text-operational-muted sm:inline"
            >
              {user.roles.join(' · ')}
            </span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button className="border border-border px-3 py-2 text-xs hover:bg-card focus-visible:ring-2 focus-visible:ring-ring">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="border-b border-border xl:hidden">
          <AppNavigation permissions={[...permissions]} compact />
        </div>
        {user.roles.includes('ADMIN') && (
          <div
            role="status"
            className="border-b border-operational-warning/50 bg-operational-warning/10 px-5 py-2 text-sm text-operational-warning lg:px-8"
          >
            Platform administrators do not decide business actions.
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
