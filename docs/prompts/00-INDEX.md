# Build prompts — index and usage

Fourteen prompts, one per implementation phase in `docs/IMPLEMENTATION_PLAN.md`. Each is written to be
pasted into a coding agent as a complete instruction. The production edition adds quorum approvals,
separation of duties, policy pinning, the transactional outbox, observability, failure drills and a
readiness gate; every prompt carries the verification command that proves its phase.

## How to use

1. Paste `AGENTS.md` into the agent's context once (or confirm it is read from the repo root).
2. Paste **one** phase file.
3. Let the agent finish, then run the verification commands yourself.
4. Only when the Done criteria pass, commit and move to the next file.

Do not bundle phases. Phase 6 cannot be trusted until its RBAC matrix is green; Phase 12 cannot be
trusted until Phase 7's `UNKNOWN` path is green.

## Order

| # | File | Phase | Depends on |
|---|---|---|---|
| 01 | `01-phase-0-foundation.md` | Foundation, envelope, observability scaffold | — |
| 02 | `02-phase-1-data-foundation.md` | Full schema, constraints, deterministic seed | 01 |
| 03 | `03-phase-2-synthetic-systems.md` | Sources + idempotent target with failure modes | 02 |
| 04 | `04-phase-3-integrity-engine.md` | Contract checks → integrity events | 03 |
| 05 | `05-phase-4-gate-exposure-cases.md` | Gate, exposure, holds, 16-state machine, outbox | 04 |
| 06 | `06-phase-5-investigator.md` | Agent layer + deterministic twin + `L1` | 05 |
| 07 | `07-phase-6-policy-approval.md` | RBAC, risk policy, quorum, SoD, break-glass | 06 |
| 08 | `08-phase-7-executor-verifier.md` | Single writer, `UNKNOWN`, verification, reconcile | 07 |
| 09 | `09-phase-8-console-ui.md` | Control room: IA, shell, workspace, quorum and SoD | 08 (07 for approval data) |
| 10 | `10-phase-9-eval-harness.md` | Evaluation harness: 13 fixtures (12 scenarios + `X`) + 7 adversarial, metrics | 08 |
| 11 | `11-phase-10-kpi-audit.md` | Analytics, audit chain proof, external anchors | 10 |
| 12 | `12-phase-11-production-controls.md` | Rate limits, outbox worker, degradation, operations/settings UI, OTel | 11 |
| 13 | `13-phase-12-failure-load-dr.md` | F-01…F-26 drills, load, DR, audits, D1 | 12 |
| 14 | `14-phase-13-production-readiness.md` | Deploy, demo, readiness D2 verdict | 13 |

## Audits (read-only)

Run one at a time inside Phase 12. Each stops after its report and waits for approval. Reports go to
`docs/audits/`; fixes are separate, approved tasks.

| File | Finds | Report |
|---|---|---|
| `audits/01-failure-and-deployment-consistency.md` | Deploy drift, migrations, rollback, kill-switch, blast radius | `docs/audits/<date>-failure-deployment.md` |
| `audits/02-security-and-data-exposure.md` | Auth, RBAC matrix, IDOR, secrets, agent risk, headers | `docs/audits/<date>-security.md` |
| `audits/03-resource-leak-and-dead-code.md` | Leaks, duplicate write paths, dead code, silent failure | `docs/audits/<date>-resource-dead-code.md` |

After all three, `docs/audits/SUMMARY.md` classifies findings and lists zero open CRITICAL/HIGH before
Phase 13 starts.

## Where the production requirements live

| Requirement | Normative doc | Built in |
|---|---|---|
| Roles, permissions, quorum, SoD, break-glass | `RBAC.md` | Phase 6 (UI Phase 8/11) |
| Policy versions, hash pinning, activation | `DECISIONS.md` ADR-018, `API.md` §6.5 | Phase 6/11 |
| `UNKNOWN`, no retry, reconciliation | `FAILURE_MODES.md` §2–§5 | Phase 7 |
| Outbox, DLQ, replay | `FAILURE_MODES.md` §3 (F-20), §5, `API.md` §6.7 | Phase 4/11 |
| Degradation ladder | `FAILURE_MODES.md` §2 | Phase 5/11 |
| Metrics, spans, SLOs, alerts | `OBSERVABILITY.md` | Phase 0/11 |
| Audit anchoring, chain break freeze | `OBSERVABILITY.md` §8 | Phase 10 |
| Evaluation tiers T1–T7 | `EVALUATION.md` §2 | Phase 9/12 |
| Readiness evidence D0–D3 | `PRODUCTION_READINESS.md` | Phase 12/13 |

## Rules that apply to every prompt

- Never begin a phase whose predecessor's Done criteria have not been verified.
- Never modify an upstream phase's public function signature without an ADR entry.
- If the prompt's assumptions do not match the repo, stop and report the mismatch — do not improvise.
- Any change that would violate an invariant in `AGENTS.md` §2 is refused, not negotiated.
- Never push to a remote. Commit and tag locally only; the repository owner pushes.
- Report using `AGENTS.md` §6, including what was **not** verified.

## Reusable add-ons

**When something is broken:**
```
Investigate before editing. Expected:
Actual:
Steps to reproduce:
Error / console output:
Trace the flow from the user action through the route, the lib call and the database.
Name the root cause and the exact file/line. Then propose the smallest safe fix.
Do not refactor unrelated code.
```

**Before any write to the database schema:**
```
Read docs/BACKEND_SCHEMA.md and docs/DATABASE.md first.
List the tables/columns that change, the constraint that must exist, whether a migration is
required, and whether any invariant in AGENTS.md §2 is affected. Then implement.
```

**When adding an endpoint:**
```
Read docs/API.md and docs/RBAC.md first. Follow the envelope, the error catalogue, the permission
table and the rate-limit table. Validate input with Zod, require Idempotency-Key for mutations,
write the audit row in the same transaction, and add the route to ROUTE_PERMISSIONS.
```

**When a test fails only sometimes:**
```
Do not add sleeps or retries. Find the shared state, missing lock, clock dependency or unawaited
promise. Reproduce it three times with the exact command and report the failure rate before fixing.
```
