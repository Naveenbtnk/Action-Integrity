import { redirect } from 'next/navigation';

import { AppShell } from '@/components/shell/AppShell';

import type { ReactNode } from 'react';

const visiblePermissions = new Set([
  'action:read',
  'audit:read',
  'case:read',
  'contract:read',
  'kpi:read',
  'policy:read',
]);

export default function ApplicationLayout({ children }: { readonly children: ReactNode }) {
  // Phase 0/2 has no authenticated session yet. Phase 6 replaces this guard.
  redirect('/login');
  return <AppShell can={(permission) => visiblePermissions.has(permission)}>{children}</AppShell>;
}
