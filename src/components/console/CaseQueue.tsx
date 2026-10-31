import Link from 'next/link';

import { StateBadge } from '@/components/console/StateBadge';
import type { listCases } from '@/lib/gate/queries';

type Row = Awaited<ReturnType<typeof listCases>>['cases'][number];

export function CaseQueue({
  cases,
  basePath = '/app/investigations',
  showInvestigationMeta = false,
}: {
  readonly cases: Row[];
  readonly basePath?: string;
  readonly showInvestigationMeta?: boolean;
}) {
  if (cases.length === 0)
    return (
      <div className="border border-border bg-card p-8 text-sm text-operational-muted">
        No cases match this view.
      </div>
    );
  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table
        className={`w-full border-collapse text-left text-sm ${showInvestigationMeta ? 'min-w-[980px]' : 'min-w-[680px]'}`}
      >
        <caption className="sr-only">
          {showInvestigationMeta ? 'Investigation work queue' : 'Cases in this work queue'}
        </caption>
        <thead className="border-b border-border bg-background text-xs font-medium uppercase tracking-[.05em] text-operational-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-normal">
              Case
            </th>
            <th scope="col" className="px-4 py-3 font-normal">
              State
            </th>
            <th scope="col" className="px-4 py-3 font-normal">
              Risk
            </th>
            {showInvestigationMeta ? (
              <>
                <th scope="col" className="px-4 py-3 font-normal">
                  Hypotheses
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Evidence due
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Actions
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Owner
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  SLA
                </th>
              </>
            ) : (
              <>
                <th scope="col" className="px-4 py-3 font-normal">
                  Severity
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Exposure
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Opened
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {cases.map((row) => (
            <tr key={row.id} className="border-b border-border/70 hover:bg-background">
              <td className="min-w-[240px] px-4 py-3">
                <Link
                  href={`${basePath}/${encodeURIComponent(row.ref)}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block font-mono text-xs text-primary">{row.ref}</span>
                  {row.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StateBadge value={row.status} />
              </td>
              <td className="px-4 py-3 font-mono text-xs">{row.riskScore}</td>
              {showInvestigationMeta ? (
                <>
                  <td className="px-4 py-3 font-mono text-xs">{row.hypothesisCount}</td>
                  <td
                    className={`px-4 py-3 font-mono text-xs ${row.openEvidenceRequests ? 'text-operational-warning' : 'text-operational-muted'}`}
                  >
                    {row.openEvidenceRequests}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{row.actions.length}</td>
                  <td
                    className="max-w-36 truncate px-4 py-3 text-sm"
                    title={row.ownerName ?? undefined}
                  >
                    {row.ownerName ?? 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {row.slaDueAt ? (
                      <time dateTime={row.slaDueAt.toISOString()}>
                        {row.slaDueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                      </time>
                    ) : (
                      <span className="text-operational-muted">Not set</span>
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 font-mono text-xs">{row.severity}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.exposureCount}</td>
                  <td className="px-4 py-3 font-mono text-xs text-operational-muted">
                    <time dateTime={row.openedAt.toISOString()}>
                      {row.openedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                    </time>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
