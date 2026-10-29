import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';

export default async function OverviewPage() {
  await pagePrincipalWith('case:read');
  const asOf = new Date();
  const dayAgo = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
  const [counts, attention, recentActions, signals] = await Promise.all([
    db.case.groupBy({ by: ['status'], _count: { id: true } }),
    db.case.findMany({
      where: {
        status: {
          in: [
            'HOLDING',
            'AWAITING_EVIDENCE',
            'AWAITING_APPROVAL',
            'VERIFYING',
            'REOPENED',
            'ESCALATED',
          ],
        },
      },
      include: {
        integrityEvent: { select: { summary: true, type: true } },
        actions: { select: { id: true, ref: true, status: true } },
      },
      orderBy: [{ riskScore: 'desc' }, { openedAt: 'asc' }],
      take: 5,
    }),
    db.outboundAction.groupBy({
      by: ['status'],
      where: { requestedAt: { gte: dayAgo } },
      _count: { id: true },
    }),
    db.integrityEvent.findMany({
      orderBy: { detectedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        type: true,
        summary: true,
        detectedAt: true,
        contract: {
          select: {
            sourceKey: true,
            snapshots: {
              orderBy: { capturedAt: 'desc' },
              take: 1,
              select: { sourceUpdatedAt: true },
            },
          },
        },
      },
    }),
  ]);
  const count = (status: string) => counts.find((item) => item.status === status)?._count.id ?? 0;
  const actionCount = (status: string) =>
    recentActions.find((item) => item.status === status)?._count.id ?? 0;
  const actionTotal = recentActions.reduce((sum, item) => sum + item._count.id, 0);
  return (
    <PageFrame
      eyebrow="MONITOR / 01"
      title="Operational overview"
      description="A concise view of current exposure. Open a queue or case to continue the work."
      actions={
        attention[0] && (
          <Link
            href={`/app/investigations/${attention[0].ref}`}
            className="inline-flex min-h-10 items-center border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary/80"
          >
            Review priority case{' '}
            <span className="ml-3" aria-hidden="true">
              ↗
            </span>
          </Link>
        )
      }
    >
      <section
        className="grid gap-px border border-border bg-border sm:grid-cols-3"
        aria-label="Current posture"
      >
        {[
          ['Held', count('HOLDING') + count('AWAITING_EVIDENCE')],
          ['Awaiting decision', count('AWAITING_APPROVAL')],
          ['Verification failures', count('REOPENED')],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex min-h-20 items-center justify-between gap-3 bg-card px-4 py-3 sm:px-5"
          >
            <p className="text-xs leading-5 text-operational-muted">{label}</p>
            <p className="font-mono text-2xl tabular-nums">{value}</p>
          </div>
        ))}
      </section>
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section
          aria-labelledby="attention-heading"
          className="min-w-0 border border-border bg-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 id="attention-heading" className="text-base font-medium">
                Needs attention
              </h2>
              <p className="mt-1 text-xs text-operational-muted">Highest risk cases first</p>
            </div>
            <Link href="/app/investigations" className="text-xs text-primary hover:underline">
              All investigations ↗
            </Link>
          </div>
          {attention.length === 0 ? (
            <p className="px-5 py-8 text-sm text-operational-muted">
              No active cases need attention.
            </p>
          ) : (
            <ol className="divide-y divide-border/70">
              {attention.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/app/investigations/${row.ref}`}
                    className="grid gap-3 px-5 py-3 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <span className="min-w-0">
                      <span data-instrument className="block truncate text-[10px] text-primary">
                        {row.ref} / RISK {row.riskScore}
                      </span>
                      <span className="mt-1 block truncate text-sm font-medium">{row.title}</span>
                      <span className="mt-1 block line-clamp-1 text-xs text-operational-muted">
                        {row.integrityEvent.summary}
                      </span>
                    </span>
                    <StateBadge value={row.status} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
        <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1" aria-label="Continue work">
          <div className="border border-border bg-card p-5">
            <p data-instrument className="text-[10px] text-primary">
              01 / CONTROL
            </p>
            <h2 className="mt-2 text-base font-medium">Review proposed actions</h2>
            <p className="mt-2 text-xs leading-5 text-operational-muted">
              Inspect gate decisions and the actions currently held.
            </p>
            <Link
              href="/app/actions"
              className="mt-5 inline-flex text-xs text-primary hover:underline"
            >
              Open action queue ↗
            </Link>
          </div>
          <div className="border border-border bg-card p-5">
            <p data-instrument className="text-[10px] text-operational-info">
              02 / PROOF
            </p>
            <h2 className="mt-2 text-base font-medium">Check the outcome</h2>
            <p className="mt-2 text-xs leading-5 text-operational-muted">
              See recoveries and cases awaiting verification.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-primary">
              <Link href="/app/recoveries" className="hover:underline">
                Recoveries ↗
              </Link>
              <Link href="/app/verification" className="hover:underline">
                Verification ↗
              </Link>
            </div>
          </div>
        </aside>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="flow-heading" className="border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p data-instrument className="text-[10px] text-operational-muted">
                LAST 24 HOURS
              </p>
              <h2 id="flow-heading" className="mt-2 text-base font-medium">
                Action flow
              </h2>
            </div>
            <Link href="/app/actions" className="text-xs text-primary hover:underline">
              View queue ↗
            </Link>
          </div>
          <dl className="mt-4 divide-y divide-border text-sm">
            {[
              ['Proposed', actionTotal],
              ['Held', actionCount('HELD')],
              ['Executed', actionCount('EXECUTED')],
              ['Blocked', actionCount('BLOCKED')],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-2">
                <dt className="text-operational-muted">{label}</dt>
                <dd className="font-mono tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="signals-heading" className="border border-border bg-card p-5">
          <p data-instrument className="text-[10px] text-operational-muted">
            SOURCE OBSERVATIONS
          </p>
          <h2 id="signals-heading" className="mt-2 text-base font-medium">
            Recent integrity signals
          </h2>
          {signals.length === 0 ? (
            <p className="mt-4 text-sm text-operational-muted">No signals recorded.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {signals.map((signal) => (
                <li key={signal.id} className="py-3 first:pt-0">
                  <p data-instrument className="text-[10px] text-primary">
                    {signal.contract.sourceKey} / {signal.type}
                  </p>
                  <p className="mt-1 line-clamp-1 text-sm">{signal.summary}</p>
                  <p className="mt-1 text-xs text-operational-muted">
                    Detected{' '}
                    <time dateTime={signal.detectedAt.toISOString()}>
                      {signal.detectedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                    </time>
                    {' · '}Source updated{' '}
                    {signal.contract.snapshots[0] ? (
                      <time dateTime={signal.contract.snapshots[0].sourceUpdatedAt.toISOString()}>
                        {signal.contract.snapshots[0].sourceUpdatedAt
                          .toISOString()
                          .slice(0, 16)
                          .replace('T', ' ')}{' '}
                        UTC
                      </time>
                    ) : (
                      'unknown'
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p data-instrument className="mt-4 text-[10px] text-operational-muted">
        DATA AS OF{' '}
        <time dateTime={asOf.toISOString()}>
          {asOf.toISOString().slice(0, 16).replace('T', ' ')} UTC
        </time>
      </p>
    </PageFrame>
  );
}
