import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { db } from '@/lib/db';

export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ q?: string }>;
}) {
  await pagePrincipalWith('case:read');
  const { q } = await searchParams;
  const term = q?.trim().slice(0, 80) ?? '';
  const [cases, actions] = term
    ? await Promise.all([
        db.case.findMany({
          where: { ref: { contains: term, mode: 'insensitive' } },
          orderBy: { openedAt: 'desc' },
          take: 20,
        }),
        db.outboundAction.findMany({
          where: {
            OR: [
              { ref: { contains: term, mode: 'insensitive' } },
              { accountId: { contains: term, mode: 'insensitive' } },
            ],
          },
          orderBy: { requestedAt: 'desc' },
          take: 20,
        }),
      ])
    : [[], []];
  return (
    <PageFrame
      eyebrow="WORKSPACE / SEARCH"
      title="Search"
      description={
        term
          ? `Results for ${term}`
          : 'Search by case reference, action reference, or account identifier.'
      }
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 text-xl font-medium">Cases</h2>
          {cases.length ? (
            <div className="space-y-2">
              {cases.map((item) => (
                <Link
                  key={item.id}
                  href={`/app/investigations/${item.ref}`}
                  className="flex items-center justify-between gap-3 border border-border bg-card p-4 hover:border-primary"
                >
                  <span>
                    <span className="block font-mono text-xs text-primary">{item.ref}</span>
                    {item.title}
                  </span>
                  <StateBadge value={item.status} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="border border-border bg-card p-5 text-sm text-operational-muted">
              No matching cases.
            </p>
          )}
        </section>
        <section>
          <h2 className="mb-4 text-xl font-medium">Actions</h2>
          {actions.length ? (
            <div className="space-y-2">
              {actions.map((item) => (
                <Link
                  key={item.id}
                  href={`/app/actions/${item.id}`}
                  className="flex items-center justify-between gap-3 border border-border bg-card p-4 hover:border-primary"
                >
                  <span>
                    <span className="block font-mono text-xs text-primary">{item.ref}</span>
                    {item.accountId}
                  </span>
                  <StateBadge value={item.status} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="border border-border bg-card p-5 text-sm text-operational-muted">
              No matching actions.
            </p>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
