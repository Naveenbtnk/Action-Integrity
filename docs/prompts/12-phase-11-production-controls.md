# Phase 11 — Production controls and operations

**Read first:** `docs/OBSERVABILITY.md` (all), `docs/OPERATIONS.md` §2–§6,
`docs/FAILURE_MODES.md` §3–§4, `docs/API.md` §4–§5, `docs/RBAC.md` §8–§9,
`docs/UI_UX_BRIEF.md` §5.10–§5.12, §5.14, §11.
**Goal:** the controls hold under real infrastructure, and an operator can see and act on the system.
**Depends on:** Phase 10 green.

## Scope guard

No new business capability, no new disposition, no schema change beyond an index a test proves is
required. Never weaken a control to make an operational test pass. Every new alert must link to an
existing runbook; if the runbook is missing, write it in `OPERATIONS.md` in the same PR.

## Build

### 1. Rate limiting (shared, fail-closed)

`src/lib/rate-limit.ts` with Redis (in-memory only when `NODE_ENV !== 'production'`):

- implement `API.md` §4 exactly, including `/auth/*` per-IP **and** per-email, `/cases/:ref/investigate`
  3/10 min, approve 12/h, execute 6/h, break-glass 3/h, admin 30/min, internal 60/min, reads 300/min;
- if the store throws ⇒ `503 RATE_LIMITER_UNAVAILABLE`, never "allowed";
- authentication lockout is exponential backoff per IP/email, capped at 15 min, never permanent;
- a startup assertion (and test) proves every route in `ROUTE_PERMISSIONS` has a limit entry; an
  unknown group defaults to 60/min writes and 300/min reads.

### 2. Idempotency hardening

- Same key in parallel ⇒ one effect, second response `meta.replayed: true`, HTTP 200; same key with a
  different body ⇒ 409 `IDEMPOTENCY_CONFLICT`; still in progress after 5 s ⇒ 409
  `IDEMPOTENCY_IN_PROGRESS` with `Retry-After`.
- A crash between record reservation and handler completion leaves `IN_PROGRESS`; a sweeper (in
  reconcile) marks it `EXPIRED` after 10 min so the caller can retry with the same key.
- Real Postgres in these tests; no mocked transactions.

### 3. Outbox worker

- `src/lib/outbox/worker.ts`: claim with `FOR UPDATE SKIP LOCKED`, publish through a handler registry
  (`notification`, `kpi_snapshot`, `anchor`), mark `DELIVERED`; on failure increment attempts,
  `FAILED` with exponential backoff + jitter, **8 attempts** then `DLQ`.
- At-least-once delivery; handlers are idempotent by event id. A duplicate delivery must not create a
  duplicate `EscalationEvent` or notification.
- `POST /internal/outbox/drain` (`ops:outbox`), `GET /internal/outbox?status=`, and
  `POST /internal/outbox/:id/replay` only from `DLQ` (audited, resets attempts).
- Worker heartbeat per job; a missed heartbeat raises an alert. Metrics:
  `aic_outbox_pending{event_type}`, `aic_outbox_lag_seconds{event_type}`,
  `aic_outbox_attempts_total{event_type,result}`, `aic_outbox_dlq_total{event_type}`.

### 4. Degradation ladder

`src/lib/degradation/`:

- probes: DB (`SELECT 1`), target (`GET /target/service-status` for a probe account), LLM (failure
  rate over the last 5 min), audit (last verify result), IdP (last login failure burst);
- `computeLevel()` returns the most restrictive level; transitions write `DegradationState` +
  `DEGRADATION_CHANGED` audit + metric, with hysteresis (two consecutive probes before raising);
- `assertWritesAllowed()` is called in every mutating route; `L2`/`L3`/`L4` forbid target writes,
  `L4` forbids **all** writes, `L5` affects new logins only;
- `POST /internal/degradation` may only move to a **more** restrictive level than computed;
  `{ level: "AUTO" }` clears a forced level; raising requires the probe to recover
  (`409 DEGRADATION_RAISE_FORBIDDEN`);
- `/health` reflects the level and returns 503 at `L4` (and when DB is unreachable).

### 5. Identity and sessions

- Auth.js OIDC provider for production, credentials only when explicitly enabled outside production;
  unknown role claims are rejected, never defaulted.
- `User.sessionEpoch` is read on every privileged request; a role change or deactivation bumps it;
  stale epoch ⇒ 401 `SESSION_STALE`, inactive ⇒ 403 `USER_INACTIVE`.
- Break-glass paging hook (security channel) and 24 h `AUDITOR` task creation.

### 6. Operations and administration UI

- `/app/settings/operations` (`ops:read`: ADMIN, AUDITOR): dependencies with latency and last probe;
  outbox pending/DLQ/oldest age; anchors `lastSeq/ageSeconds/status`; unknown executions; stale cases;
  job heartbeats. Mutating controls (`drain`, `replay`, `anchor`, `verify`, `reconcile`,
  `degradation`) require a reason, show affected ids, and display the `requestId`. `AUDITOR` sees no
  controls. At `L4` the chain-break panel renders first.
- `/app/settings/access`: users, roles, last login, deactivation. Changing your own roles is 409
  `SELF_ROLE_CHANGE`; `ADMIN` + reviewer/auditor is 422 `ROLE_CONFLICT`; every change is audited and
  bumps the epoch.
- `/app/policies` and `/app/policies/[policyId]`: active version, hash, history; activation requires
  version + hash + review ticket and shows the effect on open approvals. No editor and no simulation.
- `/app/settings/approvals`: approval matrix (thresholds, required roles, window) and the break-glass
  register from `GET /admin/break-glass`; request, co-sign (different session) and revoke; persistent
  case banner when active.
- `/app/integrations` and `/app/integrations/[integrationId]`: adapter capabilities, data-contract
  registry and snapshot hashes. Operational read/write telemetry appears only for `ops:read` holders;
  other roles see contract freshness, never inferred health.
- All settings pages are hidden without permission; a direct URL renders `/forbidden` with the missing
  permission and fetches nothing.

### 7. Observability and alerting

- Pino logs with `requestId`, `traceId`, `actorType`, `actorId`, `caseRef`; redaction enforced; no
  prompt, excerpt, rationale, cookie, key or email.
- Spans per `OBSERVABILITY.md` §4; metrics per §5; `/metrics` (`service:ops`, only when
  `METRICS_ENDPOINT_ENABLED=1`).
- Zero-tolerance tripwires: `aic_unverified_write_total` and `aic_audit_chain_break_total` must be 0;
  they are alert-on-any-increment and asserted by a CI query.
- Alert rules (repo file) for each condition in `OBSERVABILITY.md` §7, each linking its
  `OPERATIONS.md` §5 runbook id.
  SLOs and error-budget burn per `OBSERVABILITY.md` §6.

### 8. Security hardening

- Security headers + CSP per `SECURITY.md` §8, verified against a running response;
  `ALLOWED_ORIGINS` enforced (empty ⇒ same-origin only).
- `npm run check:secrets-scope`: key literals only in `lib/env.ts`; target key read only by
  `lib/executor/*` and `lib/target/auth.ts`; agent/ops keys only by their boundaries.
- Session and authz tests: 401/403/`SESSION_STALE`/`USER_INACTIVE`; `AUTHZ_DENIED` exactly once.
- Dependency audit recorded in `docs/audits/deps-<date>.md`; no blind upgrades.

## Acceptance criteria

- [ ] Limiter store down ⇒ `503 RATE_LIMITER_UNAVAILABLE` for every group; no request is "allowed".
- [ ] Parallel duplicate execute ⇒ one write, one execution, `meta.replayed: true`.
- [ ] A poisoned outbox event lands in `DLQ` after 8 attempts; only an explicit replay moves it;
      a duplicate delivery creates no duplicate notification.
- [ ] `L2` blocks execution with `503 DEGRADATION_BLOCKED` while holds remain queryable; `L4` rejects
      every write and `/health` returns 503.
- [ ] Raising a forced degradation level without probe recovery is `409`; `AUTO` clears it.
- [ ] Deactivating a user invalidates the session on the next privileged request; a role change takes
      effect without a new login.
- [ ] `/app/settings/operations` shows every panel; `AUDITOR` has no controls; a drain/replay action is
      audited with a
      reason and `requestId`.
- [ ] Break-glass request → different-admin co-sign → requester execute works; self co-sign is 403/409;
      `USED` records the paging hook and auditor task.
- [ ] Policy activation supersedes open approvals and is visible on the case.
- [ ] Every alert in `OBSERVABILITY.md` §7 maps to a runbook in `OPERATIONS.md` §5; no metric label
      contains a case ref, user id or email.
- [ ] Zero-tolerance counters are 0 after the full suite.
- [ ] `npm run check:secrets-scope` fails if a key is used outside its boundary.
- [ ] Security headers present on a real response; a foreign origin is rejected.

## Verification

```bash
npm run test:failure -- outbox limiter degradation idempotency
npm run test:rbac -- sessions break-glass
npm run test:adversarial
npm run test:scenarios -- --mode=deterministic
npm run test:e2e -- ops admin break-glass
npm run check:secrets-scope
```

## Commit

`feat(ops): shared rate limits, outbox worker, degradation ladder, ops/admin consoles and alerting`

## Stop

Report per `AGENTS.md` §6. Do not start the failure and load drills.
