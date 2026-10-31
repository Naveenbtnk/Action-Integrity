# FAILURE_MODES.md — Failure taxonomy, retry policy and degradation

Normative for `lib/executor`, `lib/agent`, `lib/outbox`, `lib/observability`, `lib/audit`, the
reconciliation job and every failure test. The rule above all others: **an unknown outcome is never
treated as success, and a write is never retried blindly.**

---

## 1. Retry taxonomy

Every outbound call is classified before it is written. The class determines retry behaviour; there is
no per-call judgement in code.

| Class | Examples | Automatic retries | Requirement |
|---|---|---|---|
| `SAFE_READ` | source reads, target reads, contract reads, verification reads | Yes, up to 3 | None |
| `IDEMPOTENT_WRITE` | audit anchor upload, outbox publish, KPI snapshot | Yes, bounded | Stable key; duplicate delivery harmless |
| `UNSAFE_WRITE` | target entitlement/status change, restore | **Never** | Caller records `UNKNOWN` and reconciles by reading state |
| `LLM_CALL` | Gemini investigation | Yes, 1 retry | Deterministic fallback if both fail |
| `AUTH` | OIDC token exchange, session refresh | 1 retry on network error only | Never on 4xx |

### 1.1 Policy

| Operation | Attempts | Backoff | Retry on | Do not retry on |
|---|---|---|---|---|
| Source / target / verification read | 3 | 100 ms, 400 ms, jitter 0–100 ms | timeout, connection reset, 5xx | 4xx, validation, schema mismatch |
| Gemini | 2 total | 1 s, jitter 0–250 ms | 429, 5xx, timeout | 400/403/404, safety block, schema-invalid output (repair prompt instead) |
| Outbox publish | 8 | 1 s → 2 s → 4 s … cap 5 min, full jitter | any delivery failure | payload validation failure (DLQ immediately) |
| Audit anchor upload | 5 | 30 s → 2 min → 10 min | 5xx, timeout | 403 (configuration error, page) |
| DB transaction | 2 | 50 ms | connection error **before** commit | any error after commit is ambiguous — surface, never retry |
| Target write | 1 | — | — | everything |

Rules:

- **Retry budget:** retries may not exceed 10% of first attempts per dependency per 5 minutes. When the
  budget is exhausted, the circuit breaker opens; new calls fail fast with the dependency's error.
- **Circuit breaker:** opens after 20 failures in 5 minutes (or 5 consecutive failures for the target),
  half-open after 60 s with a single probe. State is exported as `aic_dependency_up`.
- **Jitter is mandatory.** Deterministic backoff creates synchronised retry storms.
- **Idempotency is a precondition, not a substitute.** Only calls with a stable idempotency key may be
  in the `IDEMPOTENT_WRITE` class. A target write is not in that class even though it has a key,
  because "at most once" cannot be guaranteed across a lost response.
- **Every retry is visible:** span event `retry`, log field `attempt`, metric `aic_outbox_attempts_total`
  or `aic_llm_requests_total`. A silent retry is a defect.

## 2. Degradation ladder

The system degrades in named levels. Each level states what still works. The current level is exposed
on `/health` as `degradation` and on `/app/settings/operations`.

| Level | Trigger | Consequential writes | Console | Gate | Investigation |
|---|---|---|---|---|---|
| `L0_NORMAL` | all dependencies healthy | allowed | full | full | agent |
| `L1_LLM_DEGRADED` | Gemini circuit open or fallback > 10% | allowed, but fallback reports cannot yield `ALLOW` | full, banner | full | deterministic fallback |
| `L2_TARGET_DEGRADED` | target circuit open | blocked: execute returns 503 before any write; existing `UNKNOWN` awaits verification | full, banner | full (holds only) | unchanged |
| `L3_DB_DEGRADED` | DB unavailable or read-only | blocked: 503 `DEPENDENCY_UNAVAILABLE` | read-only cached pages, no case data | unavailable | unavailable |
| `L4_AUDIT_BROKEN` | chain verification fails or a mutation is detected | **frozen** except audit repair | read-only | ingest returns 503 | blocked |
| `L5_IDENTITY_DEGRADED` | OIDC provider down | existing sessions continue until expiry; new logins fail | existing sessions only | service keys unaffected | unchanged |

Rules:

- Level is computed from live probes, not set by hand. An operator may force a level only downward
  (more restrictive) via `POST /internal/degradation` (`ADMIN`/`SERVICE_OPS`), audited.
- `L4` is the only level that freezes the gate. A broken audit chain means the record of a decision
  cannot be trusted, so the decision must not be made.
- Every level transition writes an `AuditEvent` (`DEGRADATION_CHANGED`) and a metric
  `aic_degradation_level`.
- Recovery from `L2`/`L3` is automatic after two consecutive successful probes; recovery from `L4`
  requires a verified repair run and an `ADMIN` acknowledgement.

## 3. Catalogue

`X` = automatic retry allowed; `—` = never.

| ID | Failure | Detection | Behaviour | Recoverable by | Test |
|---|---|---|---|---|---|
| F-01 | Database unreachable at ingest | connection error | 503 `DEPENDENCY_UNAVAILABLE`; no gate decision, no case, no write; request id logged | dependency recovery; client retries with same key | `tests/failure/db-down.test.ts` |
| F-02 | DB statement timeout mid-transaction | `statement_timeout` | whole transaction rolls back; 503; no partial case/audit/approval | retry after dependency recovers | `tests/failure/db-timeout.test.ts` |
| F-03 | DB failover during commit | connection lost after commit sent | outcome ambiguous: response 503, **no** automatic retry; idempotency record resolves on next call | duplicate key lookup; reconciliation | `tests/failure/db-ambiguous-commit.test.ts` |
| F-04 | Target unreachable on write | timeout / 5xx | execution `UNKNOWN`, case `VERIFYING`, `UNKNOWN` warning; **no retry** | verification read or reconcile | `tests/failure/target-down.test.ts` |
| F-05 | Target 200, state unchanged | verification read mismatch | `VerificationResult.passed=false`, case `REOPENED`, alert `TargetErrorRateHigh` if repeated | new investigation / compensation | `tests/failure/target-noop.test.ts` |
| F-06 | Target wrote, response lost | execution `UNKNOWN` | held open; verification read resolves: observed == expected ⇒ execution `SUCCEEDED` (`resolvedByVerification=true`); else `FAILED` | verification | `tests/failure/target-lost-response.test.ts` |
| F-07 | Gemini 429 then success | provider status | one retry with jitter; report persisted; audit payload `retried=true`; metric | automatic | `tests/failure/llm-retry.test.ts` |
| F-08 | Gemini fails twice | second failure | deterministic fallback report, `isFallback=true`; case warning `AGENT_FALLBACK`; action stays held; fallback cannot yield `ALLOW` | re-investigate when provider recovers | `tests/failure/llm-outage.test.ts` |
| F-09 | Gemini returns invalid schema | Zod failure | one repair prompt; second failure ⇒ fallback (F-08); raw output never persisted | re-investigate | `tests/failure/llm-schema.test.ts` |
| F-10 | Prompt injection in evidence | `suspiciousContent` non-empty or tool arg out of scope | content treated as data; no disposition/tool change; fixture X expectation | reviewer sees flag | `tests/agent/injection.test.ts` |
| F-11 | Same idempotency key, same payload, concurrent | key lookup | one target write, one `ActionExecution`, second response 200 `meta.replayed=true` | automatic | `tests/executor/idempotency.test.ts` |
| F-12 | Same key, different payload | hash mismatch | 409 `IDEMPOTENCY_CONFLICT`, no write | caller uses a new key | `tests/executor/idempotency-conflict.test.ts` |
| F-13 | Double execute (two tabs, two reviewers) | `SELECT … FOR UPDATE` on case + execution key | one execution; loser gets 409 `ALREADY_EXECUTING` or replay; never two target writes | automatic | `tests/executor/concurrent-execute.test.ts` |
| F-14 | Crash after execution row, before target call | stale `PENDING` > `EXECUTION_TIMEOUT_MS` | reconcile marks `UNKNOWN`; verification read resolves; no auto-retry | reconcile + verify | `tests/failure/executor-crash.test.ts` |
| F-15 | Duplicate ingest, different keys | open hold query | 409 `ACTION_ALREADY_HELD`; exactly one hold and one case | none needed | `tests/integrity/duplicate-ingest.test.ts` |
| F-16 | Evidence or policy changes after approval | hash comparison at execute | approvals superseded, case `APPROVED → AWAITING_APPROVAL`; execute 409 `EVIDENCE_CHANGED` / `POLICY_STALE` | re-approve with new binding | `tests/policy/approval-binding.test.ts` |
| F-17 | Approval window expires | DB time vs `expiresAt` | 409 `APPROVAL_EXPIRED`; approvals marked `EXPIRED`; case returns to `AWAITING_APPROVAL` | re-approve | `tests/policy/approval-expiry.test.ts` |
| F-18 | Audit chain broken (mutation, trigger disabled) | `npm run audit:verify` / hourly job | `L4_AUDIT_BROKEN`, consequential writes frozen, SEV1, no auto-repair | restore range from anchor + `ADMIN` ack | `tests/audit/chain-break.test.ts` |
| F-19 | Anchor store unavailable | upload 5xx | retries 5×; writes continue; `AuditAnchorStale` at 3 h; backlog drains on recovery | automatic | `tests/audit/anchor-outage.test.ts` |
| F-20 | Outbox backlog or poison event | lag SLO, DLQ count | business transaction already committed; publisher retries 8× then DLQ; alert; replay tool after fix | `POST /internal/outbox/:id/replay` | `tests/outbox/dlq.test.ts` |
| F-21 | Rate limiter store throws | store error | **fail closed**: 503 `RATE_LIMITER_UNAVAILABLE`; never allow through | store recovery | `tests/security/rate-limit-failclosed.test.ts` |
| F-22 | Service key rotation overlap | old key used | dual-key window `TARGET_SERVICE_KEY_PREVIOUS` accepted for 24 h, then 401; rotation audited | rotation runbook R-08 | `tests/security/key-rotation.test.ts` |
| F-23 | Evidence request SLA expires | `dueAt` passed | reconcile sets `EXPIRED`, case `ESCALATED`; never silently closes | owner returns evidence | `tests/reconcile/sla.test.ts` |
| F-24 | Verification read fails | target read error | 2 read retries; still failing ⇒ `VerificationResult` not written, case `ESCALATED`, `UNKNOWN` stays blocking | R-06 | `tests/failure/verification-read-down.test.ts` |
| F-25 | Clock skew between app and DB | `now()` vs app time | all expiry uses DB `now()`; app clock never decides an approval or SLA | design | `tests/policy/clock-source.test.ts` |
| F-26 | Deactivated user with live session | `sessionEpoch` or `isActive` check | 403 `USER_INACTIVE`; in-flight request rejected before write | admin action | `tests/rbac/inactive.test.ts` |

### 3.1 Notes on the highest-risk modes

**F-04 / F-06 — the lost-response problem.** A target write can succeed while the response is lost.
The executor therefore never infers success from an error and never retries. It writes
`ActionExecution.status = UNKNOWN` with the request payload and the before-state restore point, and
the case can only leave `VERIFYING` through a verification read. The verification read is the source
of truth, not the target's response.

**F-14 — crash windows.** The executor commits the execution row and the outbox event in one
transaction before calling the target. A crash after that commit leaves `PENDING`; reconcile turns it
`UNKNOWN` after `EXECUTION_TIMEOUT_MS`. A crash before the commit leaves nothing to reconcile, and the
case remains in `APPROVED`, where a retry is a new execution attempt with a new idempotency key.

**F-18 — audit break.** Detection is a verification job, not a hope. The trigger that forbids mutation
is tested by deliberately disabling it in a throwaway schema, mutating a row, re-enabling it and
running `audit:verify`. The expected result is a broken chain and a frozen system, not a repaired
record.

## 4. What is never retried

| Operation | Why |
|---|---|
| Target write or restore | A retry can double-apply a state change; the response is not authoritative |
| Policy activation | Two concurrent activations could interleave hashes; requires an explicit call |
| Approval | An approval is a human act; retrying a form submission must not create a second one — idempotency key returns the first |
| Audit append | Part of the transaction; a retry outside the transaction would duplicate the chain |
| Break-glass co-sign | Same reasoning as approval |

## 5. Reconciliation

`lib/executor/reconcile.ts`, invoked by `POST /internal/reconcile` (`SERVICE_OPS` or `ADMIN`) and by
the scheduled job every 60 s:

1. `PENDING` executions older than `EXECUTION_TIMEOUT_MS` (default 120 s) → `UNKNOWN`.
2. `UNKNOWN` executions older than 15 min → flagged on `/app/settings/operations` and the case
   timeline; never auto-retried.
3. Expired `EvidenceRequest` → `EXPIRED`, case `ESCALATED`.
4. Cases in `HOLDING` beyond `HOLD_SLA_HOURS` → `ESCALATED` (never `CLOSED_NO_ACTION`).
5. Overdue approvals → `EXPIRED` and case back to `AWAITING_APPROVAL`.
6. Orphan outbox events older than 5 min → republish (idempotent by event id).
7. Anchors older than 2 h → run anchor.

Each run takes a Postgres advisory lock (`reconcile`), writes one audit event per changed row, and is
idempotent: a second run in the same second changes nothing when no backlog remains. Approval expiry
processes at most five oldest cases per run to bound the audited transaction; later scheduled runs
drain the remaining backlog. Monitor backlog and run frequency before setting an approval-expiry SLO.

## 6. Drills

A drill is a scripted failure injection that asserts the behaviour in §3 and emits the metric and log
line that would page an operator. Drills run against a real Postgres and the real target stub; they do
not mock our own modules.

| Command | Covers | Evidence produced |
|---|---|---|
| `npm run test:failure` | F-01…F-26 integration tests | JUnit XML |
| `npm run test:chaos` | random dependency kills during a 200-case soak | `artifacts/chaos/<ts>/summary.json` |
| `npm run drill:target-down` | F-04/F-06 with a live server | timeline + metric snapshot |
| `npm run drill:db-failover` | F-01/F-03 | recovery time + zero partial rows |
| `npm run drill:audit-break` | F-18 | frozen writes + SEV1 + repair transcript |
| `npm run drill:restore` | backup restore to a scratch DB | RPO/RTO measured against §7 |
| `npm run drill:quorum` | F-16/F-17 plus SoD | approval audit export |

A drill result is only accepted with the command, the commit sha, the timestamp, the observed metric
delta and the operator's initials. Store it under `artifacts/drills/<date>/` (gitignored) and record a
one-line outcome in `docs/PRODUCTION_READINESS.md` §4 when it is used as a release gate.

## 7. Recovery objectives

| Objective | Target | Mechanism |
|---|---|---|
| RPO | ≤ 5 min | Postgres PITR / WAL archiving |
| RTO | ≤ 60 min | documented restore in `OPERATIONS.md` R-12, rehearsed quarterly |
| Reconciliation after outage | ≤ 5 min after dependency returns | scheduled reconcile + outbox drain |
| Maximum tolerated `UNKNOWN` age | 15 min before escalation | alert `ExecutionUnknownStale` |
| Maximum tolerated audit anchor age | 3 h before alert | `AuditAnchorStale` |

## 8. Failure-test rules

- No mocking of `lib/gate`, `lib/policy`, `lib/executor`, `lib/verifier`, `lib/state-machine` or
  `lib/outbox`. Inject at process or network boundaries: bad env, forked process, socket close,
  target stub mode, provider stub.
- Every test asserts three things: the API response, the database state, and the audit trail. A test
  that only asserts the response is incomplete.
- Every test cleans up by truncating control-plane tables and verifying the fingerprint returns to the
  fixture baseline.
- A failure that cannot be reproduced by one of these tests is not fixed; it is a hypothesis.
