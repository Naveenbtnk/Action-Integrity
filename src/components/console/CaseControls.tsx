'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError, apiFetch, nextActionForError } from '@/lib/api/client';

interface QuorumView {
  approvals: Array<{
    reviewerId: string;
    status: string;
    reviewer: { name: string; roles: string[] };
    expiresAt: string;
  }>;
  quorum: null | {
    met: boolean;
    current: number;
    required: number;
    missingRoles: string[];
    disposition: string;
    expiresAt: string | null;
    invalidReason?: string;
  };
}

interface Props {
  readonly caseRef: string;
  readonly status: string;
  readonly riskScore: number;
  readonly actorId: string;
  readonly canInvestigate: boolean;
  readonly canApprove: boolean;
  readonly canExecute: boolean;
  readonly canVerify: boolean;
  readonly disposition: string | null;
  readonly hasUnknownExecution: boolean;
}

function DecisionControls(props: Props) {
  const router = useRouter();
  const executionKey = useRef<string | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [executionUnconfirmed, setExecutionUnconfirmed] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    const key = `aic-draft:${props.caseRef}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      sessionStorage.removeItem(key);
      queueMicrotask(() => setNote(saved));
    }
  }, [props.caseRef]);
  useEffect(() => {
    if (props.status === 'REOPENED') executionKey.current = null;
  }, [props.status]);
  const [confirmation, setConfirmation] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [recordRef, setRecordRef] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [stance, setStance] = useState('CONTRADICTS');
  const [ownerTeam, setOwnerTeam] = useState('');
  const [question, setQuestion] = useState('');
  const [replayed, setReplayed] = useState(false);
  const approvals = useQuery({
    queryKey: ['approvals', props.caseRef],
    queryFn: () => apiFetch<QuorumView>(`/cases/${encodeURIComponent(props.caseRef)}/approvals`),
  });
  const quorum = approvals.data?.data.quorum;
  const isApprover =
    approvals.data?.data.approvals.some(
      (item) => item.reviewerId === props.actorId && item.status === 'VALID',
    ) ?? false;
  const safeRefusal = props.status === 'SAFE_REFUSAL' || props.disposition === 'SAFE_REFUSAL';

  async function mutate(path: string, body: object, id?: string) {
    const signature = `${path}:${JSON.stringify(body)}`;
    let requestKey = id ?? requestKeys.current.get(signature);
    if (!requestKey) {
      requestKey = crypto.randomUUID();
      requestKeys.current.set(signature, requestKey);
    }
    setBusy(true);
    setError(null);
    setReplayed(false);
    try {
      const response = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': requestKey },
      });
      requestKeys.current.delete(signature);
      setReplayed(response.replayed);
      await approvals.refetch();
      router.refresh();
      setNote('');
      setExcerpt('');
      setQuestion('');
    } catch (cause) {
      const failure =
        cause instanceof ApiError
          ? cause
          : new ApiError('REQUEST_FAILED', 'The request could not be completed.');
      setError(failure);
      if (
        path.endsWith('/execute') &&
        (failure.status === undefined ||
          failure.status >= 500 ||
          failure.code === 'ALREADY_EXECUTING')
      ) {
        setExecutionUnconfirmed(true);
        router.refresh();
      }
      if (failure.status === 401) {
        if (note) sessionStorage.setItem(`aic-draft:${props.caseRef}`, note);
        router.push(
          `/login?next=${encodeURIComponent(window.location.pathname)}&reason=session_stale`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const path = `/cases/${encodeURIComponent(props.caseRef)}`;
  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" tabIndex={-1} className="border border-primary bg-primary/10 p-4 text-sm">
          <strong className="font-mono">{error.code}</strong>
          <p className="mt-1">{error.message}</p>
          <p className="mt-2 text-operational-muted">Next: {nextActionForError(error.code)}</p>
          {error.requestId && (
            <p className="mt-2 font-mono text-xs text-operational-muted">
              Support reference: {error.requestId}
            </p>
          )}
        </div>
      )}
      {replayed && (
        <p role="status" className="text-sm text-operational-muted">
          The original request was replayed; no new action was submitted.
        </p>
      )}
      {(props.hasUnknownExecution || executionUnconfirmed) && (
        <div
          role="alert"
          className="border border-operational-warning bg-operational-warning/10 p-4 text-operational-warning"
        >
          <strong>Outcome unconfirmed — do not re-run.</strong>
          <p className="mt-1 text-sm">
            Verify the observed target state before any further decision.
          </p>
        </div>
      )}
      <section className="border border-border bg-card p-6" aria-labelledby="approval-heading">
        <p data-instrument className="text-xs text-operational-muted">
          01 / HUMAN DECISION
        </p>
        <h2 id="approval-heading" className="mt-2 text-xl font-medium">
          Approval
        </h2>
        {approvals.isPending ? (
          <p className="mt-4 text-sm text-operational-muted">Loading quorum…</p>
        ) : approvals.isError ? (
          <p role="alert" className="mt-4 text-sm text-primary">
            Could not load quorum. Approval is unavailable.
          </p>
        ) : quorum ? (
          <div aria-live="polite" className="mt-4 border-l-2 border-operational-info pl-4 text-sm">
            <p className="font-mono">
              {quorum.current} of {quorum.required} approvals
            </p>
            {quorum.missingRoles.length > 0 && (
              <p className="mt-1 text-operational-warning">
                Missing {quorum.missingRoles.join(', ')}
              </p>
            )}
            {quorum.expiresAt && (
              <p className="mt-1 text-operational-muted">
                Expires{' '}
                <time dateTime={quorum.expiresAt}>
                  {new Date(quorum.expiresAt).toLocaleString()}
                </time>
              </p>
            )}
            {quorum.invalidReason && <p className="mt-1 text-primary">{quorum.invalidReason}</p>}
          </div>
        ) : (
          <p className="mt-4 text-sm text-operational-muted">
            Compute a policy decision before approval.
          </p>
        )}
        {safeRefusal ? (
          <p className="mt-5 border border-operational-warning p-3 text-sm text-operational-warning">
            Safe refusal requires human handling. Approval and execution are unavailable.
          </p>
        ) : props.canApprove &&
          props.status === 'AWAITING_APPROVAL' &&
          props.disposition &&
          quorum ? (
          <form
            className="mt-5 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(`${path}/approve`, {
                decision: 'APPROVE',
                disposition: props.disposition,
                rationale: note,
              });
            }}
          >
            <label htmlFor="approval-rationale" className="block text-sm">
              Rationale for {props.disposition}
            </label>
            <textarea
              id="approval-rationale"
              required
              minLength={20}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-24 w-full border border-input bg-background p-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              disabled={busy || note.trim().length < 20}
              className="rounded-[4px]"
            >
              Record approval
            </Button>
          </form>
        ) : (
          <p className="mt-5 text-sm text-operational-muted">
            {props.status === 'APPROVED'
              ? 'Approval is complete. A different reviewer may take the next step.'
              : 'No approval action is available in this state or for your permissions.'}
          </p>
        )}
        {approvals.data?.data.approvals.length ? (
          <ul className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
            {approvals.data.data.approvals.map((item, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>
                  {item.reviewer.name} · {item.reviewer.roles.join(', ')}
                </span>
                <span className="font-mono text-xs text-operational-muted">{item.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="border border-border bg-card p-6" aria-labelledby="execution-heading">
        <p data-instrument className="text-xs text-operational-muted">
          02 / SEPARATE OPERATOR
        </p>
        <h2 id="execution-heading" className="mt-2 text-xl font-medium">
          {props.disposition === 'BLOCK' ? 'Complete block' : 'Execute approved action'}
        </h2>
        <p className="mt-3 text-sm text-operational-muted">
          This step records the exact effect and then requires a verification read. A target write
          is never retried automatically.
        </p>
        {isApprover ? (
          <p className="mt-4 border border-operational-warning p-3 text-sm text-operational-warning">
            You approved this case. Another reviewer must complete this step.
          </p>
        ) : !props.canExecute ? (
          <p className="mt-4 text-sm text-operational-muted">
            Your role cannot execute a business action.
          </p>
        ) : props.status !== 'APPROVED' ? (
          <p className="mt-4 text-sm text-operational-muted">
            Execution requires APPROVED state and a valid quorum.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {props.riskScore >= 70 && (
              <>
                <label htmlFor="execute-confirmation" className="block text-sm">
                  Type {props.caseRef} to confirm this high-risk action
                </label>
                <input
                  id="execute-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="h-10 w-full border border-input bg-background px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
                />
              </>
            )}
            <Button
              disabled={
                busy ||
                executionUnconfirmed ||
                !quorum?.met ||
                (props.riskScore >= 70 && confirmation !== props.caseRef)
              }
              onClick={() => {
                executionKey.current ??= crypto.randomUUID();
                void mutate(`${path}/execute`, {}, executionKey.current);
              }}
              className="rounded-[4px]"
            >
              {props.disposition === 'BLOCK' ? 'Complete block' : 'Execute once'}
            </Button>
            {!quorum?.met && (
              <p className="text-xs text-operational-warning">
                Quorum not met. Server will refuse execution.
              </p>
            )}
          </div>
        )}
      </section>
      {(props.status === 'VERIFYING' || props.hasUnknownExecution) && (
        <section className="border border-border bg-card p-6" aria-labelledby="verify-heading">
          <p data-instrument className="text-xs text-operational-muted">
            03 / TARGET OBSERVATION
          </p>
          <h2 id="verify-heading" className="mt-2 text-xl font-medium">
            Verify business state
          </h2>
          <p className="mt-3 text-sm text-operational-muted">
            Closure requires a passing comparison of expected and observed state.
          </p>
          {props.canVerify && (
            <Button
              className="mt-5 rounded-[4px]"
              disabled={busy}
              onClick={() => void mutate(`${path}/verify`, {})}
            >
              Run verification
            </Button>
          )}
        </section>
      )}
      {props.canInvestigate &&
        ['HOLDING', 'AWAITING_EVIDENCE', 'INVESTIGATING'].includes(props.status) && (
          <section className="border border-border bg-card p-6">
            <h2 className="text-xl font-medium">Investigate</h2>
            <p className="mt-3 text-sm text-operational-muted">
              Generate a cited recommendation from the current evidence.
            </p>
            <Button
              className="mt-4 rounded-[4px]"
              disabled={busy}
              onClick={() => void mutate(`${path}/investigate`, {})}
            >
              Run investigation
            </Button>
          </section>
        )}
      {props.canInvestigate &&
        ['HOLDING', 'AWAITING_EVIDENCE', 'INVESTIGATING', 'AWAITING_APPROVAL'].includes(
          props.status,
        ) && (
          <section className="border border-border bg-card p-6">
            <p data-instrument className="text-xs text-operational-muted">
              EVIDENCE INPUT
            </p>
            <h2 className="mt-2 text-xl font-medium">Add evidence</h2>
            <p className="mt-3 text-sm text-operational-muted">
              Append a sourced record. New evidence invalidates prior approvals.
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(`${path}/evidence`, {
                  kind: 'OWNER_CONFIRMATION',
                  sourceKey,
                  recordRef,
                  excerpt,
                  stance,
                });
              }}
            >
              <label htmlFor="evidence-source" className="block text-sm">
                Source key
              </label>
              <input
                id="evidence-source"
                required
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              />
              <label htmlFor="evidence-record" className="block text-sm">
                Record reference
              </label>
              <input
                id="evidence-record"
                required
                value={recordRef}
                onChange={(event) => setRecordRef(event.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              />
              <label htmlFor="evidence-excerpt" className="block text-sm">
                Excerpt
              </label>
              <textarea
                id="evidence-excerpt"
                required
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
                className="min-h-20 w-full border border-input bg-background p-3 text-sm"
              />
              <label htmlFor="evidence-stance" className="block text-sm">
                Stance
              </label>
              <select
                id="evidence-stance"
                value={stance}
                onChange={(event) => setStance(event.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="SUPPORTS">Supports</option>
                <option value="CONTRADICTS">Contradicts</option>
                <option value="NEUTRAL">Neutral</option>
              </select>
              <Button type="submit" variant="outline" disabled={busy} className="rounded-[4px]">
                Append evidence
              </Button>
            </form>
            <form
              className="mt-6 space-y-3 border-t border-border pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(`${path}/evidence-requests`, { ownerTeam, question, dueInHours: 24 });
              }}
            >
              <h3 className="font-medium">Request missing evidence</h3>
              <label htmlFor="evidence-owner" className="block text-sm">
                Owner team
              </label>
              <input
                id="evidence-owner"
                required
                value={ownerTeam}
                onChange={(event) => setOwnerTeam(event.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              />
              <label htmlFor="evidence-question" className="block text-sm">
                Question
              </label>
              <textarea
                id="evidence-question"
                required
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="min-h-20 w-full border border-input bg-background p-3 text-sm"
              />
              <Button type="submit" variant="outline" disabled={busy} className="rounded-[4px]">
                Request evidence · due in 24 hours
              </Button>
            </form>
          </section>
        )}
      {props.canInvestigate && props.status === 'AWAITING_APPROVAL' && (
        <Button variant="outline" disabled={busy} onClick={() => void mutate(`${path}/policy`, {})}>
          Compute or refresh policy decision
        </Button>
      )}
    </div>
  );
}

export function CaseControls(props: Props) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <DecisionControls {...props} />
    </QueryClientProvider>
  );
}
