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
  return <AppShell can={(permission) => visiblePermissions.has(permission)}>{children}</AppShell>;
}
