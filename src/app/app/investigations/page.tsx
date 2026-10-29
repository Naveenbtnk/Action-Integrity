import Link from 'next/link';

import { CaseQueue } from '@/components/console/CaseQueue';
import { PageFrame } from '@/components/console/PageFrame';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { listCases } from '@/lib/gate/queries';

const views = [
  { id: 'active', label: 'Active' },
  { id: 'evidence', label: 'Evidence needed' },
  { id: 'owner', label: 'Assigned to me' },
  { id: 'approval', label: 'Awaiting approval' },
  { id: 'reopened', label: 'Reopened' },
  { id: 'escalated', label: 'Escalated' },
] as const;

export default async function InvestigationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ view?: string; cursor?: string }>;
}) {
  const principal = await pagePrincipalWith('case:read');
  const params = await searchParams;
  const view = views.find((item) => item.id === params.view)?.id ?? 'active';
  const result = await listCases({
    ...(view === 'active'
      ? {
          statusNotIn: ['CLOSED_RESOLVED', 'CLOSED_NO_ACTION', 'CLOSED_ESCALATED'] as const,
        }
      : view === 'evidence'
        ? { status: 'AWAITING_EVIDENCE' as const }
        : view === 'owner'
          ? {
              assignedToId: principal.id,
              statusNotIn: ['CLOSED_RESOLVED', 'CLOSED_NO_ACTION', 'CLOSED_ESCALATED'] as const,
            }
          : view === 'approval'
            ? { status: 'AWAITING_APPROVAL' as const }
            : view === 'reopened'
              ? { status: 'REOPENED' as const }
              : { status: 'ESCALATED' as const }),
    cursor: params.cursor,
    limit: 30,
  });
  return (
    <PageFrame
      eyebrow="INVESTIGATE / 01"
      title="Investigations"
      description="Six focused work views, with evidence, ownership, and decision context one click away."
    >
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Investigation views">
        {views.map((item) => (
          <Link
            key={item.id}
            href={
              item.id === 'active' ? '/app/investigations' : `/app/investigations?view=${item.id}`
            }
            aria-current={view === item.id ? 'page' : undefined}
            className={`border px-3 py-2 font-mono text-xs ${view === item.id ? 'border-primary text-foreground' : 'border-border text-operational-muted'}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <CaseQueue cases={result.cases} showInvestigationMeta />
      {result.nextCursor && (
        <Link
          href={`/app/investigations?${new URLSearchParams({ ...(view === 'active' ? {} : { view }), cursor: result.nextCursor })}`}
          className="mt-5 inline-block border border-border px-4 py-2 text-sm"
        >
          Next page
        </Link>
      )}
    </PageFrame>
  );
}
