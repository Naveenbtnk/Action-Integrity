# Phase 12 — Failure, load and DR drills, plus read-only audits

**Read first:** `docs/FAILURE_MODES.md` §3–§4 and §6–§8, `docs/OPERATIONS.md` §7–§11,
`docs/PRODUCTION_READINESS.md` §3–§4, `docs/SECURITY.md` §11.
**Goal:** evidence that the failure posture is real, not aspirational — and that the system is
production-capable at D1.
**Depends on:** Phase 11 green.

## Scope guard

- **No new product features.** If a drill exposes a missing capability, stop and report it; the fix is
  a separate approved task.
- **No weakening of a control to make a drill pass.** Auth, RBAC, quorum, SoD, the gate, the verifier,
  append-only rules and the determinism boundary stay exactly as specified.
- Schema changes only when a drill proves a constraint or index is required; add the ADR line first.
- Audits are read-only. Do not fix findings in this phase.

## Build

### 1. Failure-mode drill matrix

Implement an automated test or a scripted drill for **every** id `F-01…F-26` in
`docs/FAILURE_MODES.md` §3. Do not invent ids and do not skip one because it is hard. At minimum:

| Group | Injected condition | Required behaviour |
|---|---|---|
| DB | unavailable, `statement_timeout`, ambiguous commit | 503 `DEPENDENCY_UNAVAILABLE`; no partial rows; no gate decision persisted |
| Target | down, timeout, lost response after commit, 200-but-no-op | `FAILED`/`UNKNOWN` per `FAILURE_MODES.md`; one call; verification resolves |
| LLM | 429 then success, outage, schema violation, injected content | retry once, then fallback; report flagged; action still held; injection never obeyed |
| Delivery | duplicate ingest, duplicate execute, outbox redelivery | one hold, one write, one notification; replays marked |
| Crash | kill between intent and call, between call and result commit | reconcile marks `UNKNOWN`; verify resolves; no blind retry |
| Approval | stale evidence, expiry, policy swap, quorum loss | execute 409 with the specific code; no write |
| Audit | tampered row, anchor outage, missing anchor object | L4 + write freeze on break; stale-anchor alert on outage |
| Limiter | Redis down | 503 fail-closed; no bypass |
| Identity | key rotation, deactivated user, clock skew | old key rejected, session invalidated, expiry evaluated on server time |
| SLA | evidence deadline passes | `EXPIRED` + `ESCALATED` from reconcile, never a UI timer |

Each drill records `{ id, injected, observed, passed, artifactPath, commitSha, startedAt }`. A failure
mode without evidence is a readiness failure, not a "known gap".

### 2. Load

- k6 (or equivalent) profile: ingest + gate at 20 rps for 10 min, case reads at 50 rps, execute at
  1 rps with valid approvals; realistic seeded data.
- Record p50/p95/p99 and error rate; assert gate p95 < 400 ms, case page p95 < 1.5 s, error rate
  < 1% at the documented load. Store the run as `ScenarioRun(kind = LOAD)` with the summary.
- Soak 30 min at 50% load: no memory growth beyond 10%, no outbox backlog growth, no connection leak.

### 3. Chaos

- Kill the worker mid-drain; kill the API during an execution; restart Redis; restart Postgres.
- Assert: no duplicate target write, no unverified closure, outbox resumes, cases converge to a
  documented state after reconciliation, alarms fire.

### 4. DR

- PITR restore into a scratch database; run `audit:verify` against the restored ledger and compare
  the latest anchor.
- Measure and record **RPO ≤ 5 min** and **RTO ≤ 60 min** on the reference environment. A restore
  that loses an anchored segment fails the drill.
- Verify `demo:reset` is **not** reachable in the production environment (guard test).

### 5. Read-only audits

Run the three prompts in `docs/prompts/audits/` in order, then commit the reports with dates. Every
finding needs evidence, severity, location and a failure chain; label `CONFIRMED` vs `UNVERIFIED`.
**Do not fix during the audit.**

1. `audits/01-failure-and-deployment-consistency.md`
2. `audits/02-security-and-data-exposure.md`
3. `audits/03-resource-leak-and-dead-code.md`

Produce `docs/audits/SUMMARY.md`: CRITICAL/HIGH/MEDIUM/LOW, each classified `MISSING`, `BROKEN`,
`MISCONFIGURED` or `UNVERIFIED`. CRITICAL and HIGH must be closed before Phase 13; deferred items go
to `SECURITY.md` §11 with an honest mitigation.

### 6. Readiness D1

Run `npm run readiness -- --level D1 --commit <sha>`. It must emit the artifact set defined in
`PRODUCTION_READINESS.md`: functional suite, adversarial suite, failure drills, load summary, chaos
summary, DR timings, audit summary, zero-tolerance counters at 0. A missing artifact exits non-zero;
manual items are never inferred.

## Acceptance criteria

- [ ] Every `F-01…F-26` has an artifact and a pass/fail result; none is absent or "manual later".
- [ ] No drill produces an unverified write, a duplicate target write, or a second execution row.
- [ ] Lost-response and crash-window drills end in `UNKNOWN`, resolved only by verification.
- [ ] Gate p95 < 400 ms, case page p95 < 1.5 s at the documented load; error rate < 1%.
- [ ] 30-minute soak shows no leak, no backlog growth, no idle-in-transaction.
- [ ] Chaos kill/restart converges without manual SQL; alarms fire for each injected condition.
- [ ] PITR restore meets RPO ≤ 5 min / RTO ≤ 60 min; audit chain and latest anchor verify.
- [ ] Three audit reports exist with evidence; `SUMMARY.md` lists zero open CRITICAL/HIGH.
- [ ] `readiness --level D1` exits 0 with a complete artifact set.
- [ ] `demo:reset` is unreachable in production (guard test).

## Verification

```bash
npm run test:failure -- --all
npm run test:load
npm run drill:restore
npm run test:scenarios -- --mode=deterministic
npm run test:adversarial
npm run audit:verify
npm run readiness -- --level D1 --commit "$(git rev-parse HEAD)"
```

Paste the drill pass count, load percentiles, RPO/RTO and `SUMMARY.md` severity counts into the phase
report.

## Commit

`chore(hardening): failure drills, load and chaos evidence, DR timings and audit reports`

## Stop

Report per `AGENTS.md` §6. Do not deploy and do not fix audit findings here. Phase 13 starts only with
`SUMMARY.md` showing zero open CRITICAL/HIGH and D1 green.
