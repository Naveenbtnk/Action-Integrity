'use client';

import {
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { StateBadge } from '@/components/console/StateBadge';

export interface ActionRow {
  id: string;
  ref: string;
  accountId: string;
  actionType: string;
  gateDecision: string;
  status: string;
  caseRef: string | null;
  requestedAtLabel: string;
}

const features = tableFeatures({ columnVisibilityFeature });
const helper = createColumnHelper<typeof features, ActionRow>();
const columns = helper.columns([
  helper.accessor('ref', {
    header: 'Action',
    enableHiding: false,
    cell: (info) => (
      <Link
        href={`/app/actions/${info.row.original.id}`}
        title={info.getValue()}
        className="block max-w-52 truncate font-mono text-xs text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  helper.accessor('accountId', { header: 'Account' }),
  helper.accessor('actionType', {
    header: 'Proposed action',
    cell: (info) => info.getValue().toLowerCase().replaceAll('_', ' '),
  }),
  helper.accessor('gateDecision', { header: 'Gate' }),
  helper.accessor('status', {
    header: 'State',
    cell: (info) => <StateBadge value={info.getValue()} />,
  }),
  helper.accessor('caseRef', {
    header: 'Case',
    cell: (info) =>
      info.getValue() ? (
        <Link
          href={`/app/investigations/${info.getValue()}`}
          title={info.getValue() ?? undefined}
          className="block max-w-44 truncate font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {info.getValue()}
        </Link>
      ) : (
        '—'
      ),
  }),
  helper.accessor('requestedAtLabel', { header: 'Requested' }),
]);

export function ActionTable({
  rows,
  sort,
  status,
}: {
  readonly rows: ActionRow[];
  readonly sort: 'newest' | 'oldest';
  readonly status: string | null;
}) {
  const router = useRouter();
  const [compact, setCompact] = useState(false);
  const table = useTable({ features, columns, data: rows });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-operational-muted">
          {rows.length} action{rows.length === 1 ? '' : 's'} on this page
        </p>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex border border-border" aria-label="Action order">
            {(['newest', 'oldest'] as const).map((value) => (
              <Link
                key={value}
                href={`/app/actions?${new URLSearchParams({ ...(status ? { status } : {}), ...(value === 'oldest' ? { sort: value } : {}) })}`}
                aria-current={sort === value ? 'page' : undefined}
                className={`flex min-h-9 items-center px-2 focus-visible:ring-2 focus-visible:ring-ring ${sort === value ? 'bg-primary/10 text-foreground' : 'text-operational-muted hover:text-foreground'}`}
              >
                {value === 'newest' ? 'Newest' : 'Oldest'}
              </Link>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={compact}
            onClick={() => setCompact((value) => !value)}
            className="min-h-9 border border-border px-3 text-operational-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {compact ? 'Comfortable rows' : 'Compact rows'}
          </button>
          <details className="relative">
            <summary className="flex min-h-9 cursor-pointer list-none items-center border border-border px-3 text-operational-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Columns
            </summary>
            <div className="absolute right-0 z-10 mt-1 min-w-44 space-y-1 border border-border bg-card p-2">
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <label
                    key={column.id}
                    className="flex min-h-9 cursor-pointer items-center gap-2 px-2 hover:bg-background"
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={(event) => column.toggleVisibility(event.target.checked)}
                      className="accent-primary"
                    />
                    {String(column.columnDef.header)}
                  </label>
                ))}
            </div>
          </details>
        </div>
      </div>
      <div className="overflow-x-auto border border-border bg-card">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <caption className="sr-only">Proposed business actions and their gate outcomes</caption>
          <thead className="border-b border-border bg-background font-mono text-[11px] uppercase text-operational-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} scope="col" className="px-4 py-3 font-normal">
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                aria-label={`Open action ${row.original.ref}`}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter') router.push(`/app/actions/${row.original.id}`);
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const siblings = [
                      ...(event.currentTarget.parentElement?.querySelectorAll('tr') ?? []),
                    ];
                    const index = siblings.indexOf(event.currentTarget);
                    const next = siblings[index + (event.key === 'ArrowDown' ? 1 : -1)];
                    if (next instanceof HTMLElement) next.focus();
                  }
                }}
                className="border-b border-border/70 hover:bg-background focus-visible:bg-background focus-visible:outline-2 focus-visible:outline-primary"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`px-4 font-mono text-xs ${compact ? 'py-2' : 'py-3'}`}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-operational-muted">
        Use ↑ and ↓ to move between rows; press Enter to open the focused action.
      </p>
    </div>
  );
}
