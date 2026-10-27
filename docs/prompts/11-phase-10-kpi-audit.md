# Phase 10 — KPI dashboard, audit surfaces and external anchoring

**Read first:** `docs/EVALUATION.md` §8, `docs/OBSERVABILITY.md` §7–§8, `docs/APP_FLOW.md` §15 and
§19, `docs/UI_UX_BRIEF.md` §5.12–§5.13, §6, §11, `docs/BACKEND_SCHEMA.md` (`AuditEvent`,
`AuditAnchor`), `docs/API.md` §6.6.
**Goal:** the value story is visible, and the audit history is provable against an external anchor.
**Depends on:** Phase 9 green.

## Scope guard

No new metrics beyond `docs/EVALUATION.md` §8. If a metric is not defined there, do not invent it —
add it to the doc first. Assumption-driven numbers must be labelled. Anchoring never mutates audit
rows; a chain break freezes writes, it does not "repair" history.

## Build

1. `src/lib/eval/kpi-service.ts`: `computeKpis({from,to})` returning the four families with
   `capturedAt`, `policyVersion`, `policyHash`, `assumptions`. Reuse `metrics.ts` — no duplicate SQL.
   `GET /kpis` per `API.md` §6.6; 60 s cache keyed by window; `refresh=1` (`kpi:refresh`) bypasses
   and writes `KpiSnapshot`.
2. `/app/analytics`: four sections (Prevention, Investigation, Recovery, Business outcome), value +
   delta + sparkline; agent-vs-baseline comparison from the two latest `ScenarioRun`s; assumptions
   popover; accessible table alternative; empty state with zero cases. Every metric links to its case
   population and filter definition.
3. `/app/analytics` **Evaluation tab** (`eval:read`: ADMIN, AUDITOR): suite banner; run control
   (`eval:run`: ADMIN only) for `mode=deterministic|agent` and `kind`; progress; history;
   per-scenario table; comparison table; links from scenario rows to cases. The tab is hidden, not
   disabled, without `eval:read`.
4. `src/lib/audit/verify-chain.ts`: recompute the hash chain over a range; return `{ ok, brokenAt? }`;
   `POST /internal/audit/verify` (`audit:verify`: ADMIN, AUDITOR) with optional
   `compareExternal: true` to fetch the anchor and compare its root.
5. `src/lib/audit/anchor.ts`: hourly job computes the Merkle root over new events and writes
   `AuditAnchor` + an immutable object to the object-lock bucket (`ANCHOR_STORE_*`), then emits
   `AUDIT_ANCHORED`. Failure retries with backoff, then raises a stale-anchor alert; it never blocks
   business writes. `POST /internal/audit/anchor` (`ops:anchor`) runs it on demand.
6. Chain-break handling: a failed `audit:verify` sets `DegradationState = L4_AUDIT_BROKEN` (freeze),
   writes `AUDIT_CHAIN_BROKEN`, and `/health` returns 503. Writes are rejected with
   `503 DEGRADATION_BLOCKED` until an `ADMIN` resolves the range and clears the level. Recovery steps
   are in `OPERATIONS.md` R-05; the UI shows the banner and the verify range.
7. `/app/audit`: filterable table (case ref, actor type, event type, date range), detail drawer with
   payload, `hash`, `prevHash`, covering anchor (`seq`, `rootHash`, `externalUri`, `verifiedAt`), and
   `chain_ok` computed by re-hashing the window. `GET /audit` and `GET /audit/:id`. Filters stay in the
   URL; payload diffs never leave the server unredacted.
8. Tamper test: disable the append-only trigger inside a rollback-only transaction, mutate one row,
   assert `brokenAt` is detected, L4 is set, and writes are rejected — then roll back. The bypass must
   refuse to run when `NODE_ENV=production` or the URL is not `_test`.
9. Retention: document the policy in `DATABASE.md`; the anchor job must not delete audit rows. A test
   asserts `audit_event` count only grows during normal operation.

## Acceptance criteria

- [ ] Every KPI on screen maps to a named function in `metrics.ts` (map constant kept in the repo).
- [ ] Business-outcome cards carry an assumption label; the popover lists every constant.
- [ ] `/app/analytics` renders with 2 seeded cases and does not divide by zero with 0 cases.
- [ ] The Evaluation tab is visible only to `eval:read` holders and keeps its state in the URL.
- [ ] The comparison table appears only when both modes have a run; otherwise it explains what is
      missing.
- [ ] `AUDITOR` can read the Evaluation tab, `/app/analytics`, `/app/audit` and run `audit:verify`;
      `ANALYST` cannot see the Evaluation tab.
- [ ] `verify-chain` reports `chain_broken` after a simulated tamper and `chain_ok` on clean data.
- [ ] A simulated tamper sets `L4`, `/health` returns 503 and every write is rejected; rollback
      restores `chain_ok`.
- [ ] The hourly anchor covers the new range, the object exists in the bucket, and
      `compareExternal` returns `externalMatches: true`.
- [ ] A deleted anchor object produces a stale-anchor alert, not a false `chain_ok`.
- [ ] `GET /audit/:id` shows the anchor that covers the event and its verification status.
- [ ] KPI numbers equal `ScenarioRun.summary` values for the same window.

## Verification

```bash
npm run test:integration -- kpis audit anchor
npm run test:e2e -- kpi-audit
npm run test:scenarios -- --mode=deterministic
npm run audit:verify -- --from 1 --to 1000
```

## Commit

`feat(metrics): KPI surfaces, audit chain verification and external anchors`

## Stop

Report per `AGENTS.md` §6. Do not start production controls.
