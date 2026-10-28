# API.md — Contracts and Conventions

All application endpoints are Next.js route handlers under `/api/v1`. Authentication routes use
Auth.js under `/api/auth/*`. Every response follows one envelope. This file is normative; a route
that deviates is a defect.

---

## 1. Base configuration

| Environment | Base URL |
|---|---|
| Local | `http://localhost:3000/api/v1` |
| Preview | `https://<preview>.vercel.app/api/v1` |
| Production | `https://<domain>/api/v1` |

Content type `application/json`. Timestamps ISO-8601 UTC. Ids are strings. Money is
`{ amountMinor: string, currency: "USD" }`.

## 2. Envelope

```json
{ "ok": true,  "data": <T>, "meta": { "requestId": "req_…", "traceId": "4bf9…",
  "policyVersion": "2026.10.1", "policyHash": "sha256:…", "replayed": false } }
{ "ok": false, "error": { "code": "APPROVAL_QUORUM_NOT_MET", "message": "…",
                          "details": { }, "requestId": "req_…" } }
```

Rules: no bare arrays at the top level; list responses use `meta.pagination`. `message` is user-safe.
`details` is structured and never contains stack traces, SQL, secrets, upstream messages, email
addresses or record payloads. `meta.traceId` is present whenever tracing is enabled. `meta.replayed`
is present on mutating responses and is `true` when an idempotency replay served the response.

`x-request-id` is echoed on every response. The same value appears in logs and in any `AuditEvent`
produced by the request.

## 3. Authentication

| Caller | Mechanism | Header / cookie |
|---|---|---|
| Human (production) | OIDC authorization code + PKCE via Auth.js | `aic_session` cookie |
| Human (local/preview only) | Credentials provider | `aic_session` cookie |
| Automation agent | `AGENT_SERVICE_KEY` | `x-agent-key` |
| Executor → target | `TARGET_SERVICE_KEY` | `x-target-key` |
| Cron / worker | `OPS_SERVICE_KEY` | `x-ops-key` |

- Production disables the credentials provider at startup (`AUTH_CREDENTIALS_ENABLED=false` or
  `NODE_ENV=production`); there is no password fallback.
- Session cookie: `httpOnly`, `secure` in production, `sameSite=lax`, 8 h absolute, 30 min rolling.
- Role and `sessionEpoch` are re-read from `User` on every privileged call. A token whose epoch is
  stale returns 401 `SESSION_STALE`; a deactivated user returns 403 `USER_INACTIVE`.
- Service keys use `crypto.timingSafeEqual` on equal-length buffers and are accepted only from the
  header, never from a cookie or query.
- 401 `UNAUTHENTICATED` — no/invalid session or key. 403 `FORBIDDEN` — authenticated, permission
  missing (see `RBAC.md`). 403 `INVALID_SERVICE_CONTEXT` — console session on a service route or the
  reverse.
- There is no registration, invitation, or password-reset endpoint, and no route returns whether an
  email exists. Accounts are created by `POST /admin/users` or provisioned from the OIDC claim on
  first login.

## 4. Rate limits

Enforced by `lib/rate-limit.ts`, shared across instances (Redis or platform limiter) in production.
The limiter **fails closed**: if its store throws, the request returns 503
`RATE_LIMITER_UNAVAILABLE`, never "allowed".

| Endpoint group | Limit | Key |
|---|---|---|
| `/auth/*` | 10 / 5 min | IP **and** email (both must pass) |
| `/actions/ingest` | `RATE_LIMIT_INGEST_PER_MIN` (120) | agent key + accountId |
| `/integrity/evaluate` | 6 / min | agent key |
| `/sources/*` | 300 / min | agent key |
| `/cases/:ref/investigate` | 3 / 10 min | case ref (LLM cost guard) |
| `/cases/:ref/approve` | 12 / hour | user id + case ref |
| `/cases/:ref/execute` | 6 / hour | user id + case ref |
| `/admin/break-glass*` | 3 / hour | user id |
| `/admin/*` (other) | 30 / min | user id |
| `/internal/*` | 60 / min | ops key or user id |
| `/eval/runs` (POST) | 2 / 10 min | user id |
| `/metrics` | 60 / min | service key |
| all other writes | 60 / min | user id |
| all reads (`GET`) | 300 / min | user id or service key |

Exceeded ⇒ 429 `RATE_LIMITED` with `Retry-After` seconds. Authentication lockout is exponential
backoff per IP and per email, capped at 15 minutes, never a permanent lock. Two users never share a
bucket.

Limiter groups are a closed union — `auth`, `ingest`, `integrity`, `sources`, `investigate`,
`approve`, `execute`, `break-glass`, `admin`, `internal`, `eval`, `metrics`, `write`, `read` — and
`enforceRateLimit(group, principal)` accepts only a member. A startup assertion (and test) proves
every route in `ROUTE_PERMISSIONS` maps to one group; an unmapped route fails boot.

## 5. Idempotency

- Every mutating request (`POST`, `PATCH`, `DELETE`) under `/api/v1` requires `Idempotency-Key`
  (8–128 chars, `^[A-Za-z0-9_-]+$`). Missing key ⇒ 400 `IDEMPOTENCY_KEY_REQUIRED`. The only
  exceptions are `/internal/*`, which are idempotent by design, and `/auth/*`.
- The key is scoped to `route + actor`. Same key + same request body hash ⇒ the stored response is
  replayed with `meta.replayed: true` and the original status code. Same key + different body ⇒ 409
  `IDEMPOTENCY_CONFLICT` and no work is done.
- A record is `IN_PROGRESS` while the request runs. A concurrent duplicate waits up to 5 s for
  completion; if still in progress, 409 `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1`.
- Keys are retained 30 days. The idempotency record is not an audit record; the audit trail is
  `AuditEvent`.

## 6. Endpoints

### 6.1 Health and ops

**`GET /health`** — public, no session.
```json
{ "status": "ok", "db": "ok", "mode": "AGENT", "degradation": "L0_NORMAL",
  "policyVersion": "2026.10.1", "policyHash": "sha256:…", "commit": "a1b2c3d",
  "checkedAt": "2026-10-26T09:12:00Z" }
```
`status ∈ ok | degraded | failing`. Returns 503 when the database is unreachable or
`degradation = L4_AUDIT_BROKEN`, with the same body and `status: "failing"`.

**`GET /ops/status`** — `ops:read`. Aggregate operational view behind
`/app/settings/operations`:
`{ degradation, dependencies: [{name, up, latencyMs}], outbox: {pending, dlq, oldestAgeSeconds},
anchors: {lastSeq, ageSeconds, status}, executionsUnknown, casesStale, jobs: [{job, lastSuccessAt,
consecutiveFailures}] }`.

**`GET /metrics`** — `SERVICE_OPS`, only when `METRICS_ENDPOINT_ENABLED=1`. Prometheus text format.

### 6.2 Integrity

**`POST /integrity/evaluate`** — `service:evaluate`. Body `{ contractKeys?: string[] }`.
Runs contract checks, persists snapshots and events. Idempotent per `(contractId, payloadHash)`.
→ `{ evaluated: 8, eventsCreated: 1, eventsSuppressed: 0 | n, events: [IntegrityEvent] }`

**`GET /integrity/events?status=OPEN&severity=HIGH&cursor=&limit=`** — `integrity:read`.
→ paginated `IntegrityEvent` projections.

**`POST /integrity/events/:id/dismiss`** — `integrity:dismiss`. Body `{ reason }`. Sets `DISMISSED` + audit.

**`GET /contracts?status=&cursor=&limit=`** — `contract:read`. Read-only registry: `key`, `entity`,
`declaredFields`, allowed enum values, `version`, `ownerTeam`, `lastCheckedAt`.
**`GET /contracts/:key`** → the contract plus its ten most recent `SourceSnapshot` hashes. No write
endpoint: contracts are versioned in `config/` and applied by migration, not from the console.

### 6.3 Outbound actions

**`POST /actions/ingest`** — `service:ingest`, requires `Idempotency-Key`.
```json
{ "sourceAgent": "entitlement-sync-agent",
  "accountId": "acc_00042",
  "actionType": "ENTITLEMENT_REVOKE",
  "payload": { "entitlementKey": "SSO", "from": "ACTIVE", "to": "REMOVED" },
  "requestedAt": "2026-10-26T09:12:00Z" }
```
→ 201 `{ action, gate: { decision, reasons, caseRef? }, execution?, case? }`
`ALLOW` ⇒ the control plane's executor performs the target write immediately (restore point captured
first) and returns the `execution`; the caller never writes to the target system itself.
`HOLD` ⇒ nothing is written; the target write is deferred until an approved release.
`BLOCK` ⇒ payload rejected permanently; a retry requires a new idempotency key.
409 `ACTION_ALREADY_HELD` if an open hold exists for the same account+actionType+payload hash.
503 `DEPENDENCY_UNAVAILABLE` if the DB or target is unavailable; no gate decision is persisted and no
write occurs, so the caller retries with the same key. At `L2_TARGET_DEGRADED`, `HOLD` decisions are
still served and executions are not attempted.

**`GET /actions?status=HELD&accountId=&cursor=&limit=`** — `action:read`. A held action is released only
through `POST /cases/:ref/execute` on an `APPROVED` case; there is no separate release endpoint, so
the consequential write has exactly one door.

**`GET /actions/:id`** — `action:read`. Single action projection for `/app/actions/[actionId]`: action,
gate decision and reasons, hold, exposure summary, restore point when the action executed, and the
linked `caseRef` if one exists. Read-only; there is no action mutation endpoint.

### 6.4 Cases

**`GET /cases?status=&severity=&mode=&riskBand=&disposition=&cursor=&limit=`** — `case:read`.
`disposition` filters on the case's current `PolicyDecision.disposition`; one value per request.
**`GET /cases/:ref`** — `case:read`. Returns case, event, actions, holds, latest report +
hypotheses, evidence, policy decision, approvals with quorum summary, executions, verifications,
break-glass elevation, timeline (audit), and `degradationLevel` at decision time.

**`GET /cases/:ref/approvals`** — `case:read`. Quorum panel:
`{ approvals: [...], quorum: { current, required, requiredRoles, satisfiedRoles, missingRoles,
expiresAt, disposition, evidenceHash, policyHash } }`.

**`POST /cases/:ref/investigate`** — `case:investigate`. Body `{ force?: boolean }`.
Creates a run id, calls the investigator (or deterministic fallback), persists `InvestigationReport` +
`Hypothesis` rows, and moves the case to `AWAITING_EVIDENCE` or `AWAITING_APPROVAL`. A new report
supersedes outstanding approvals.
→ 202 `{ runId, status: "INVESTIGATING" }`. 409 if terminal. 429 on the LLM cost guard. 503
`AGENT_UNAVAILABLE` only if the deterministic fallback also fails (the request still holds the action).

**`GET /cases/:ref/report`** — `case:read`. Latest report + hypotheses.

**`POST /cases/:ref/evidence-requests`** — `case:request_evidence`. Body
`{ ownerTeam, question, dueInHours }`. Creates `EvidenceRequest`, moves the case to `AWAITING_EVIDENCE`.

**`POST /cases/:ref/evidence`** — `case:add_evidence`. Body
`{ kind, sourceKey, recordRef, excerpt, stance }`. Appends `EvidenceItem`; recomputes completeness;
supersedes every `VALID` approval; moves `AWAITING_EVIDENCE → INVESTIGATING` when the new item
contradicts the report or satisfies a `missingEvidence` entry, otherwise
`AWAITING_EVIDENCE → AWAITING_APPROVAL`; `APPROVED → AWAITING_APPROVAL` when approvals existed. It
never sets a disposition itself.

**`POST /cases/:ref/policy`** — `case:compute_policy`. Recomputes `PolicyDecision` (deterministic) from
the latest report and the **active** `PolicyVersion`, binding `policyHash`, `evidenceHash`,
`requiredApprovals` and `requiredRoles`. → `{ riskScore, riskBand, disposition, allowedDispositions,
approvalRequired, requiredApprovals, requiredRoles, approvalExpiresAt, policyVersion, policyHash }`.
Incomplete evidence yields `HOLD_FOR_EVIDENCE` and removes write dispositions; attempting a write
approval then returns 422.
409 `POLICY_UNAVAILABLE` when no policy version is active.

**`POST /cases/:ref/approve`** — `case:approve`; high-risk also requires `case:approve_high`. Body
`{ decision: "APPROVE"|"REJECT"|"OVERRIDE", disposition: Disposition, rationale }`.
`rationale` required (≥20 chars) for `REJECT`/`OVERRIDE`. `disposition` must be in
`allowedDispositions` and must match any existing valid approval. → `{ approval, quorum, case }`.
- 422 `EVIDENCE_INCOMPLETE` if approval would permit a write below the completeness threshold.
- 409 `DUPLICATE_APPROVER` if this reviewer already approved this lifecycle.
- 409 `APPROVAL_CONFLICT` if the disposition differs from an existing valid approval.
- 409 `REVIEWER_CONFLICT` if the reviewer authored every cited evidence item or recorded the override.
- 409 `INVALID_TRANSITION` if the case is not `AWAITING_APPROVAL` / `APPROVED` (a later approval on an
  already-approved case is allowed while quorum is unmet; it is rejected once execution starts).
- 403 `FORBIDDEN` if the reviewer lacks the risk-tier permission.
A `REJECT` ends the lifecycle: other approvals become `REVOKED`, case `→ REJECTED`.

**`POST /cases/:ref/execute`** — `case:execute`; high risk also requires `case:execute_high`. Requires
`Idempotency-Key`. Executes the single action the decision permits: `RELEASE_AFTER_CORRECTION`
(release), `COMPENSATE` (`RESTORE_LAST_KNOWN_GOOD`), or `BLOCK` (no write; returns
`{ execution: null, noTargetWrite: true, case }` and moves the case to `VERIFYING`).
Before any target write **and before completing a block**, in one transaction, the handler re-checks:
quorum, required roles, approval status and expiry, evidence hash, policy hash, disposition,
approver ≠ the actor taking this step, break-glass completeness.
Any failure is a specific 409 and **no write occurs**:
`INVALID_TRANSITION`, `APPROVAL_QUORUM_NOT_MET`, `APPROVER_CANNOT_EXECUTE`, `APPROVAL_EXPIRED`,
`EVIDENCE_CHANGED`, `POLICY_STALE`, `REVIEWER_CONFLICT`, `BREAK_GLASS_INCOMPLETE`.
→ 202 `{ execution }` for a write, 200 for a block. The execution may return with
`status: "UNKNOWN"` when the target outcome is not confirmed; this is a valid response, not an error.
409 `ALREADY_EXECUTING` when another execution for the same case lifecycle is in flight.
409 `NO_RESTORE_POINT` ⇒ case `SAFE_REFUSAL`.
503 `DEGRADATION_BLOCKED` when the level forbids writes (`L2`/`L3`/`L4`), with `details.level`.

**`POST /cases/:ref/verify`** — `case:verify`. Body `{ attempts?: 1..3 }` (default 2). Reads target
state, appends `VerificationResult`, resolves any `UNKNOWN` execution (`observed == expected` ⇒
`SUCCEEDED` with `resolvedByVerification=true`; otherwise `FAILED`), closes (`CLOSED_RESOLVED`) or
reopens (`REOPENED`). → `{ verification, execution?, case }`. If the target cannot be read after all
attempts, no `VerificationResult` is written, the case becomes `ESCALATED`, and the response is 502
`TARGET_UNAVAILABLE`.

**`POST /cases/:ref/reopen`** — `case:reopen`. Body `{ reason }`. Only from `CLOSED_RESOLVED`;
increments `reopenCount` and requires a new approval before any further execution.

**`POST /cases/:ref/escalate`** — `case:escalate`. Body `{ ownerTeam, reason }`. → `ESCALATED`.

### 6.5 Administration

**`GET /admin/users?role=&active=&cursor=`** — `user:read`.
**`POST /admin/users`** — `user:manage`. Body `{ email, name, roles, oidcSubject? }`. In production a
password is never set by this endpoint.
**`PATCH /admin/users/:id`** — `user:manage`. Body `{ roles?, isActive? }`. Bumps `sessionEpoch`.
409 `SELF_ROLE_CHANGE` when changing your own roles. 422 `ROLE_CONFLICT` for `ADMIN` combined with
`REVIEWER`/`SENIOR_REVIEWER`/`AUDITOR`.

**`GET /admin/policy`** — `policy:read`. Active version + hash + history (no document bodies beyond
the active one).
**`POST /admin/policy/activate`** — `policy:activate`. Body `{ version, hash, reviewTicket }`. The
server recomputes the hash from `config/policy/<version>.json`; a mismatch is 409
`POLICY_HASH_MISMATCH` and nothing changes. Activation retires the previous version, supersedes open
approvals, writes `POLICY_ACTIVATED`, and enqueues an outbox event.

**`POST /admin/break-glass`** — `break_glass:request`. Body
`{ caseRef, reason (≥50 chars), ttlMinutes ≤ 60 }`. → 201 elevation in `PENDING_COSIGN`.
**`GET /admin/break-glass?status=&caseRef=&cursor=&limit=`** — `break_glass:read` (`ADMIN` or `AUDITOR`).
Register for `/app/settings/approvals`; projections carry no reason text beyond the requester's
audited case.
**`GET /admin/break-glass/:id`** — `break_glass:read` (`ADMIN` or `AUDITOR`).
**`POST /admin/break-glass/:id/cosign`** — `break_glass:cosign`, must be a different admin. Creates a
`breakGlass` approval and moves the elevation to `ACTIVE`. It counts as **one** approval and, on a
high-risk case, fills the `SENIOR_REVIEWER` slot only; a distinct reviewer approval is still required.
**`POST /admin/break-glass/:id/revoke`** — `break_glass:request` or the co-signer. Body `{ reason }`.
→ elevation `REVOKED`; writes `BREAK_GLASS_REVOKED`.

### 6.6 KPIs and audit

**`GET /kpis?from=&to=&window=7d|30d&refresh=1`** → `{ prevention, investigation, recovery, business,
assumptions, capturedAt, policyVersion, policyHash }`. Definitions: `EVALUATION.md` §8.
Cached 60 s per window; `refresh=1` (`kpi:refresh`) bypasses the cache and writes a `KpiSnapshot`.

**`GET /audit?caseRef=&actorType=&eventType=&from=&to=&cursor=&limit=`** — `audit:read`, read-only.
**`GET /audit/:id`** → single event + `hash`, `prevHash`, `anchor: { seq, rootHash, externalUri,
verifiedAt }`, `verification: "chain_ok" | "chain_broken"`.

### 6.7 Internal operations (service)

**`POST /internal/reconcile`** — `ops:reconcile` (ops key or `ADMIN`). Resolves stale state:
`PENDING` executions older than `EXECUTION_TIMEOUT_MS` ⇒ `UNKNOWN`; expired `EvidenceRequest` ⇒
`EXPIRED` + case `ESCALATED`; overdue approvals ⇒ `EXPIRED` + `AWAITING_APPROVAL`; orphan outbox
events republished. Idempotent.
→ `{ executionsMarkedUnknown, evidenceRequestsExpired, approvalsExpired, casesEscalated, outboxRequeued }`.

**`GET /internal/outbox?status=&limit=`** — `ops:outbox`.
**`POST /internal/outbox/drain`** — `ops:outbox`. Body `{ limit?: number }`.
**`POST /internal/outbox/:id/replay`** — `ops:outbox`. Only from `DLQ`; resets attempts and audits.

**`POST /internal/audit/anchor`** — `ops:anchor`. Computes and uploads the anchor. → `{ anchor }`.
**`POST /internal/audit/verify`** — `audit:verify`. Body `{ fromSeq?, toSeq?, compareExternal? }`.
→ `{ verified, firstBrokenSeq?, checked, externalMatches }`.

**`POST /internal/degradation`** — `ops:reconcile` or `ADMIN`. Body `{ level, reason }`. Only allows
moving to a **more** restrictive level than the computed one; raising requires the underlying probe to
recover. `{ level: "AUTO" }` clears a forced level. 409 `DEGRADATION_RAISE_FORBIDDEN`.

**`POST /internal/kpis/snapshot`** — `ops:anchor` or `kpi:refresh`. Persists a `KpiSnapshot`.

### 6.8 Evaluation

**`POST /eval/runs`** — `eval:run`. Body `{ suiteVersion: "v1", mode: "agent"|"deterministic",
kind: "deterministic"|"agent"|"adversarial" }`. → 202 `{ runId }`. One run at a time per mode
(advisory lock). Load, chaos and DR runs are started by their drill scripts and recorded as
`ScenarioRun` with `kind = LOAD|CHAOS|DR`.
**`GET /eval/runs`** — `eval:read`. List with summary metrics.
**`GET /eval/runs/:id`** — `eval:read`. Per-scenario results + metrics + comparison against the most
recent run of the other mode on the same commit.

### 6.9 Synthetic systems (internal namespaces)

`GET /sources/:source/records?...` — `service:source_read`; `source ∈ contract|billing|usage|support|account`.
Returns projections only; never raw table rows beyond declared fields.
`GET /target/entitlements?accountId=&key=` · `GET /target/service-status?accountId=` ·
`GET /target/restore-point?targetObjectType=&accountId=&key=` (returns `{ state, stateHash,
capturedAt }`) · `POST /target/entitlements/change` · `POST /target/service-status/change` ·
`POST /target/entitlements/restore` · `POST /target/service-status/restore` — `SERVICE_TARGET` only;
change bodies are `{ accountId, entitlementKey?, from?, to }` (`TargetEntitlementStatus` or
`ServiceState`), restore bodies are `{ accountId, entitlementKey?, snapshot }`. All writes require
`Idempotency-Key`, capture the before-state into `tgt_audit`, and return
`{ result, auditId, beforeState }`. The target honours `traceparent` and echoes `requestId` in
`tgt_audit`.

## 7. Status codes

`200` ok · `201` created · `202` accepted (async) · `400` `VALIDATION_ERROR` /
`IDEMPOTENCY_KEY_REQUIRED` · `401` `UNAUTHENTICATED` / `SESSION_STALE` · `403` `FORBIDDEN` /
`USER_INACTIVE` / `INVALID_SERVICE_CONTEXT` · `404` `NOT_FOUND` · `409` conflict (catalogue in §8) ·
`422` `EVIDENCE_INCOMPLETE` / `ROLE_CONFLICT` · `429` `RATE_LIMITED` · `500` `INTERNAL_ERROR` ·
`502` `UPSTREAM_FAILED` / `TARGET_UNAVAILABLE` / `AGENT_UNAVAILABLE` · `503`
`DEPENDENCY_UNAVAILABLE` / `RATE_LIMITER_UNAVAILABLE` / `DEGRADATION_BLOCKED`.

## 8. Error catalogue (excerpt — full list maintained in code)

| Code | Status | When | Client action |
|---|---|---|---|
| `INVALID_TRANSITION` | 409 | state machine rejects | refresh case, re-check allowed actions |
| `EVIDENCE_INCOMPLETE` | 422 | completeness < 0.8 | request more evidence |
| `DUPLICATE_APPROVER` | 409 | same reviewer twice in one lifecycle | show existing approval |
| `APPROVAL_CONFLICT` | 409 | two valid approvals name different dispositions | void one, re-approve one disposition |
| `APPROVAL_QUORUM_NOT_MET` | 409 | execute before quorum | show missing approvals/roles |
| `APPROVER_CANNOT_EXECUTE` | 409 | executor is an approver | route to another executor |
| `APPROVAL_EXPIRED` | 409 | approval window elapsed | re-approve |
| `EVIDENCE_CHANGED` | 409 | evidence hash differs from binding | review new evidence, re-approve |
| `POLICY_STALE` | 409 | policy hash differs from binding | re-approve under active policy |
| `REVIEWER_CONFLICT` | 409 | separation-of-duties violation | another reviewer |
| `BREAK_GLASS_INCOMPLETE` | 409 | elevation not co-signed/expired/wrong case | complete co-sign |
| `NO_RESTORE_POINT` | 409 | compensation without restore point | switch to `SAFE_REFUSAL` |
| `POLICY_UNAVAILABLE` | 409 | no active policy version | activate a policy |
| `POLICY_HASH_MISMATCH` | 409 | activation hash mismatch | recompute and retry |
| `AGENT_UNAVAILABLE` | 502 | Gemini and fallback both failed | keep the hold; retry investigation |
| `TARGET_UNAVAILABLE` | 502 | target adapter failed | execution stays `UNKNOWN`; verify later |
| `IDEMPOTENCY_CONFLICT` | 409 | same key, different payload hash | submit with a new key |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | duplicate request still running | retry after `Retry-After` |
| `ALREADY_EXECUTING` | 409 | another execution in flight | refresh the case |
| `DEGRADATION_BLOCKED` | 503 | `L2`/`L3`/`L4` forbids writes | read `details.level`; wait or escalate |
| `OUTBOX_DLQ` | 409 | replaying a non-DLQ event | check status first |

## 9. Third-party integration

| Provider | Purpose | Env | Server-only | Failure behavior |
|---|---|---|---|---|
| Google Gemini | Investigation reasoning | `GEMINI_API_KEY`, `GEMINI_MODEL` | yes | one retry → deterministic fallback, case flagged |
| OIDC IdP | Human identity | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | yes | new logins fail; existing sessions continue (`L5`) |
| Object store | Audit anchors | `ANCHOR_STORE_*` | yes | retries, then stale-anchor alert |
| OTLP collector | Traces/metrics | `OTEL_EXPORTER_OTLP_ENDPOINT` | yes | telemetry drops; product unaffected |

No webhooks in v1. No client-side calls to Gemini, `/sources/*`, `/target/*` or `/internal/*`.

## 10. Versioning

Path version `v1` remains the only version; all production-edition endpoints are additive. Removing or
renaming a field is breaking and requires `v2`. `meta.policyVersion`, `meta.policyHash` and
`meta.promptVersion` are returned on decision-bearing responses so a reviewer can tell which rules and
which prompt produced an outcome.
