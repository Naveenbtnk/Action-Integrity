'use client';

import type { DecisionSnapshot } from '@/lib/ui/decision-snapshot';
import { formatDecisionSnapshot } from '@/lib/ui/decision-snapshot';

function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function CaseSnapshotDownload({ snapshot }: { readonly snapshot: DecisionSnapshot }) {
  const filename = `case-${snapshot.case.ref.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return (
    <div className="mt-5 border-t border-border pt-5">
      <p className="text-sm font-medium">Download case snapshot</p>
      <p className="mt-2 text-sm leading-6 text-operational-muted">
        Captured {snapshot.capturedAt}. This unsigned file may become stale; check the live case
        before acting.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="border border-border px-3 py-2 text-sm hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() =>
            downloadFile(
              `${filename}.json`,
              JSON.stringify(snapshot, null, 2),
              'application/json;charset=utf-8',
            )
          }
        >
          Download JSON
        </button>
        <button
          type="button"
          className="border border-border px-3 py-2 text-sm hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() =>
            downloadFile(
              `${filename}.md`,
              formatDecisionSnapshot(snapshot),
              'text/markdown;charset=utf-8',
            )
          }
        >
          Download Markdown
        </button>
      </div>
    </div>
  );
}
