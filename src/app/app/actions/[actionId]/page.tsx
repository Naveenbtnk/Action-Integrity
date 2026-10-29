import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { getAction } from '@/lib/gate/queries';

export default async function ActionDetailPage({
  params,
}: {
  readonly params: Promise<{ actionId: string }>;
}) {
  await pagePrincipalWith('action:read');
  const { actionId } = await params;
  const detail = await getAction(actionId);
  const action = detail.action;
  return (
    <PageFrame
      eyebrow={`MONITOR / ACTION ${action.ref}`}
      title={action.actionType.replaceAll('_', ' ')}
      description="A proposed business action, its deterministic gate result, and the evidence that shaped the hold or release."
      actions={
        detail.caseRef && (
          <Link
            href={`/app/investigations/${detail.caseRef}`}
            className="border border-primary px-4 py-2 text-sm text-primary hover:bg-card"
          >
            Open case {detail.caseRef} →
          </Link>
        )
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-medium">Gate decision</h2>
              <StateBadge value={action.status} />
            </div>
            <p className="mt-5 font-mono text-sm text-primary">{detail.gate.decision}</p>
            {detail.gate.reasons.length ? (
              <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-operational-muted">
                {detail.gate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-operational-muted">No gate reasons recorded.</p>
            )}
          </section>
          <section className="border border-border bg-card p-6">
            <h2 className="text-xl font-medium">Proposed target effect</h2>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-operational-muted">Account</dt>
                <dd className="mt-1 font-mono">{action.accountId}</dd>
              </div>
              <div>
                <dt className="text-operational-muted">Source agent</dt>
                <dd className="mt-1 font-mono">{action.sourceAgent}</dd>
              </div>
            </dl>
            <pre className="mt-5 max-h-80 overflow-auto border border-border bg-background p-4 font-mono text-xs leading-6">
              {JSON.stringify(action.payload, null, 2)}
            </pre>
          </section>
          {detail.restorePoint && (
            <section className="border border-border bg-card p-6">
              <h2 className="text-xl font-medium">Restore point</h2>
              <p className="mt-3 text-sm text-operational-muted">
                Captured before the target write. Compensation must verify against this state.
              </p>
              <pre className="mt-5 overflow-auto border border-border bg-background p-4 text-xs">
                {JSON.stringify(detail.restorePoint.state, null, 2)}
              </pre>
            </section>
          )}
        </div>
        <aside className="space-y-6">
          <section className="border border-border bg-card p-6">
            <h2 className="font-medium">Impact scope</h2>
            <p className="mt-4 font-mono text-2xl">{detail.exposure.accountIds.length}</p>
            <p className="text-sm text-operational-muted">exposed accounts</p>
            <p className="mt-4 text-sm text-operational-muted">
              {detail.exposure.event?.summary ?? 'No linked integrity event.'}
            </p>
          </section>
          <section className="border border-border bg-card p-6">
            <h2 className="font-medium">Record</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-operational-muted">Requested</dt>
                <dd>
                  <time dateTime={action.requestedAt.toISOString()}>
                    {action.requestedAt.toLocaleString()}
                  </time>
                </dd>
              </div>
              <div>
                <dt className="text-operational-muted">Gate evaluated</dt>
                <dd>
                  <time dateTime={action.gateEvaluatedAt.toISOString()}>
                    {action.gateEvaluatedAt.toLocaleString()}
                  </time>
                </dd>
              </div>
              <div>
                <dt className="text-operational-muted">Payload hash</dt>
                <dd className="break-all font-mono text-xs">{action.payloadHash}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </PageFrame>
  );
}
