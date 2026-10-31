import Link from 'next/link';

import { CaseControls } from '@/components/console/CaseControls';
import { CaseSnapshotDownload } from '@/components/console/CaseSnapshotDownload';
import { PageFrame } from '@/components/console/PageFrame';
import { StateBadge } from '@/components/console/StateBadge';
import { pagePrincipalWith } from '@/lib/auth/page-principal';
import { getCase } from '@/lib/gate/queries';
import { ROLE_PERMISSIONS } from '@/lib/rbac';
import { buildDecisionSnapshot } from '@/lib/ui/build-decision-snapshot';

export async function CaseWorkspace({
  caseRef,
  recovery = false,
}: {
  readonly caseRef: string;
  readonly recovery?: boolean;
}) {
  const actor = await pagePrincipalWith('case:read');
  const detail = await getCase(caseRef);
  const row = detail.case;
  const can = (
    permission:
      'case:investigate' | 'case:approve' | 'case:approve_high' | 'case:execute' | 'case:verify',
  ) => actor.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
  const latestVerification = detail.verifications[0];
  const latestExecution = detail.execution[0];
  const snapshot = buildDecisionSnapshot(detail, new Date());
  return (
    <PageFrame
      eyebrow={`${recovery ? 'RECOVERY' : 'INVESTIGATION'} / ${row.ref}`}
      title={row.title}
      description={detail.event.summary}
      actions={
        <div className="flex items-center gap-3">
          <StateBadge value={row.status} />
          <Link
            href={recovery ? '/app/recoveries' : '/app/investigations'}
            className="text-sm text-operational-muted hover:text-foreground"
          >
            ← Back to queue
          </Link>
        </div>
      }
    >
      {detail.degradationLevel !== 'L0_NORMAL' && (
        <div
          role="alert"
          className="mb-6 border border-operational-warning bg-operational-warning/10 p-4 text-sm text-operational-warning"
        >
          Degradation level: {detail.degradationLevel}. Server controls whether an action is
          permitted.
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[200px_minmax(0,1fr)] 2xl:grid-cols-[200px_minmax(0,1fr)_320px]">
        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
          <div className="border border-border bg-card p-5">
            <p data-instrument className="text-xs text-operational-muted">
              CASE SPINE
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="text-operational-muted">Severity</dt>
                <dd className="mt-1 font-mono">{row.severity}</dd>
              </div>
              <div>
                <dt className="text-operational-muted">Risk score</dt>
                <dd className="mt-1 font-mono text-xl">{row.riskScore}</dd>
              </div>
              <div>
                <dt className="text-operational-muted">Exposed accounts</dt>
                <dd className="mt-1 font-mono text-xl">{row.exposureCount}</dd>
              </div>
              <div>
                <dt className="text-operational-muted">Opened</dt>
                <dd className="mt-1 font-mono text-xs">
                  <time dateTime={row.openedAt.toISOString()}>{row.openedAt.toLocaleString()}</time>
                </dd>
              </div>
              {row.slaDueAt && (
                <div>
                  <dt className="text-operational-muted">SLA deadline</dt>
                  <dd className="mt-1 font-mono text-xs">
                    <time dateTime={row.slaDueAt.toISOString()}>
                      {row.slaDueAt.toLocaleString()}
                    </time>
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <nav aria-label="Case sections" className="border border-border bg-card p-3 text-sm">
            <a className="block p-2 hover:text-primary" href="#summary">
              Summary
            </a>
            <a className="block p-2 hover:text-primary" href="#evidence">
              Evidence
            </a>
            <a className="block p-2 hover:text-primary" href="#recommendation">
              Recommendation
            </a>
            <a className="block p-2 hover:text-primary" href="#decision">
              Decision record
            </a>
            <a className="block p-2 hover:text-primary" href="#verification">
              Verification
            </a>
            <a className="block p-2 hover:text-primary" href="#timeline">
              Timeline
            </a>
          </nav>
        </aside>
        <div className="space-y-6">
          <section id="summary" className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-primary">
              01 / WHAT HAPPENED
            </p>
            <h2 className="mt-2 text-xl font-medium">Case summary</h2>
            <p className="mt-4 text-sm leading-6 text-operational-muted">{detail.event.summary}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="border border-border p-4">
                <p className="text-xs text-operational-muted">Integrity signal</p>
                <p className="mt-1 font-mono text-xs">{detail.event.type}</p>
              </div>
              <div className="border border-border p-4">
                <p className="text-xs text-operational-muted">Action state</p>
                <p className="mt-1 font-mono text-xs">
                  {detail.actions.map((action) => action.status).join(', ') || 'None'}
                </p>
              </div>
            </div>
            {detail.actions.map((action) => (
              <Link
                key={action.id}
                href={`/app/actions/${action.id}`}
                className="mt-4 block border-l-2 border-primary pl-4 text-sm hover:underline"
              >
                Inspect action {action.ref} →
              </Link>
            ))}
          </section>
          <section id="evidence" className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-primary">
              02 / SOURCES
            </p>
            <h2 className="mt-2 text-xl font-medium">Evidence workbench</h2>
            {detail.evidence.length === 0 ? (
              <p className="mt-4 text-sm text-operational-muted">No evidence collected yet.</p>
            ) : (
              <div className="mt-5 space-y-3">
                {detail.evidence.map((item) => (
                  <article key={item.id} className="border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-mono text-xs text-operational-info">
                        {item.sourceKey} / {item.recordRef}
                      </p>
                      <span className="font-mono text-xs text-operational-muted">
                        {item.stance}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6">{item.excerpt}</p>
                    <p className="mt-3 font-mono text-[11px] text-operational-muted">
                      <time dateTime={item.capturedAt.toISOString()}>
                        {item.capturedAt.toLocaleString()}
                      </time>{' '}
                      · {item.kind}
                    </p>
                  </article>
                ))}
              </div>
            )}
            {detail.evidenceRequests.length > 0 && (
              <div className="mt-6 border-t border-border pt-5">
                <h3 className="font-medium">Requested evidence</h3>
                <ul className="mt-3 space-y-3">
                  {detail.evidenceRequests.map((request) => (
                    <li
                      key={request.id}
                      className="border-l-2 border-operational-warning pl-3 text-sm"
                    >
                      <p>{request.question}</p>
                      <p className="mt-1 font-mono text-xs text-operational-muted">
                        {request.ownerTeam} · {request.status} · due{' '}
                        <time dateTime={request.dueAt.toISOString()}>
                          {request.dueAt.toLocaleString()}
                        </time>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section id="recommendation" className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-operational-info">
              03 / AGENT RECOMMENDATION
            </p>
            <h2 className="mt-2 text-xl font-medium">Investigation report</h2>
            {detail.investigation ? (
              <>
                <p className="mt-4 text-sm leading-6 text-operational-muted">
                  {detail.investigation.reasoning}
                </p>
                <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs">
                  <span className="border border-operational-info px-2 py-1">
                    {detail.investigation.recommendedDisposition}
                  </span>
                  <span className="border border-border px-2 py-1">
                    Confidence {String(detail.investigation.confidence)}
                  </span>
                  {detail.investigation.isFallback && (
                    <span className="border border-operational-warning px-2 py-1">
                      Baseline mode
                    </span>
                  )}
                </div>
                {detail.investigation.missingEvidence.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-medium">Unresolved evidence</h3>
                    <ul className="mt-2 list-inside list-disc text-sm text-operational-warning">
                      {detail.investigation.missingEvidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-5 space-y-3">
                  {detail.investigation.hypotheses.map((item) => (
                    <div key={item.id} className="border border-border p-4">
                      <p className="text-sm">{item.statement}</p>
                      <p className="mt-2 font-mono text-xs text-operational-muted">
                        {item.verdict} · confidence {String(item.confidence)} · supporting{' '}
                        {item.supportingRefs.length} · contradicting {item.contradictingRefs.length}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-operational-muted">
                Investigation has not started. A recommendation is never a policy decision.
              </p>
            )}
          </section>
          <section id="decision" className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-primary">
              04 / DETERMINISTIC POLICY
            </p>
            <h2 className="mt-2 text-xl font-medium">Decision packet</h2>
            {detail.policy ? (
              <>
                <p className="mt-4 font-mono text-sm">{detail.policy.disposition}</p>
                <p className="mt-2 text-sm text-operational-muted">
                  Policy {detail.policy.policyVersion} · risk {detail.policy.riskScore} ·{' '}
                  {detail.policy.requiredApprovals} required approval(s)
                </p>
                <dl className="mt-5 space-y-3 break-all font-mono text-[11px] text-operational-muted">
                  <div>
                    <dt>Policy hash</dt>
                    <dd>{detail.policy.policyHash}</dd>
                  </div>
                  <div>
                    <dt>Evidence hash</dt>
                    <dd>{detail.policy.evidenceHash}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-4 text-sm text-operational-muted">
                No policy decision has been recorded.
              </p>
            )}
            <CaseSnapshotDownload snapshot={snapshot} />
          </section>
          <section id="verification" className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-primary">
              05 / OBSERVED OUTCOME
            </p>
            <h2 className="mt-2 text-xl font-medium">Verification</h2>
            {latestExecution && (
              <div className="mt-4 flex items-center gap-3 text-sm">
                <span>Execution</span>
                <StateBadge value={latestExecution.status} />
              </div>
            )}
            {latestVerification ? (
              <>
                <p
                  className={`mt-4 text-sm ${latestVerification.passed ? 'text-operational-success' : 'text-primary'}`}
                >
                  {latestVerification.passed
                    ? 'Business state verified.'
                    : 'API reported success; business state was not restored.'}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm">Expected</h3>
                    <pre className="overflow-auto border border-border bg-background p-3 text-xs">
                      {JSON.stringify(latestVerification.expectedState, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm">Observed</h3>
                    <pre className="overflow-auto border border-border bg-background p-3 text-xs">
                      {JSON.stringify(latestVerification.observedState, null, 2)}
                    </pre>
                  </div>
                </div>
                {!latestVerification.passed && (
                  <pre className="mt-4 overflow-auto border border-primary/50 p-3 text-xs text-primary">
                    {JSON.stringify(latestVerification.mismatches, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-operational-muted">
                Not verified yet. A target response does not close this case.
              </p>
            )}
          </section>
          <section id="timeline" className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-primary">
              06 / RECORD
            </p>
            <h2 className="mt-2 text-xl font-medium">Timeline</h2>
            <ol className="mt-5 space-y-4 border-l border-border pl-4">
              {detail.timeline.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="font-mono text-xs text-operational-muted">
                    #{event.seq} ·{' '}
                    <time dateTime={event.createdAt.toISOString()}>
                      {event.createdAt.toLocaleString()}
                    </time>
                  </span>
                  <p className="mt-1">{event.eventType}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="xl:col-start-2 2xl:col-auto 2xl:sticky 2xl:top-24 2xl:self-start">
          <CaseControls
            caseRef={row.ref}
            status={row.status}
            riskScore={row.riskScore}
            actorId={actor.id}
            canInvestigate={can('case:investigate')}
            canApprove={can('case:approve')}
            canExecute={can('case:execute')}
            canVerify={can('case:verify')}
            disposition={detail.policy?.disposition ?? null}
            hasUnknownExecution={detail.execution.some(
              (execution) => execution.status === 'UNKNOWN',
            )}
          />
        </aside>
      </div>
    </PageFrame>
  );
}
