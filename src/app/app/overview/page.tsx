import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';

export default async function OverviewPage() {
  await pagePrincipalWith('case:read');
  const [counts, attention] = await Promise.all([
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
  ]);
  const count = (status: string) => counts.find((item) => item.status === status)?._count.id ?? 0;
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
    </PageFrame>
  );
}
