# IMPLEMENTATION PLAN

Fourteen phases (0–13). Each phase ends in a working, committed, verifiable state. Never start a
phase before its predecessor's *Done criteria* pass — the dependency chain is real, not stylistic.

**Ordering rationale:** data before systems, systems before detection, detection before control,
control before reasoning, reasoning before execution, execution before UI, measurement before
production controls, controls before failure drills, drills before a readiness verdict, verdict
before a demo claim.

---

## Phase 0 — Foundation and guardrails

**Goal:** a deployable skeleton where bad code cannot merge.
**Read:** `TRD.md` §2–§4, `CODE_STYLE.md` §1–§4.
**Build:** Next.js 15 + TS strict + Tailwind v4; shadcn/ui on the Base UI base; the canonical
`UI_UX_BRIEF.md` §7 tokens (dark only, Archivo/Space Mono, 4 px); application shell with a
permission-filtered rail and top bar; Storybook workbench; ESLint (including `no-console` and import
boundaries) and Prettier; `lint-staged`; Prisma init; `lib/env.ts` (Zod, fail-fast on missing
production vars); `lib/errors.ts`; `lib/db.ts`; `lib/observability/` (Pino + OTel bootstrap, no-op when
unconfigured); `GET /api/v1/health` with `status/db/mode/degradation/policyHash/commit`; CI
(typecheck → lint → unit → build); `AGENTS.md` wired.
**Done:** `npm run dev` serves the shell with the dark steel-blueprint theme; `/health` returns `ok`;
CI green; a missing `DATABASE_URL` crashes startup with a readable message; `console.log` fails lint; a
route without `withRoute` fails the envelope test; Mantine and daisyUI are absent.
**Verify:** `npm run typecheck && npm run lint && npm run test:unit && npm run build`.
**If skipped:** every later phase inherits silent config failures and style drift.

## Phase 1 — Data foundation

**Goal:** the full production schema is real, migrated and seeded.
**Read:** `BACKEND_SCHEMA.md`, `DATABASE.md` §2–§4.
**Build:** every model, enum and constraint from `BACKEND_SCHEMA.md` — including `Approval` binding
fields, `PolicyVersion`, `BreakGlassElevation`, `OutboxEvent`, `IdempotencyRecord`, `AuditAnchor`,
`JobHeartbeat`, `DegradationState`; partial unique index on `PolicyVersion` where `status = 'ACTIVE'`;
append-only triggers on `AuditEvent`, `InvestigationReport`, `VerificationResult`, `AuditAnchor`;
the `ADMIN` + reviewer/auditor check on `User.roles`; deterministic seed (`SEED=20261026`) with
5,000 accounts, ~12,000 entitlements, 40 actions, **7 users**, 2 policy versions and one baseline
anchor.
**Done:** `prisma migrate deploy` on a clean DB succeeds; seed runs twice without duplicating rows;
an `AuditEvent` update throws at both Prisma and Postgres layers; a second `ACTIVE` policy version is
rejected by the database; an `ADMIN`+`SENIOR_REVIEWER` user insert is rejected.
**Verify:** `npm run seed && npm run seed`, `npm run test:db -- immutability policy user-roles`.
**If skipped:** later phases invent ad-hoc tables and every control becomes advisory.

## Phase 2 — Synthetic enterprise systems

**Goal:** five read-only sources and one writable target that behave like real systems.
**Read:** `ARCHITECTURE.md` §3, `API.md` §6.9.
**Build:** `SourceAdapter`/`TargetAdapter`; `/api/v1/sources/*` and `/api/v1/target/*` with
`x-target-key`; `lib/target/service.ts` as the only `tgt_*` writer; before-state into `tgt_audit`;
idempotent writes; `getEntitlement`, `getServiceStatus`, `applyChange`, `restoreFromSnapshot`;
adapter timeouts, a `slow` and an `after-commit` mode behind non-production test hooks for failure tests.
**Done:** a curl script reads each source, applies a change, re-reads it, and replays the same
idempotency key without a second write; `after-commit` returns `UNKNOWN` while the row is committed;
no module outside `lib/target/service.ts` can write `tgt_*`.
**Verify:** `npm run test:integration -- adapters target`.
**If skipped:** the verifier has nothing real to verify and the demo simulates a simulation.

## Phase 3 — Integrity engine

**Goal:** detect a failure that schema validation alone misses.
**Read:** `PRD.md` §7, `ARCHITECTURE.md` §4.
**Build:** `lib/integrity/*` pure checks (schema hash, enum, semantic/alias, freshness, cross-source
invariant); `SourceSnapshot` capture; `IntegrityEvent` with fingerprint dedupe;
`POST /integrity/evaluate`; seeded contracts including `billing.plan_status`; one injected
instruction inside a support ticket for the security fixture.
**Done:** a source emitting `CURRENT` that the contract neither declares nor aliases emits exactly one
`SEMANTIC` event; a second run creates nothing; fresh, semantically unchanged data emits nothing; the
injected text is stored as evidence, never interpreted.
**Verify:** `npm run test:unit -- integrity` + `npm run test:integration -- evaluate`.
**If skipped:** there is no trigger for the product.

## Phase 4 — Gate, exposure, cases and transitions

**Goal:** an exposed action is actually stopped, with one transition owner.
**Read:** `ARCHITECTURE.md` §5–§6, `API.md` §6.2–6.3.
**Build:** `computeExposure`; `decide` gate; transactional ingest creating action + case + exposed
accounts + hold + audit + outbox event; `POST /actions/ingest`; the 16-state machine in
`lib/state-machine/case.ts` with the full illegal-transition matrix; `GET /cases`,
`GET /cases/:ref`; deterministic degradation check at ingest (holds still served at `L2`).
**Done:** Scenario A's first three steps pass; duplicate ingest with the same key returns the original
response and creates no second hold; concurrent double-ingest produces one hold; an illegal transition
returns `409 INVALID_TRANSITION` and writes no audit row.
**Verify:** `npm run test:unit -- state-machine && npm run test:scenarios -- --scenario=A --upto=ingest`.
**If skipped:** the product is an observability tool with extra steps.

## Phase 5 — Investigator

**Goal:** adaptive, cited investigation — and a deterministic twin for comparison.
**Read:** `ARCHITECTURE.md` §8, `SECURITY.md` §6.
**Build:** `LlmClient` + Gemini implementation behind a provider interface; investigator prompt with
evidence-block wrapping and injection rules; read-only tool allowlist; Zod schema for
`InvestigationReport`; citation validator (record must exist); cache by
`(caseId, evidenceHash, promptVersion, mode)`; one repair retry; `lib/agent/fallback.ts`;
`POST /cases/:ref/investigate`; `L1_LLM_DEGRADED` path.
**Done:** Scenario A yields ≥2 hypotheses citing `CONTRACT_RECORD` and `BILLING_RECORD`; an uncited
claim cannot exceed confidence 0.5; with the key disabled a persisted fallback report is produced and
the case stays held; the injection fixture is flagged in `suspiciousContent`, never obeyed; no prompt
or excerpt appears in logs.
**Verify:** `npm run test:unit -- agent` + one manual live run with a recorded trace.
**If skipped:** the "agentic" claim is unsupported and the baseline comparison is meaningless.

## Phase 6 — Policy, RBAC, quorum and separation of duties

**Goal:** one deterministic decision, and enough *different* accountable people to authorise it.
**Read:** `RBAC.md` (normative), `ARCHITECTURE.md` §6, `API.md` §6.4.
**Build:** `config/policy/<version>.json` + `PolicyVersion` activation with hash verification;
`lib/policy/evaluate` producing risk, disposition, `requiredApprovals`, `requiredRoles`,
`approvalExpiresAt`, `policyHash`, `evidenceHash`; `lib/rbac.ts` with `ROLES`, `ROLE_PERMISSIONS`,
`ROUTE_PERMISSIONS`, `requirePermission`, `assertRouteCoverage`; `lib/approval` with binding,
invalidation, rejection, expiry, `assertQuorum`, `assertSeparationOfDuties`;
`POST /cases/:ref/policy`, `/approve`, `/evidence`, `/evidence-requests`, `/escalate`;
break-glass endpoints and lifecycle; `AUTHZ_DENIED` audit.
**Done:** completeness < 0.8 cannot approve a write (`422`); `risk ≥ 70` needs two approvals, one
`SENIOR_REVIEWER`, and one approval leaves the case `AWAITING_APPROVAL`; duplicate approver is `409
DUPLICATE_APPROVER`; approver executing is `409 APPROVER_CANNOT_EXECUTE`; `ADMIN` approve is `403`;
new evidence or a policy activation supersedes approvals and returns the case to `AWAITING_APPROVAL`;
every role × route matches `RBAC.md`; break-glass self co-sign is rejected.
**Verify:** `npm run test:rbac && npm run test:integration -- approval`.
**If skipped:** execution has no legitimate authorization path, and the separation-of-duties claim is
false.

## Phase 7 — Executor, verifier and reconciliation

**Goal:** the only module that writes, at most once, plus proof the business state changed.
**Read:** `ARCHITECTURE.md` §3 and §7, `FAILURE_MODES.md` §2–§5.
**Build:** intent → single target call → result commit; restore-point capture; `execute` for release,
`RESTORE_LAST_KNOWN_GOOD` and block-with-no-write; precondition re-check (quorum, roles, expiry,
evidence hash, policy hash, disposition, SoD, break-glass); `UNKNOWN` on timeout/lost response;
`verify` comparing declared fields and resolving `UNKNOWN`; `POST /cases/:ref/execute`, `/verify`,
`/reopen`; outbox producer for notifications; `POST /internal/reconcile` and job heartbeat.
**Done:** Scenario B closes only after a passing verification; Scenario D is `REOPENED` with
`passed=false` and does not increment recovery; lost response yields `UNKNOWN`, never a retry, and
verification resolves it; compensation without a restore point is `SAFE_REFUSAL`; parallel executes
with one key produce one write; quota/SoD failures write no target row.
**Verify:** `npm run test:failure -- execute verify reconcile && npm run test:scenarios -- --scenario=B,D,E`.
**If skipped:** the loop has no closure, which is the product.

## Phase 8 — Console UI

**Goal:** an operator can drive the loop without curl, and can see why they cannot act.
**Read:** `APP_FLOW.md` (all), `UI_UX_BRIEF.md` (all).
**Build:** public `/` and `/trust`; sign-in `SignInPanel` (SSO; dev-only credentials; generic failure,
rate-limit and limiter-outage states; same-origin `next`; no sign-up route); application shell with the Monitor /
Investigate / Resolve / Control / Improve / Administration rail; Overview; Action Queue and action
detail; Investigations queue and the three-zone workspace with Summary, Evidence, Impact, Hypotheses,
Collaboration and Decision record; `DecisionPacket`; `ApprovalRail` (`QuorumSummary`,
`ApprovalDecisionSheet`, `SoDExplainer`); Recoveries and recovery run; Verification queue;
`ExecutionConfirmation`; `UnknownExecutionBanner`; `DegradationBanner`; `ErrorEnvelopeBanner` with the
next action; `PolicyChip`; read-only Policies; all loading/empty/error/partial/stale states;
permission-filtered navigation; `/forbidden`.
**Done:** the full Scenario A journey is completable by two different users (approve, then execute);
keyboard-only approval works; `VIEWER` sees no mutating controls; `ADMIN` sees no approve/execute;
session expiry mid-approval returns to the case with the rationale restored once; `UNKNOWN` is never
styled as success.
**Verify:** `npm run test:e2e -- case-loop quorum sod` + a manual screen-reader pass on the approval
sheet.
**If skipped:** the demo cannot be shown to a non-technical evaluator, and the controls look like
documentation.

## Phase 9 — Evaluation harness

**Goal:** the claim becomes a number, and the controls are attacked on purpose.
**Read:** `EVALUATION.md` §3–§7.
**Build:** 13 functional fixtures (A–L + `X-injection`) with persona-based steps; adversarial fixtures
`X2`–`X8`; seed-from-fixture layer; runner with per-scenario isolation, outbox drain and assertions;
`lib/eval/metrics.ts`; `ScenarioRun`/`ScenarioResult` persistence; `POST /eval/runs`,
`GET /eval/runs[/:id]`; `npm run test:scenarios`, `npm run test:adversarial`; CI gate.
**Done:** 13/13 pass in `DETERMINISTIC`; agent mode completes; suite < 120 s deterministic and < 8 min
agent; F and H pass; K stays `AWAITING_APPROVAL` after one approval and closes after two; X3/X5 return
`EVIDENCE_CHANGED`/`POLICY_STALE` with no write; metrics match hand-computed values for one fixture;
suite frozen at `v1`.
**Verify:** `npm run test:scenarios -- --mode=deterministic`, `--mode=agent`, `npm run test:adversarial`.
**If skipped:** no success criterion in `PRD.md` §10 is demonstrable and the readiness gate has no
evidence.

## Phase 10 — KPIs and audit surfaces

**Goal:** the value story is visible and the history is provable.
**Read:** `OBSERVABILITY.md` §8, `API.md` §6.6.
**Build:** `/app/analytics` with four metric families and assumption popovers; comparison table;
`/app/audit` search and single-event chain proof; hourly anchor job + `AuditAnchor`;
`POST /internal/audit/anchor` and `/verify`; `audit:verify` CLI; `chain_broken` freezes writes (`L4`).
**Done:** every KPI on screen traces to a query in `lib/eval/metrics.ts`; assumption-driven numbers
carry a label; tampering with an `AuditEvent` is detected and flips health to `failing`; restoring a
backup with a missing anchor segment is detected; `/audit/:id` shows the anchor that covers it.
**Verify:** `npm run test:integration -- kpis audit anchor && npm run audit:verify`.
**If skipped:** the demo is a workflow demo, not an outcome demo, and "auditable" is a claim.

## Phase 11 — Production controls and operations

**Goal:** the controls are enforced under real infrastructure, and an operator can see the system.
**Read:** `OBSERVABILITY.md`, `OPERATIONS.md` §2–§6, `API.md` §4–§5.
**Build:** shared fail-closed rate limiter (Redis) for every group; idempotency store with concurrency
semantics; outbox worker with `FOR UPDATE SKIP LOCKED`, backoff, DLQ, explicit replay; degradation
ladder detector plus forced-level endpoint; `/app/settings/operations`, `/app/settings/access`,
`/app/settings/approvals` and `/app/integrations` (users, policy activation, break-glass);
Pino/OTel spans, metrics and redaction; `/metrics`; alert rules and runbook links; policy activation
suppression of approvals; session epoch invalidation.
**Done:** limiter store down ⇒ `503 RATE_LIMITER_UNAVAILABLE`, never "allowed"; a poisoned outbox
event lands in DLQ after 8 attempts and only replays explicitly; `L2` blocks execution while holds
remain; `L4` rejects every write and `/health` returns 503; deactivating a user invalidates the
session on the next privileged call; every alert in `OBSERVABILITY.md` §7 maps to a runbook that exists;
no metric label contains a case ref or email.
**Verify:** `npm run test:failure -- outbox limiter degradation && npm run test:e2e -- ops rbac`.
**If skipped:** the system is production-shaped on paper and fragile in practice.

## Phase 12 — Failure, load and DR drills, audits and D1

**Goal:** evidence that the failure posture is real, not aspirational.
**Read:** `FAILURE_MODES.md` §3–§4 and §6–§8, `PRODUCTION_READINESS.md` §3–§4.
**Build:** automated drills for F-01…F-26 (target down, target lost response, DB fail/ambiguous commit,
LLM 429/outage/schema violation, duplicate delivery, double execute, crash windows, replay, stale
approval, chain break, anchor outage, DLQ, limiter down, key rotation, SLA expiry, verification read
failure, clock skew, deactivated user); k6 load profile for ingest/gate and case reads; PITR restore
drill; chaos run recorded as `ScenarioRun(kind=CHAOS|LOAD|DR)`; the three read-only audits and
`docs/audits/SUMMARY.md`.
**Done:** every failure drill fails closed or degrades to the documented level; gate p95 < 400 ms and
case page p95 < 1.5 s at the documented load; no drill produces an unverified write or a second target
write; restore drill meets RPO ≤ 5 min and RTO ≤ 60 min on the reference environment; all results are
artifacts with commit SHA; zero open CRITICAL/HIGH audit findings; `readiness --level D1` exits 0.
**Verify:** `npm run test:failure -- --all && npm run test:load && npm run drill:restore` then
`npm run readiness -- --level D1 --commit <sha>`.
**If skipped:** the readiness gate cannot be passed honestly, and the first real incident is the test.

## Phase 13 — Deploy, demo and readiness verdict

**Goal:** a repeatable walkthrough and an honest production verdict.
**Read:** `PRODUCTION_READINESS.md`, `OPERATIONS.md` §7–§11.
**Build:** web + worker deploy (Vercel/Fly/Render per `TRD.md`), managed Postgres, Redis, object-lock
anchor bucket, OIDC client, OTLP collector; `npm run demo:reset`, `npm run demo:scenario -- A|B|C|D|E`;
`docs/DEMO_SCRIPT.md`; `npm run readiness -- --level D2 --commit <sha>`; readiness report committed
with artifacts; known-gaps sheet; seeded credentials removed from production docs.
**Done:** clean environment goes clone → demo in < 15 minutes; A–E run without DB edits; reset returns
the same fingerprint; **D2** artifacts exist and the report says "production-capable"; no document
claims "production-approved" without the D3 sign-offs; every known gap has an owner.
**Verify:** full rehearsal on a fresh deploy + `npm run readiness -- --level D2`.
**If skipped:** the pitch depends on the author's laptop and the production claim is unsupported.

---

## Dependency graph

```
0 ─▶ 1 ─▶ 2 ─▶ 3 ─▶ 4 ─▶ 5 ─▶ 6 ─▶ 7 ─▶ 8
                              │           │
                              └─▶ 9 ─────▶ 10 ─▶ 11 ─▶ 12 ─▶ 13
```

Phases 5 and 9 can overlap once 4 is stable. Phase 8 can start against fixture data after 6, but must
not ship before 7 is green. Phase 9 and 10 can overlap; 11 depends on both. Phase 12 cannot start
before 11. Phase 13 is the only phase allowed to make an external production claim.

## Phase gates (all must hold at the end of the phase)

| Gate | Phases | Check |
|---|---|---|
| `typecheck` + `lint` + `test:unit` | every phase | zero errors |
| `test:rbac` | 6, 8, 11 | matrix, quorum, SoD, break-glass |
| `test:failure` | 7, 11, 12 | retry/UNKNOWN/degradation/outbox |
| `test:adversarial` | 9, 11, 12 | X2–X8 fail closed |
| `test:scenarios --mode=deterministic` | 9–13 | 13/13 |
| `test:e2e` | 8, 11, 13 | two-person approval journey |
| `audit:verify` | 10–13 | chain intact, anchors resolve |
| `readiness --level D1` | 12 | drills complete |
| `readiness --level D2` | 13 | production-capable |

## Definition of done for the whole project

All twenty-two success criteria in `PRD.md` §10 are evidenced in the repo: passing functional and
adversarial suites, a two-person approval path enforced by tests, a KPI dashboard with computed
values, an anchored audit trail for each demo case, failure-drill artifacts and a baseline comparison.
The readiness report states **D2 — production-capable**; **D3 — production-approved** is explicitly
out of scope until the sign-off matrix in `PRODUCTION_READINESS.md` is complete. Anything not
evidenced is listed as a known gap, never claimed.
