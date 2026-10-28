# ARCHITECTURE

**Read this before any implementation work.** It defines where each responsibility lives and what
must never move. Module paths here are normative; `TRD.md` holds stack choices.

---

## 1. The one-sentence architecture

A deterministic control plane owns every decision that can write; an LLM investigator produces
cited recommendations that the control plane may accept, constrain or reject; every side effect is
gated by quorum, written once, verified by reading business state, and recorded in an append-only,
externally anchored audit chain.

## 2. Component map

```
                    ┌──────────────────────────────────────────────┐
  Synthetic sources │  contract-feed  billing  usage  support  acct│  (read-only adapters)
                    └───────────────┬──────────────────────────────┘
                                    │ snapshots + records
                    ┌───────────────▼──────────────┐
                    │  IntegrityEngine (det.)      │  contract eval → IntegrityEvent
                    └───────────────┬──────────────┘
                                    │
  Automation ──POST /actions/ingest─▶ ExposureAnalyzer (det.) ──▶ Case (state machine)
                                    │
                    ┌───────────────▼──────────────┐
                    │  ActionGate (det.)           │  ALLOW | HOLD | BLOCK → ActionHold
                    └───────────────┬──────────────┘
                                    │ held
                    ┌───────────────▼──────────────┐
                    │  Investigator (LLM, read-only)│ → InvestigationReport (cited)
                    └───────────────┬──────────────┘
                                    │ recommendation
                    ┌───────────────▼──────────────┐
                    │  PolicyEngine (det.)         │ risk band + required approvals
                    │  + PolicyVersion hash pinning│
                    └───────────────┬──────────────┘
                                    │ approvals (quorum + SoD + binding)
                    ┌───────────────▼──────────────┐
                    │  ApprovalQuorum (det.)       │ distinct humans, roles, expiry
                    └───────────────┬──────────────┘
                                    │ quorum met
                    ┌───────────────▼──────────────┐
                    │  Executor (det.)             │ RELEASE | RESTORE_LAST_KNOWN_GOOD
                    │  intent tx → target → result │
                    └───────────────┬──────────────┘
                                    │ executed / UNKNOWN
                    ┌───────────────▼──────────────┐
                    │  Verifier (det.)             │ observed target state == expected?
                    └───────────────┬──────────────┘
                                    │
                            CLOSED_RESOLVED | REOPENED | ESCALATED
                                    │
        ┌───────────────────────────┼───────────────────────────────┐
        │                           │                               │
  AuditLedger              Outbox → consumers                OTel traces/metrics/logs
  (append-only,            (anchor, KPI, notices)            (correlated by requestId,
   hash-chained,                                              traceId, caseRef)
   hourly anchored)
```

Cross-cutting: `lib/rbac.ts` (every route), `lib/idempotency` (every mutation), `lib/degradation`
(write admission), `lib/observability` (every path). These are not optional layers; a path that skips
one is incomplete.

## 3. Module contracts

### `lib/integrity/`
- `evaluateChecks(input) → CheckResult[]` is pure; `lib/integrity-runner/evaluate.ts` owns
  adapter reads and per-contract snapshot/event transactions.
- Checks: `schema-check` (contract schema hash + required fields), `enum-check` (declared value set
  vs observed distinct values, for contracts without a `semanticDefinition`), `semantic-check`
  (observed values vs `expectedValues` ∪ equivalent aliases, for contracts with a
  `semanticDefinition` — at most one value-check event per contract), `freshness-check` (age vs
  `freshnessSlaSeconds`), `cross-source-check` (declared invariant between two sources, e.g. billing
  status ⟺ entitlement status).
- Output is one event per violated check type and contract with `evidenceSnapshotIds[]` and a machine-readable
  `scopeSelector` (JSON) used by the ExposureAnalyzer.
- Pure functions over snapshots. Idempotent per `(contractId, snapshotId, checkType)`.

### `lib/exposure/`
- `computeExposure(event) → { actions: OutboundAction[], accounts: string[] }`
- Rules: field overlap with `scopeSelector`, account overlap, time window
  (`event.detectedAt ± config.exposureWindowHours`), and action state (`PENDING` always,
  `EXECUTED` when `restorePoint` exists).
- Never mutates actions; returns a projection.

### `lib/gate/`
- `decide(action, context) → { decision: ALLOW|HOLD|BLOCK, reasons[], caseId? }`
- Invariants: no decision ⇒ no execution. `HOLD` requires an open case. `BLOCK` is terminal for
  the submitted payload and requires a new submission with a new idempotency key. The decision is
  persisted once on `OutboundAction.gateDecision` and never recomputed for that action.
- Creates the `ActionHold` row inside the same transaction as the gate decision.
- Deterministic only: no LLM, no threshold from the report, no network call except source reads.
- The `ALLOW` path calls the executor **after** commit, like every other write.

### `lib/agent/`
- `investigate(caseId) → InvestigationReport`
- Tools (all read-only, allowlisted in `tools.ts`): `get_contract`, `get_source_records`,
  `get_account_history`, `get_target_state`, `search_related_cases`, `find_owner`,
  `request_evidence` (writes an `EvidenceRequest` row only — never target state).
- Must return ≥2 hypotheses when evidence conflicts, and every claim must carry a citation of the
  form `{kind, ref, excerpt}`. Citation validator rejects unknown refs.
- Caching: `(caseId, evidenceHash, promptVersion, mode)`. Deterministic fallback in
  `lib/agent/fallback.ts` satisfies the same return type.
- The provider client has a retry budget of one; the fallback is deterministic and may not produce a
  disposition that permits a write (`ALLOW`, `RELEASE_AFTER_CORRECTION`, `COMPENSATE`) without human
  approval. `isFallback=true` is persisted and shown.
- No tool may write to `tgt_*`, change policy, or read a secret. The tool list is snapshotted by test.

### `lib/policy/`
- `evaluate(caseRow, report) → PolicyDecision`
- Reads the **active** `PolicyVersion` from the database, verifies its hash against
  `config/policy/<version>.json`, and pins `policyHash`, `evidenceHash`, `inputsHash`,
  `requiredApprovals` and `requiredRoles` on the decision.
- Returns `allowedDispositions[]`, `approvalRequired`, `riskScore`, `riskBand`, `reasons[]`.
- Never invents a disposition outside the enum. Unknown case type ⇒ `ESCALATE`.
- Quorum computation (`RBAC.md` §5): writes at risk `< 70` and exposure `< 250` ⇒ 1 approval; writes
  at `risk ≥ 70` or `exposure ≥ 250` ⇒ 2 approvals, one from `SENIOR_REVIEWER`. `BLOCK`,
  `SAFE_REFUSAL`, `ESCALATE` ⇒ 1 approval, no executor.
- No active policy version ⇒ `POLICY_UNAVAILABLE`; never fall back to a default.

Disposition semantics (normative — this is the meaning every module and screen uses):

| Disposition | Meaning | Target write | Ends in |
|---|---|---|---|
| `ALLOW` | gate-level only: the action is trustworthy and proceeds | the action's own write, via executor | no case |
| `HOLD_FOR_EVIDENCE` | keep the hold; the case is not decision-ready | none | not terminal |
| `BLOCK` | the submitted action is unsupported or harmful; reject permanently | none; target must be unchanged | `CLOSED_RESOLVED` after verification |
| `RELEASE_AFTER_CORRECTION` | the held action is valid and may proceed as submitted | exactly the held payload | `CLOSED_RESOLVED` after verification |
| `COMPENSATE` | the action already executed and was wrong | one `RESTORE_LAST_KNOWN_GOOD` | `CLOSED_RESOLVED` after verification |
| `ESCALATE` | a human owner must decide | none | `ESCALATED` |
| `SAFE_REFUSAL` | no bounded, reversible remedy exists | none | `CLOSED_ESCALATED` |

A disposition describes what happens to the *action*, not what happens to the business record — see
ADR-015. `BLOCK` is therefore a resolved, verified outcome, not a silent success.

Derivation, applied in order:

1. `evidenceCompleteness < 0.8` ⇒ `HOLD_FOR_EVIDENCE`, and remove write-permitting dispositions.
2. `confidence < 0.7` ⇒ `ESCALATE`.
3. Normalize the recommendation to the action's state: `BLOCK` on an `EXECUTED` action becomes
   `COMPENSATE` (or `SAFE_REFUSAL` without a restore point); `COMPENSATE` on a `HELD` action becomes
   `BLOCK`.
4. `COMPENSATE` without a restore point ⇒ `SAFE_REFUSAL`.
5. `isFallback` ⇒ remove write-permitting dispositions; the case still needs a human.
6. A recommendation outside `allowedDispositions` is replaced by the safest allowed one and
   `RECOMMENDATION_CONSTRAINED` is recorded.

### `lib/approval/`
- `record({ caseId, reviewer, decision, disposition, rationale }) → { approval, quorum }`
- `quorum(caseId) → { current, required, requiredRoles, satisfiedRoles, missingRoles, expiresAt,
  disposition, evidenceHash, policyHash, met }` — counts only `VALID`, distinct reviewers.
- `supersedeAll(tx, caseId, reason)` — called in the same transaction as new evidence, a new report, or
  a policy activation. Sets `status = SUPERSEDED`, writes `APPROVAL_SUPERSEDED`, and moves
  `APPROVED → AWAITING_APPROVAL`.
- `assertSeparationOfDuties(caseId, actorId)` — the actor taking the post-approval step is not an
  approver; override author cannot approve or act; break-glass must be co-signed.
- `expire(caseId)` — used by reconciliation; marks `EXPIRED` and returns the case to
  `AWAITING_APPROVAL`.
- A `REJECT` revokes other valid approvals and ends the lifecycle.
- This module never executes and never writes to the target.

### `lib/executor/`
- `execute({ caseId, kind: 'RELEASE' | 'RESTORE_LAST_KNOWN_GOOD', actor }) → ActionExecution`
- Only module permitted to call the target adapter's write method — including the write for an
  `ALLOW` gate decision. Callers never write to the target system themselves.
- Preconditions, checked in one transaction under a row lock before any network call:
  case `APPROVED`; quorum met; required roles present; every counted approval `VALID` and unexpired;
  `boundEvidenceHash` / `boundPolicyHash` / `boundDisposition` match the current values; executor is
  not an approver; break-glass elevation complete when used; degradation level permits writes.
  Any failure aborts with no write.
- Idempotency keys: `release:<outboundActionId>`, `comp:<caseId>:<targetObjectRef>`.
- Transaction shape: commit intent (`ActionExecution = PENDING`, case `EXECUTING`, outbox event) →
  capture restore point → call target exactly once → commit result (`SUCCEEDED`/`FAILED`/`UNKNOWN`,
  case `VERIFYING`, outbox event). No database transaction spans the network call.
- **No automatic retry of a target write.** `UNKNOWN` on timeout, network error or a lost response.
  Reconciliation and a verification read resolve it; the executor never guesses.
- A compensation (`RESTORE_LAST_KNOWN_GOOD`) without a `restorePoint` ⇒ `SAFE_REFUSAL`, no write.
- `BLOCK` ⇒ no write and no `ActionExecution` row; the action is marked `BLOCKED`, the hold is
  released, and the case goes to `VERIFYING` to prove the target was never changed.

### `lib/verifier/`
- `verify(caseId, attempts = 2) → VerificationResult`
- Reads the target system through the adapter, normalizes, deep-compares declared fields only.
- Resolves an `UNKNOWN` execution: observed == expected ⇒ `SUCCEEDED` with
  `resolvedByVerification=true`; otherwise `FAILED`. Execution status is never assumed from a prior
  response.
- `passed=false` ⇒ case `REOPENED`, escalation event, execution not counted as recovered.
- Read failure after all attempts ⇒ no result row, case `ESCALATED`, 502. A missing verification is
  never a pass.

### `lib/state-machine/case.ts`
Single source of truth for transitions. Every transition function writes an `AuditEvent` in the
same transaction and requires an `actor` (`USER`, `AGENT`, `SYSTEM`, `SERVICE`). Illegal transitions
throw `InvalidTransitionError` (mapped to HTTP 409).

### `lib/rbac.ts`
- `requirePermission(principal, permission)` — throws `AppError('FORBIDDEN', 403)`.
- `ROUTE_PERMISSIONS`, `assertRouteCoverage()`; the startup check fails if a route is unlisted.
- `assertQuorum` and `assertSeparationOfDuties` live in `lib/approval` and are called by the handler,
  not hidden inside the state machine.

### `lib/idempotency/`
- `withIdempotency({ scope, key, requestHash }, fn)` — inserts `IN_PROGRESS` with a unique
  `(scope, key)`, runs `fn` once, stores status and body, replays on duplicate.
- Same key + different hash ⇒ `IDEMPOTENCY_CONFLICT`, no work.
- Concurrent duplicate ⇒ bounded wait, then `IDEMPOTENCY_IN_PROGRESS`.
- Applied at the route boundary for every mutation.

### `lib/outbox/`
- `enqueue(tx, { eventType, aggregateType, aggregateId, payload, dedupeKey })` — same transaction as
  the business change.
- `drain(limit)` — claims with `FOR UPDATE SKIP LOCKED`, exponential backoff with jitter, maximum 8
  attempts, then `DLQ` plus an alert.
- Delivery is at-least-once; consumers must be idempotent. Replay of a DLQ event is an explicit
  audited operation.
- Consumers in v1: notification/console notice, audit anchor trigger, KPI snapshot trigger. No
  external webhook.

### `lib/audit/`
- `append(tx, { eventType, actor, caseId, payload, requestId, traceId })` — reads the previous hash
  under a lock, computes `hash = sha256(prevHash | seq | canonical(eventType, actorType, actorId,
  caseId, payload, createdAt))`, inserts. The same transaction as the state change.
- `verifyRange(fromSeq, toSeq)` — recomputes the chain and reports the first break.
- `anchor()` — Merkle root over the range, upload to the external store, insert `AuditAnchor`.
- `assertChainHealthy()` — used by write admission (`L4` freeze).
- The canonical JSON serializer is fixed: sorted keys, no whitespace, UTC ISO timestamps with
  milliseconds. Changing it is a breaking change and requires a new anchor algorithm version.

### `lib/observability/`
- `logger`, `tracer`, `meter`, `withSpan`, `recordInvariant`.
- Every route, executor call, LLM call, outbox publish and anchor writes the spans and metrics named
  in `OBSERVABILITY.md`. No domain module constructs a logger directly.
- Telemetry export failures are logged and swallowed; they never block a decision.

### `lib/degradation/`
- `current() → DegradationLevel` from live probes.
- `assertWritesAllowed(operation)` — throws `DEGRADATION_BLOCKED` (503) when the level forbids it.
- `force(level, actor, reason)` — only more restrictive than computed; audited.
- Probe results feed `aic_dependency_up` and `/health`.

### `lib/reconcile/`
- Resolves `PENDING → UNKNOWN` after `EXECUTION_TIMEOUT_MS`, expired approvals, expired evidence
  requests, stale holds, orphan outbox rows and overdue anchors. Advisory-locked and idempotent.
  Behaviour in `FAILURE_MODES.md` §5.

### `lib/eval/`, `lib/kpi/`, `lib/target/`, `lib/adapters/`
Unchanged responsibilities: fixture runner, KPI computation, synthetic target service, HTTP clients.
Production edition adds `kind` to runs, the adversarial fixture suite, drill artifacts, and
`policyHash`/`commitSha` on every run.

## 4. Case state machine

`lib/state-machine/case.ts` owns every transition. The table below is normative — no other module
may set `Case.status`.

| From | Allowed to | Trigger |
|---|---|---|
| `NEW` | `TRIAGED`, `CLOSED_NO_ACTION` | exposure links the action / no exposure |
| `TRIAGED` | `HOLDING`, `CLOSED_NO_ACTION` | hold placed inside the ingest transaction / link withdrawn |
| `HOLDING` | `INVESTIGATING`, `AWAITING_APPROVAL`, `ESCALATED` | `POST /investigate` / deterministic report only / `POST /escalate` |
| `INVESTIGATING` | `AWAITING_EVIDENCE`, `AWAITING_APPROVAL`, `ESCALATED` | report has missing evidence / report is decision-ready / escalate |
| `AWAITING_EVIDENCE` | `INVESTIGATING`, `AWAITING_APPROVAL`, `ESCALATED` | new evidence / completeness met / SLA deadline |
| `AWAITING_APPROVAL` | `APPROVED`, `REJECTED`, `SAFE_REFUSAL`, `ESCALATED` | quorum met / reject / policy allows no action / escalate |
| `APPROVED` | `EXECUTING`, `VERIFYING`, `AWAITING_APPROVAL`, `SAFE_REFUSAL`, `ESCALATED` | execute write / execute `BLOCK` / approvals invalidated by evidence or policy / `NO_RESTORE_POINT` or missing precondition / escalate |
| `EXECUTING` | `VERIFYING`, `SAFE_REFUSAL` | execution recorded (incl. `UNKNOWN`) / precondition failed mid-flight |
| `VERIFYING` | `CLOSED_RESOLVED`, `REOPENED`, `ESCALATED` | verification passed / passed=false / inconclusive after retry |
| `REJECTED` | `CLOSED_NO_ACTION`, `ESCALATED` | close / owner action required |
| `SAFE_REFUSAL` | `CLOSED_ESCALATED` | refusal acknowledged |
| `ESCALATED` | `INVESTIGATING`, `AWAITING_APPROVAL`, `CLOSED_ESCALATED` | owner returns evidence / owner resolves / owner closes |
| `REOPENED` | `INVESTIGATING`, `AWAITING_APPROVAL`, `ESCALATED` | new evidence / re-decide with existing evidence / escalate |
| `CLOSED_RESOLVED` | `REOPENED` | `POST /reopen` |
| `CLOSED_NO_ACTION` | — | terminal |
| `CLOSED_ESCALATED` | — | terminal |

Rules:

- Terminal states accept no transition except `CLOSED_RESOLVED → REOPENED`.
- `SAFE_REFUSAL` is reachable only from `AWAITING_APPROVAL`, `APPROVED` or `EXECUTING`.
- `AWAITING_APPROVAL → APPROVED` requires quorum **and** role coverage from `PolicyDecision`, not a
  single approval row.
- `APPROVED → AWAITING_APPROVAL` happens when evidence is added, a new report is produced, the active
  policy changes, or an approval expires. The transition and `APPROVAL_SUPERSEDED`/`APPROVAL_EXPIRED`
  events are one transaction.
- `BLOCK` never produces an `ActionExecution`; `VERIFYING` in that path compares the target against
  `payload.from`.
- Every accepted transition updates `status` and `lastTransitionAt` and appends exactly one
  `AuditEvent` (`CASE_TRANSITION`) in the same transaction.
- Every rejected transition throws `INVALID_TRANSITION` (409) and writes nothing.
- `AWAITING_EVIDENCE` carries `slaDueAt`; the reconciliation job escalates on expiry, it does not
  silently close.

## 5. Sequence: Scenario A (prevention)

1. `POST /api/v1/integrity/evaluate` → semantic-check fails for `billing.plan_status`
   (declared `{ACTIVE, SUSPENDED}`, observed `CURRENT`) → `IntegrityEvent` (SEMANTIC, HIGH).
2. Automation calls `POST /api/v1/actions/ingest` with a revoke payload, a new `Idempotency-Key` and
   `x-agent-key`.
3. `ExposureAnalyzer` links event ↔ action → creates case, state `TRIAGED → HOLDING`.
4. `ActionGate` returns `HOLD`; `ActionHold` persisted in the same transaction as the case and audit
   events. Response includes `caseRef`; the outbox holds the notice event.
5. Console surfaces the case. An `ANALYST` clicks **Investigate**.
6. Investigator reads contract, billing records, account history, usage, support; returns 2
   hypotheses (semantic drift vs genuine downgrade), recommendation `HOLD_FOR_EVIDENCE`.
7. `EvidenceRequest` sent to `contract-owner`. The owner confirms the contract is active, which
   contradicts the revoke → case returns to `INVESTIGATING` for a second report recommending `BLOCK`.
8. `PolicyEngine` pins `policyHash`, `evidenceHash` and computes 1 approval. A `REVIEWER` approves
   `BLOCK`; quorum is met; no write is permitted. The approving reviewer is refused the next step
   (`APPROVER_CANNOT_EXECUTE`); a second `REVIEWER` completes the block.
9. `Executor` performs no write: the action is marked `BLOCKED`, the hold is released, and the case
   moves to `VERIFYING`. `Verifier` reads the target and confirms `SSO=ACTIVE` with no
   `ActionExecution` row.
10. `CLOSED_RESOLVED`; outbox emits the KPI-affecting event; audit events are appended, anchored
    within the hour, and the trace shows gate → case → approval → verification with one `traceId`.

## 6. Sequence: Scenario B (compensation, quorum, no blind retry)

1. A revoked entitlement is discovered post-hoc: event arrives after the action executed.
2. `ExposureAnalyzer` includes `EXECUTED` action because a restore point exists.
3. Investigator proposes `COMPENSATE`; policy scores high risk (value/volume) ⇒ **2 approvals, one
   from `SENIOR_REVIEWER`**.
4. A `REVIEWER` approves. `quorum.met = false`; the case stays `AWAITING_APPROVAL`. A second,
   different `SENIOR_REVIEWER` approves; quorum is met and the case becomes `APPROVED`.
5. The first reviewer tries to execute: 409 `APPROVER_CANNOT_EXECUTE`. A third person (`REVIEWER`)
   executes `RESTORE_LAST_KNOWN_GOOD` with the restore point.
6. The executor commits intent, calls the target once. The response is lost. Execution becomes
   `UNKNOWN`; the case is `VERIFYING`; **no retry**.
7. Verification reads the target: state matches the restore point ⇒ execution `SUCCEEDED`
   (`resolvedByVerification = true`), case `CLOSED_RESOLVED`. If it does not match ⇒ `REOPENED`
   (Scenario D), not "recovered".
8. The outbox carries the notification and KPI event; the audit chain records both approvals, the
   execution, the lost response, and the resolving read.

## 7. Concurrency and locking

| Concern | Mechanism |
|---|---|
| Two transitions on one case | `SELECT … FOR UPDATE` on the `Case` row inside the transition transaction |
| Two approvals | Unique `(caseId, reopenCount, reviewerId)`; count under the case row lock |
| Two executes | `IdempotencyRecord(scope,key)` + `ActionExecution.idempotencyKey` + case row lock; loser gets 409 or replay |
| Two policy activations | Partial unique index on `status = 'ACTIVE'`; transaction retires the old row first |
| Outbox workers | `FOR UPDATE SKIP LOCKED` with a visibility timeout |
| Reconcile / anchor / eval | Postgres advisory locks (`reconcile`, `anchor`, `eval:<mode>`) |
| Audit chain append | `pg_advisory_xact_lock` on the ledger, or a serializable insert with retry once on 40001 |
| Approval expiry | Database `now()` is authoritative; application clocks never decide |

## 8. Trust boundaries

| Boundary | Enforcement |
|---|---|
| Browser → server | OIDC session (credentials only in local/preview); permission checked per request in `lib/rbac.ts` |
| Automation → ingest | `x-agent-key` = `AGENT_SERVICE_KEY`, rate-limited, idempotent |
| Control plane → target write | `TARGET_SERVICE_KEY`, sent by `lib/executor`; verified by `lib/target/auth` |
| Cron → internal ops | `x-ops-key`, limited to reconcile/outbox/anchor; cannot decide cases or write target state |
| Logical system isolation | Prefixed tables (`tgt_*`, `src_*_*`); cross-family joins outside `lib/adapters` are a review blocker |
| Target write boundary | HTTP `POST /api/v1/target/*` with `x-target-key`; `tgt_*` is written only by `lib/target/service.ts` |
| Agent → anything | No credentials. Read-only tools. Output validated by Zod + citation validator |
| Server → Gemini | Server-only; prompts contain record excerpts, never secrets or PII beyond seeded data |
| Server → anchor store | Write-only credential, append-only bucket; cannot read other tenants' objects |
| Telemetry exporter | Fire-and-forget; no domain data; cannot alter a decision |

## 9. Architectural invariants (violations are review blockers)

1. No LLM call inside `gate`, `policy`, `approval`, `executor`, `verifier`, `integrity`, `exposure`.
2. No write to `tgt_*` except from `lib/target/service.ts`, and no way to reach that write except through `lib/executor` → `lib/adapters/target`.
3. No state transition outside `lib/state-machine/case.ts`.
4. No `AuditEvent` update or delete, ever; a broken chain freezes writes.
5. No gate decision without a persisted `ActionHold` when the answer is `HOLD`.
6. No execution without quorum, role coverage, unexpired approvals bound to the current evidence and policy, and an executor who is not an approver.
7. No success claim without a `VerificationResult` with `passed=true`; an `UNKNOWN` execution is never success.
8. No automatic retry of a target write; unknown outcomes reconcile by reading state.
9. Adapter calls only through `lib/adapters/*`; no ad-hoc `fetch` to source or target systems.
10. Every mutating route goes through permission check, idempotency, audit append and write admission, in that order.
11. Every side effect that must survive a crash is an outbox event written in the business transaction.
12. Exactly one active `PolicyVersion`; a decision always names the hash it used.
