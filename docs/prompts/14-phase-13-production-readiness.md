# Phase 13 — Deploy, demo and readiness verdict

**Read first:** `PRODUCTION_READINESS.md` (all), `OPERATIONS.md` §7–§11, `SECURITY.md` §11,
`docs/audits/SUMMARY.md`, `README.md`. You will write `docs/DEMO_SCRIPT.md` in this phase.
**Goal:** a repeatable walkthrough that survives a fresh machine, and an honest D2 verdict backed by
artifacts.
**Depends on:** Phase 12 green: zero open CRITICAL/HIGH and D1 complete.

## Scope guard

- No new product capability, no schema change, no relaxation of a control.
- Demo scripts drive the system **through HTTP only**; the single exception is `demo:reset`, which
  truncates and reseeds a demo database.
- No demo shortcut may bypass the gate, quorum, separation of duties or the verifier. If a step needs a
  bypass to look good, the step is wrong.
- Do not push to any remote. Tag locally only.
- Do not claim **D3 — production-approved**. D3 requires the sign-off matrix and is out of scope.

## Build

### 1. Deploy topology

- Web service (Next.js) and worker service (outbox, anchors, reconcile, probes) from the same image;
  managed Postgres 16; Redis; object-lock bucket for anchors; OIDC client; OTLP collector.
- Run `npx prisma migrate deploy` against the direct URL **before** promoting the app; deploy the app;
  deploy the worker; confirm both `/health` and the worker heartbeat.
- Set every production env var from `TRD.md` §5. Production refuses credentials auth, in-memory
  limiter, missing OIDC and disabled telemetry.
- Document the manual deploy checklist in `README.md`: migrate → app → worker → `/health` →
  `/ops/status` → smoke → rotate demo credentials.

### 2. Demo reset

`npm run demo:reset`:

- prints host/database, requires `ALLOW_DEMO_RESET=1`, refuses hosts outside `DEMO_DB_HOSTS`;
- truncates only documented tables in FK-safe order (`TRUNCATE … RESTART IDENTITY CASCADE`), never
  `DROP`; reseeds with `SEED=20261026`; re-anchors the seeded ledger;
- prints a **state fingerprint** (counts + target-state hash). Two runs print identical fingerprints;
  any mismatch exits 1.

### 3. Demo scenarios

`npm run demo:scenario -- A|B|C|D|E`, mapping to the fixtures:

- A: `analyst` investigates; `reviewer` approves `BLOCK`; `reviewer2` completes the block (no target
  write, no execution row); verification reads `ACTIVE`; closes verified;
- B: risk ≥ 70; `reviewer` + `senior` approve; `reviewer2` executes the restore; verify `ENABLED`;
- D: same approvals; verification fails; case `REOPENED`; recovery not counted;
- C: stops at the human boundary, prints the required evidence request and escalation;
- E: `SAFE_REFUSAL`, evidence packet, zero executions.

Each step uses a fresh `Idempotency-Key`, polls to a stable state with a bounded timeout, asserts the
documented outcome, prints case ref, console URL, gate decision, disposition, execution status and
verification, and names the first divergence on failure.

### 4. `docs/DEMO_SCRIPT.md`

Write the timed script, 10 minutes, with narration, exact route, expected on-screen values and a
fallback line per beat:

| Time | Beat | Shows |
|---|---|---|
| 0:00 | Hook | a held SSO revoke in `/actions` |
| 1:00 | Prevention (A) | drift vs schema, hold, evidence, quorum, block, verified no-write |
| 3:30 | Two-person control | `reviewer` approves; `reviewer2` executes; SoD explained |
| 5:00 | Compensation (B) | high-risk quorum, restore point, restore, verified state |
| 7:00 | Conflict (C) + refusal (E) | the system refuses to guess or act out of scope |
| 8:30 | Evidence | Evaluation tab in `/app/analytics`, KPI families, `/app/audit` anchor, `/app/settings/operations` health |
| 9:40 | Honest gaps | `SECURITY.md` §11, readiness verdict D2 |

### 5. Smoke

`npm run smoke -- --base-url=<url>` asserts, in order:

1. `/health` `status: ok`, `degradation: L0_NORMAL`, commit matches the deployed SHA, `policyHash`
   matches the active version.
2. `/ops/status` reachable with the ops key; outbox DLQ 0; anchor age within interval.
3. Seed counts within the expected range; exactly one `ACTIVE` policy version.
4. Ingest returns `HOLD` with a case ref; one open hold; no execution.
5. Quorum negative: one approval leaves the case `AWAITING_APPROVAL`; a second distinct approver is
   required before execute.
6. `reviewer` login works; `/app/analytics` returns all four families; `audit:verify` returns
   `chain_ok`.

Exit 1 at the first failure with the assertion printed.

### 6. Readiness

- `npm run readiness -- --level D2 --commit <sha>` collects: D1 artifacts, deploy topology check,
  migrations applied, worker heartbeat, anchor verification, smoke output, SLO dashboards, alert
  routing test, backup schedule, restore drill reference, audit summary.
- It writes a report with a verdict: **D2 — production-capable** or **not ready**, plus the exact
  missing items. It never infers a manual item and exits non-zero on any gap.
- The README and demo script state D2 only. D3 (production-approved) is explicitly pending the
  sign-off matrix.

### 7. Release

- Tag `v0.2.0-prod-demo` locally; confirm `git status` clean; no `.env*`, key or credential tracked;
  nothing pushed.
- Record the clean-clone duration, rehearsal duration, smoke result, D2 report path and final audit
  severity counts in the phase report.

## Acceptance criteria

- [ ] `demo:reset` twice produces identical fingerprints and refuses a non-demo host or missing flag.
- [ ] `demo:scenario -- A|B|C|D|E` each ends in the expected state with exit 0.
- [ ] Scenario A completes with two different users; the approver is refused execution; zero target
      writes; verification passes.
- [ ] Scenario B requires two approvals including a senior; the executor is a third person.
- [ ] The full A→E sequence runs on a fresh clone with no manual SQL.
- [ ] The headless demo uses only `/api/auth/*` and `/api/v1/*`; SQL only for read-only assertions.
- [ ] `npm run smoke` passes against the deployed URL, including the quorum negative.
- [ ] Clone → running demo under 15 minutes; rehearsal under 10 minutes, timed.
- [ ] `DEMO_SCRIPT.md` has a fallback line for every beat and links the recording.
- [ ] `readiness --level D2` exits 0 with a complete artifact set; the report says
      **production-capable** and lists every known gap with an owner.
- [ ] No document claims D3; no CRITICAL/HIGH audit item is unexplained.
- [ ] Production runs with OIDC, Redis, object-lock anchors and OTLP; credentials, in-memory limiter
      and disabled telemetry are refused at boot.
- [ ] Tag exists locally; nothing pushed.

## Verification

```bash
git clone <repo> /tmp/aic-clean && cd /tmp/aic-clean
cp .env.example .env && docker compose up -d db redis && npm install
npx prisma migrate deploy && npm run seed
npm run demo:reset && npm run demo:reset
npm run demo:scenario -- A && npm run demo:scenario -- B
npm run test:scenarios -- --mode=deterministic && npm run test:e2e -- demo
npm run smoke -- --base-url=http://localhost:3000
npm run readiness -- --level D2 --commit "$(git rev-parse HEAD)"
```

## Commit

`chore(release): production deploy, two-person demo, smoke checks and D2 readiness report`

## Stop

Report per `AGENTS.md` §6 with: clean-clone duration, rehearsal duration, smoke result, D2 verdict and
artifact path, and the final audit severity counts. The project is complete only when every box in
`PRD.md` §10 is backed by a command or an artifact referenced from `DEMO_SCRIPT.md`.
