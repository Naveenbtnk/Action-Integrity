import Link from 'next/link';

import { CaseQueue } from '@/components/console/CaseQueue';
import { PageFrame } from '@/components/console/PageFrame';
import { CaseStatus } from '@/generated/prisma/enums';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { listCases } from '@/lib/gate/queries';

const views = [
  'ALL',
  'HOLDING',
  'AWAITING_EVIDENCE',
  'AWAITING_APPROVAL',
  'REOPENED',
  'ESCALATED',
] as const;

export default async function InvestigationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  await pagePrincipalWith('case:read');
  const params = await searchParams;
  const status = Object.values(CaseStatus).find((value) => value === params.status);
  const result = await listCases({ status, cursor: params.cursor, limit: 30 });
  return (
    <PageFrame
      eyebrow="INVESTIGATE / 01"
      title="Investigations"
      description="Held and escalated cases, with the evidence and decision record one click away."
    >
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Investigation views">
        {views.map((view) => (
          <Link
            key={view}
            href={view === 'ALL' ? '/app/investigations' : `/app/investigations?status=${view}`}
            aria-current={(status ?? 'ALL') === view ? 'page' : undefined}
            className={`border px-3 py-2 font-mono text-xs ${status === view || (!status && view === 'ALL') ? 'border-primary text-foreground' : 'border-border text-operational-muted'}`}
          >
            {view.replaceAll('_', ' ')}
          </Link>
        ))}
      </div>
      <CaseQueue cases={result.cases} />
      {result.nextCursor && (
        <Link
          href={`/app/investigations?${status ? `status=${status}&` : ''}cursor=${encodeURIComponent(result.nextCursor)}`}
          className="mt-5 inline-block border border-border px-4 py-2 text-sm"
        >
          Next page
        </Link>
      )}
    </PageFrame>
  );
}
