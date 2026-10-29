import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { OutboundActionStatus } from '@/generated/prisma/enums';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { listActions } from '@/lib/gate/queries';

const views = ['ALL', 'HELD', 'PENDING', 'EXECUTED', 'BLOCKED', 'RELEASED'] as const;

export default async function ActionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  await pagePrincipalWith('action:read');
  const params = await searchParams;
  const status = Object.values(OutboundActionStatus).find((value) => value === params.status);
  const result = await listActions({ status, cursor: params.cursor, limit: 30 });
  return (
    <PageFrame
      eyebrow="MONITOR / 02"
      title="Action queue"
      description="Every proposed action and its deterministic gate outcome. Open an action to inspect what was held, allowed, or blocked."
    >
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Action views">
        {views.map((view) => (
          <Link
            key={view}
            href={view === 'ALL' ? '/app/actions' : `/app/actions?status=${view}`}
            aria-current={(status ?? 'ALL') === view ? 'page' : undefined}
            className={`border px-3 py-2 font-mono text-xs ${status === view || (!status && view === 'ALL') ? 'border-primary text-foreground' : 'border-border text-operational-muted hover:text-foreground'}`}
          >
            {view}
          </Link>
        ))}
      </div>
      {result.actions.length === 0 ? (
        <div className="border border-border bg-card p-8 text-sm text-operational-muted">
          No outbound actions in this view.
        </div>
      ) : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-background font-mono text-[11px] uppercase text-operational-muted">
              <tr>
                <th className="px-4 py-3 font-normal">Action</th>
                <th className="px-4 py-3 font-normal">Account</th>
                <th className="px-4 py-3 font-normal">Type</th>
                <th className="px-4 py-3 font-normal">Gate</th>
                <th className="px-4 py-3 font-normal">State</th>
                <th className="px-4 py-3 font-normal">Case</th>
              </tr>
            </thead>
            <tbody>
              {result.actions.map((action) => (
                <tr key={action.id} className="border-b border-border/70 hover:bg-background">
                  <td className="max-w-[200px] px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/app/actions/${action.id}`}
                      title={action.ref}
                      className="block truncate text-foreground underline-offset-4 hover:underline"
                    >
                      {action.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{action.accountId}</td>
                  <td className="px-4 py-3 text-xs capitalize">
                    {action.actionType.toLowerCase().replaceAll('_', ' ')}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{action.gateDecision}</td>
                  <td className="px-4 py-3">
                    <StateBadge value={action.status} />
                  </td>
                  <td className="max-w-[190px] px-4 py-3 font-mono text-xs">
                    {action.caseRef ? (
                      <Link
                        href={`/app/investigations/${action.caseRef}`}
                        title={action.caseRef}
                        className="block truncate underline-offset-4 hover:underline"
                      >
                        {action.caseRef}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.nextCursor && (
        <Link
          href={`/app/actions?${status ? `status=${status}&` : ''}cursor=${encodeURIComponent(result.nextCursor)}`}
          className="mt-5 inline-block border border-border px-4 py-2 text-sm"
        >
          Next page
        </Link>
      )}
    </PageFrame>
  );
}
