'use client';

import {
  ArrowUpRight,
  BookOpenCheck,
  CircleGauge,
  FileClock,
  LifeBuoy,
  ListChecks,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Permission } from '@/lib/rbac';

const navigation = [
  {
    label: 'Monitor',
    items: [
      { label: 'Overview', href: '/app/overview', icon: CircleGauge, permission: 'case:read' },
      { label: 'Actions', href: '/app/actions', icon: ListChecks, permission: 'action:read' },
    ],
  },
  {
    label: 'Investigate',
    items: [
      {
        label: 'Investigations',
        href: '/app/investigations',
        icon: Search,
        permission: 'case:read',
      },
    ],
  },
  {
    label: 'Resolve',
    items: [
      { label: 'Recoveries', href: '/app/recoveries', icon: LifeBuoy, permission: 'case:read' },
      {
        label: 'Verification',
        href: '/app/verification',
        icon: BookOpenCheck,
        permission: 'case:read',
      },
    ],
  },
  {
    label: 'Control',
    items: [
      { label: 'Policies', href: '/app/policies', icon: ShieldCheck, permission: 'policy:read' },
      { label: 'Audit', href: '/app/audit', icon: FileClock, permission: 'audit:read' },
    ],
  },
  {
    label: 'Workspace',
    items: [{ label: 'Settings', href: '/app/settings', icon: Settings, permission: 'case:read' }],
  },
] as const;

export function AppNavigation({
  permissions,
  compact = false,
}: {
  readonly permissions: Permission[];
  readonly compact?: boolean;
}) {
  const pathname = usePathname();
  const groups = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => permissions.includes(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  if (compact) {
    return (
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-4 py-2 xl:hidden">
        {groups
          .flatMap((group) => group.items)
          .map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-10 shrink-0 items-center gap-2 border px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary/10 text-foreground' : 'border-transparent text-operational-muted hover:border-border hover:text-foreground'}`}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
      </nav>
    );
  }

  return (
    <nav aria-label="Primary" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p
            data-instrument
            className="mb-2 px-3 text-[10px] uppercase tracking-[.14em] text-operational-muted"
          >
            {group.label}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex min-h-10 items-center gap-3 border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-transparent text-operational-muted hover:border-border hover:bg-background hover:text-foreground'}`}
                >
                  <item.icon
                    className={`size-4 ${active ? 'text-primary' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                  <ArrowUpRight
                    className="ml-auto size-3 opacity-0 group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
