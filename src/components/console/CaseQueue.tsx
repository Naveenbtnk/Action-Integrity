import Link from 'next/link';

import { StateBadge } from '@/components/console/StateBadge';
import type { listCases } from '@/lib/gate/queries';

type Row = Awaited<ReturnType<typeof listCases>>['cases'][number];

export function CaseQueue({
  cases,
  basePath = '/app/investigations',
}: {
  readonly cases: Row[];
  readonly basePath?: string;
}) {
  if (cases.length === 0)
    return (
      <div className="border border-border bg-card p-8 text-sm text-operational-muted">
        No cases match this view.
      </div>
    );
  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="border-b border-border bg-background font-mono text-[11px] uppercase text-operational-muted">
          <tr>
            <th className="px-4 py-3 font-normal">Case</th>
            <th className="px-4 py-3 font-normal">State</th>
            <th className="px-4 py-3 font-normal">Severity</th>
            <th className="px-4 py-3 font-normal">Risk</th>
            <th className="px-4 py-3 font-normal">Exposure</th>
            <th className="px-4 py-3 font-normal">Opened</th>
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
                  <span className="block font-mono text-[11px] text-primary">{row.ref}</span>
                  {row.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StateBadge value={row.status} />
              </td>
              <td className="px-4 py-3 font-mono text-xs">{row.severity}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.riskScore}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.exposureCount}</td>
              <td className="px-4 py-3 font-mono text-[11px] text-operational-muted">
                <time dateTime={row.openedAt.toISOString()}>{row.openedAt.toLocaleString()}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
