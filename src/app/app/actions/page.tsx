import Link from 'next/link';

import { ActionTable } from '@/components/console/ActionTable';
import { PageFrame } from '@/components/console/PageFrame';
import { OutboundActionStatus } from '@/generated/prisma/enums';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { listActions } from '@/lib/gate/queries';

const views = ['ALL', 'HELD', 'PENDING', 'EXECUTED', 'BLOCKED', 'RELEASED'] as const;

export default async function ActionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string; cursor?: string; sort?: string }>;
}) {
  await pagePrincipalWith('action:read');
  const params = await searchParams;
  const status = Object.values(OutboundActionStatus).find((value) => value === params.status);
  const sort = params.sort === 'oldest' ? 'oldest' : 'newest';
  const result = await listActions({ status, sort, cursor: params.cursor, limit: 30 });
  const rows = result.actions.map((action) => ({
    id: action.id,
    ref: action.ref,
    accountId: action.accountId,
    actionType: action.actionType,
    gateDecision: action.gateDecision,
    status: action.status,
    caseRef: action.caseRef,
    requestedAtLabel: `${action.requestedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  }));
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
            href={`/app/actions?${new URLSearchParams({ ...(view === 'ALL' ? {} : { status: view }), ...(sort === 'oldest' ? { sort } : {}) })}`}
            aria-current={(status ?? 'ALL') === view ? 'page' : undefined}
            className={`border px-3 py-2 font-mono text-xs ${status === view || (!status && view === 'ALL') ? 'border-primary text-foreground' : 'border-border text-operational-muted hover:text-foreground'}`}
          >
            {view}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="border border-border bg-card p-8 text-sm text-operational-muted">
          No outbound actions in this view.
        </div>
      ) : (
        <ActionTable rows={rows} sort={sort} status={status ?? null} />
      )}
      {result.nextCursor && (
        <Link
          href={`/app/actions?${new URLSearchParams({ ...(status ? { status } : {}), ...(sort === 'oldest' ? { sort } : {}), cursor: result.nextCursor })}`}
          className="mt-5 inline-block border border-border px-4 py-2 text-sm"
        >
          Next page
        </Link>
      )}
    </PageFrame>
  );
}
