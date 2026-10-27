# Phase 4 — Gate, exposure, case machine and outbox

**Read first:** `docs/ARCHITECTURE.md` §4–§6 (`lib/exposure`, `lib/gate`, `lib/state-machine`,
`lib/idempotency`, `lib/outbox`), `docs/BACKEND_SCHEMA.md` §7, `docs/API.md` §5–§6.4,
`docs/RBAC.md` §3–§4.
**Goal:** an exposed outbound action is genuinely stopped, every mutation is idempotent, and every
state change has one owner and one audit row.
**Depends on:** Phase 3 green.

## Scope guard

No investigation, no policy thresholds, no execution. `ALLOW` returns a decision but performs no
target write yet — the executor does not exist. Return `execution: null` and
`pendingExecutor: true`; Phase 7 replaces that flag with a real execution. Build the RBAC skeleton
(permission catalogue, route table, `requirePermission`) here because routes already exist; quorum
and SoD belong to Phase 6.

## Build

1. `src/lib/state-machine/case.ts`:
   - `TRANSITIONS: Record<CaseStatus, CaseStatus[]>` matching `ARCHITECTURE.md` §5 exactly, including
     `APPROVED → AWAITING_APPROVAL` (approval invalidation) and `CLOSED_RESOLVED → REOPENED`;
   - `transition(caseId, to, actor, meta)` validates, updates `status`/`lastTransitionAt`, increments
     `reopenCount` on `REOPENED`, writes one `CASE_TRANSITION` audit row, all in one transaction;
   - illegal transition throws `InvalidTransitionError` (409) and writes nothing.
2. `src/lib/exposure/compute.ts`: `computeExposure(event)` returns `{ actions, accountIds, reasons[] }`
   using field overlap, account overlap, the policy exposure window (default 24 h) and action-state
   rules. `PENDING` is always included; `EXECUTED` only when a `RestorePoint` exists.
3. `src/lib/gate/decide.ts`:
   ```
   decide(action, { openEvents, policyConfig }) →
     BLOCK  if the payload is malformed or targets an account not in the registry
     HOLD   if any linked OPEN integrity event overlaps the action
     ALLOW  otherwise
   ```
   Deterministic; no clock read beyond the passed context. Returns `{ decision, reasons[], caseId? }`.
4. `src/lib/idempotency/`:
   - `withIdempotency(req, actor, fn)` reserves `(route, actorKey, key)` in `IdempotencyRecord` with
     `IN_PROGRESS` before work; replays the stored envelope when the body hash matches; returns 409
     `IDEMPOTENCY_CONFLICT` on a different body; returns 409 `IDEMPOTENCY_IN_PROGRESS` when a
     concurrent duplicate is still running after 5 s;
   - a missing key is 400 `IDEMPOTENCY_KEY_REQUIRED`. No route may implement its own dedupe.
5. `src/lib/rbac.ts` (skeleton):
   - `PERMISSIONS` catalogue from `RBAC.md` §3; `ROLES`; `ROLE_PERMISSIONS` for the roles used in
     this phase; `ROUTE_PERMISSIONS` literal list with method, pattern and permission;
   - `requirePermission(sessionOrService, permission)`; `assertRouteCoverage()` compares the table to
     `src/app/api/**/route.ts` at boot and fails on a missing or extra entry;
   - `ADMIN` holds no business permission; service principals hold only service permissions.
6. `src/lib/outbox/enqueue.ts`: `enqueue(tx, event)` writes an `OutboxEvent` inside the caller's
   transaction. Ingest, case opening and hold placement each enqueue one event. No publisher yet.
7. `src/lib/gate/ingest.ts`: one transaction —
   `OutboundAction` (idempotency key, `gateDecision`) → exposure → optional `Case` (ref `AIC-0001`
   from a sequence) → `CaseExposedAccount` rows → `ActionHold` → linked
   `IntegrityEvent.status = LINKED` → `AuditEvent` → `OutboxEvent`.
   `gateDecision` is written once and never recomputed for that action. Replay returns the stored
   response with `meta.replayed: true`.
8. Routes: `POST /actions/ingest` (`service:ingest`, `Idempotency-Key`, rate limit 120/min per
   agent key + account), `GET /actions` and `GET /actions/:id` (`action:read`), `GET /cases`,
   `GET /cases/:ref` (`case:read`). `GET /actions/:id` is a read projection for `/app/actions/[actionId]`:
   action, gate decision and reasons, hold, exposure summary, restore point when present, and the
   linked `caseRef` if one exists. It has no mutation counterpart.
9. `GET /cases/:ref` returns the projection in `API.md` §6.4 with empty arrays for
   investigation/policy/approval/execution at this phase; include `degradationLevel: "L0_NORMAL"`.
10. Tests: exposure matrix (field overlap, window edges, executed-with/without restore point); gate
    truth table; every legal and illegal transition; concurrent double-ingest with one key yields one
    hold and one case; route coverage fails on an unlisted route; idempotency replay/conflict.

## Acceptance criteria

- [ ] A revoke for an account covered by the open `SEMANTIC` event returns `HOLD` with a `caseRef`,
      creates one `ActionHold`, and writes case-opened and hold-placed audit events.
- [ ] The same submission twice creates no second action, case, hold or outbox event; second response
      has `meta.replayed: true`.
- [ ] Concurrent submissions with one key produce one hold and one outbox event.
- [ ] Same key with a different body returns 409 `IDEMPOTENCY_CONFLICT` and changes nothing.
- [ ] A submission unrelated to any open event returns `ALLOW`, opens no case and writes no target row.
- [ ] Every illegal transition returns `409 INVALID_TRANSITION`, leaves the row unchanged and writes
      no audit row.
- [ ] `REOPENED` increments `reopenCount`; the transition is impossible from any state but
      `CLOSED_RESOLVED`.
- [ ] `ROUTE_PERMISSIONS` covers every route; adding a route without an entry fails startup.
- [ ] `ADMIN` receives 403 on ingest and case mutation endpoints; service key receives 403 on console
      reads.

## Verification

```bash
npm run test:unit -- state-machine gate exposure idempotency
npm run test:integration -- ingest rbac-routes
npm run test:scenarios -- --scenario=A --upto=ingest
```

## Commit

`feat(control): deterministic gate, exposure, case state machine, idempotency and outbox`

## Stop

Report per `AGENTS.md` §6. Do not add the investigator or any target write.
