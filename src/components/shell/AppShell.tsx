import {
  Activity,
  Blocks,
  BookOpenCheck,
  ChartNoAxesCombined,
  CircleGauge,
  FileClock,
  GitBranch,
  KeyRound,
  LifeBuoy,
  ListChecks,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

type ShellPermission =
  | 'action:read'
  | 'audit:read'
  | 'case:read'
  | 'contract:read'
  | 'kpi:read'
  | 'ops:read'
  | 'policy:read'
  | 'user:read';

interface AppShellProps {
  readonly can: (permission: ShellPermission) => boolean;
  readonly children: ReactNode;
}

const navigation = [
  {
    label: 'Monitor',
    items: [
      { label: 'Overview', icon: CircleGauge, permission: 'kpi:read' as const },
      { label: 'Action Queue', icon: ListChecks, permission: 'action:read' as const },
    ],
  },
  {
    label: 'Investigate',
    items: [
      { label: 'Investigations', icon: Search, permission: 'case:read' as const },
      { label: 'Evidence Explorer', icon: GitBranch, permission: 'case:read' as const },
    ],
  },
  {
    label: 'Resolve',
    items: [
      { label: 'Recoveries', icon: LifeBuoy, permission: 'case:read' as const },
      { label: 'Verification', icon: BookOpenCheck, permission: 'case:read' as const },
    ],
  },
  {
    label: 'Control',
    items: [
      { label: 'Policies', icon: ShieldCheck, permission: 'policy:read' as const },
      { label: 'Integrations', icon: Blocks, permission: 'contract:read' as const },
      { label: 'Audit', icon: FileClock, permission: 'audit:read' as const },
    ],
  },
  {
    label: 'Improve',
    items: [{ label: 'Analytics', icon: ChartNoAxesCombined, permission: 'kpi:read' as const }],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Access', icon: KeyRound, permission: 'user:read' as const },
      { label: 'Operations', icon: Settings, permission: 'ops:read' as const },
    ],
  },
] as const;

export function AppShell({ can, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] border-r border-border bg-card lg:block">
        <div className="flex h-14 items-center border-b border-border px-5">
          <Link href="/app" className="font-medium tracking-[-0.04em]">
            ACTION INTEGRITY
          </Link>
        </div>
        <nav aria-label="Primary" className="h-[calc(100vh-3.5rem)] overflow-y-auto px-3 py-5">
          {navigation.map((group) => {
            const visibleItems = group.items.filter((item) => can(item.permission));

            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label} className="mb-6">
                <p data-instrument className="px-2 text-[11px] text-muted-foreground">
                  {group.label.toUpperCase()}
                </p>
                <div className="mt-2 space-y-1">
                  {visibleItems.map((item) => (
                    <div
                      key={item.label}
                      className="flex min-h-9 items-center gap-3 rounded-md px-2 text-sm text-muted-foreground"
                    >
                      <item.icon className="size-4" aria-hidden="true" />
                      <span>{item.label}</span>
                      <span data-instrument className="ml-auto text-[10px]">
                        SOON
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <Activity className="size-4 text-operational-success" aria-hidden="true" />
            <span data-instrument className="text-xs text-muted-foreground">
              FOUNDATION MODE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              data-instrument
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground"
            >
              DEMO
            </span>
            <span
              data-instrument
              className="hidden rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground sm:block"
            >
              POLICY 2026.10.1
            </span>
          </div>
        </header>
        <div className="border-b border-operational-warning/40 bg-operational-warning/10 px-5 py-3 text-sm text-operational-warning lg:px-8">
          Authentication and business workflows are intentionally unavailable in the foundation
          phase.
        </div>
        {children}
      </div>
    </div>
  );
}
