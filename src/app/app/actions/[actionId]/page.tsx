import Link from 'next/link';

import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { getAction, getCase } from '@/lib/gate/queries';

export default async function ActionDetailPage({
  params,
}: {
  readonly params: Promise<{ actionId: string }>;
}) {
  await pagePrincipalWith('action:read');
  const { actionId } = await params;
  const detail = await getAction(actionId);
  const action = detail.action;
  const linkedCase = detail.caseRef ? await getCase(detail.caseRef) : null;
  const citations =
    linkedCase?.investigation && Array.isArray(linkedCase.investigation.citations)
      ? linkedCase.investigation.citations.map((item) =>
          typeof item === 'string' ? item : JSON.stringify(item),
        )
      : [];
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
          {linkedCase && (
            <section className="border border-border bg-card p-6">
              <h2 className="text-xl font-medium">Evidence and conflicts</h2>
              <p className="mt-2 text-sm text-operational-muted">
                Evidence is recorded on the linked case. Review the sources before making a
                decision.
              </p>
              {linkedCase.evidence.length === 0 ? (
                <p className="mt-4 text-sm text-operational-warning">
                  No evidence has been recorded yet.
                </p>
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {(['SUPPORTS', 'CONTRADICTS', 'NEUTRAL'] as const).map((stance) => {
                    const entries = linkedCase.evidence.filter((item) => item.stance === stance);
                    return (
                      <div key={stance} className="border border-border bg-background p-4">
                        <h3 data-instrument className="text-xs text-primary">
                          {stance} / {entries.length}
                        </h3>
                        {entries.length === 0 ? (
                          <p className="mt-3 text-xs text-operational-muted">None recorded</p>
                        ) : (
                          <ul className="mt-3 space-y-3 text-xs">
                            {entries.slice(0, 3).map((item) => (
                              <li key={item.id} className="border-l border-border pl-3">
                                <p className="font-mono text-operational-info">
                                  {item.sourceKey} / {item.recordRef}
                                </p>
                                <p className="mt-1 line-clamp-2 text-operational-muted">
                                  {item.excerpt}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {linkedCase.evidenceRequests.some((request) => request.status === 'REQUESTED') && (
                <p className="mt-4 text-sm text-operational-warning">
                  Missing evidence is still requested from an owner.
                </p>
              )}
            </section>
          )}
          {linkedCase?.investigation && (
            <section className="border border-border bg-card p-6">
              <p data-instrument className="text-xs text-operational-info">
                AGENT RECOMMENDATION
              </p>
              <h2 className="mt-2 text-xl font-medium">Investigation finding</h2>
              <p className="mt-3 text-sm leading-6 text-operational-muted">
                {linkedCase.investigation.reasoning}
              </p>
              <p className="mt-3 font-mono text-xs">
                {linkedCase.investigation.recommendedDisposition} · confidence{' '}
                {String(linkedCase.investigation.confidence)}
                {linkedCase.investigation.isFallback ? ' · Baseline mode' : ''}
              </p>
              <h3 className="mt-5 text-sm font-medium">Citations</h3>
              {citations.length === 0 ? (
                <p className="mt-2 text-sm text-operational-warning">
                  No citations in this report.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 break-all font-mono text-xs text-operational-muted">
                  {citations.slice(0, 5).map((citation, index) => (
                    <li key={`${index}:${citation}`}>{citation}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
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
          {linkedCase?.policy && (
            <section className="border border-border bg-card p-6">
              <h2 className="font-medium">Policy boundary</h2>
              <p className="mt-3 font-mono text-sm text-primary">{linkedCase.policy.disposition}</p>
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-operational-muted">Version</dt>
                  <dd className="font-mono">{linkedCase.policy.policyVersion}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-operational-muted">Approvals</dt>
                  <dd className="font-mono">{linkedCase.policy.requiredApprovals}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-operational-muted">Roles</dt>
                  <dd className="text-right font-mono">
                    {linkedCase.policy.requiredRoles.join(', ') || 'None'}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 break-all font-mono text-[10px] text-operational-muted">
                HASH {linkedCase.policy.policyHash}
              </p>
            </section>
          )}
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
