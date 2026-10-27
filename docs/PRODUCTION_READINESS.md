# PRODUCTION_READINESS.md — Go/no-go gate

This file is the release authority. A deployment is **not** production-approved because the tests pass;
it is approved when every blocking criterion has evidence produced on the release commit and signed by
the named roles. Two verdicts are always reported separately:

| Verdict | Meaning |
|---|---|
| **Production-capable** | The system implements the controls: RBAC, quorum, SoD, verification, outbox, audit anchoring, observability, failure handling. Technical evidence exists. |
| **Production-approved** | An accountable human has accepted the residual risks for a specific environment and dataset. This requires the organisational items below, which code cannot supply. |

Saying "production-ready" without naming which verdict is prohibited in the README, the demo and any
sales conversation.

---

## 1. Maturity levels

| Level | Name | Requires | This repository |
|---|---|---|---|
| D0 | Demo | Deterministic eval green, seeded data, local run | Yes |
| D1 | Pilot-capable | D0 + RBAC/SoD, failure suite, audit chain verification, runbooks, one drill | Yes, when Phase 12 passes |
| D2 | Production-capable | D1 + load, chaos, DR, SLOs with alerts fired, external anchor, dependency and secret gates | Yes, when Phase 13 passes |
| D3 | Production-approved | D2 + named sign-offs, real IdP, pen test, data-processing agreement, on-call rota | **Not claimed** — organisational |

The README states D1 or D2 only after `npm run readiness` produces a report for that commit.

## 2. How the gate is evaluated

`npm run readiness -- --level D2 --commit <sha>`:

1. Refuses if the working tree is dirty or HEAD differs from `--commit`.
2. Runs the automated checks in §3 tagged `AUTO` and reads artifacts for the rest.
3. Emits `artifacts/readiness/<date>-<sha>/report.md` and `report.json` with one row per criterion:
   `pass | fail | unverified | deferred`, the evidence path, and the timestamp.
4. Exits 1 on any `fail`; exits 2 if a blocking criterion is `unverified`; exits 0 only when every
   blocking row is `pass` and every deferred row has a `PRODUCTION_READINESS` gap entry.
5. Prints, separately and prominently, the manual items it **cannot** verify: sign-offs, pen test,
   IdP configuration, on-call rota, DPA. It never infers them from a file's existence.

Artifacts are gitignored. A readiness report older than the release commit is stale and is rejected.

## 3. Criteria

Status key: **B** = blocker for D2, **C** = conditional (compensating control required, with an
expiry), **D** = deferred (gap entry required), **M** = manual/organisational.

### 3.1 Correctness and the determinism boundary

| # | Criterion | Status | Evidence |
|---|---|---|---|
| A1 | 13/13 evaluation fixtures pass in deterministic mode, twice in a row, identical results | B | `artifacts/eval/<sha>/deterministic.json` |
| A2 | Agent mode matches the baseline table within `config/metrics.json` tolerances | B | `artifacts/eval/<sha>/agent.json` |
| A3 | No LLM import in `lib/gate`, `lib/policy`, `lib/executor`, `lib/verifier`, `lib/integrity`, `lib/exposure` | B | `npm run check:boundaries` (AST/import scan) |
| A4 | Investigator tool allowlist contains no write tool (snapshot test) | B | `tests/agent/tools.test.ts` |
| A5 | Every `CLOSED_RESOLVED` case has a passing `VerificationResult` and any required approval | B | `npm run check:invariants` against the demo dataset |
| A6 | `BLOCK` cases have zero `ActionExecution` rows | B | invariant check + fixture A |
| A7 | State-machine matrix: all legal transitions, all illegal ones rejected with no audit row | B | `tests/state-machine/*` |

### 3.2 Identity, authorization and separation of duties

| # | Criterion | Status | Evidence |
|---|---|---|---|
| B1 | OIDC is the only human login in production; credentials provider disabled by env | B | startup assertion + config review |
| B2 | Every route appears in `ROUTE_PERMISSIONS`; startup fails otherwise | B | `tests/api/envelope.test.ts` |
| B3 | Role × route matrix matches `RBAC.md` | B | `tests/rbac/matrix.test.ts` |
| B4 | High-risk execute requires quorum with a senior approver | B | `tests/rbac/quorum.test.ts` |
| B5 | Approver cannot execute; duplicate approver rejected; override author blocked | B | `tests/rbac/sod.test.ts` |
| B6 | Approval binding invalidated by evidence or policy change | B | `tests/policy/approval-binding.test.ts` |
| B7 | Break-glass requires two admins, one case, ≤ 60 min, audited and paged | B | `tests/rbac/break-glass.test.ts` |
| B8 | Deactivated user and epoch change take effect on the next request | B | `tests/rbac/inactive.test.ts` |
| B9 | Role provisioning claim mapping rejects unknown roles | B | OIDC integration test |
| B10 | Quarterly access review completed | M | `docs/audits/access-review-*.md` |

### 3.3 Security and data protection

| # | Criterion | Status | Evidence |
|---|---|---|---|
| C1 | Secret scan: no key material in repo, logs or client bundle | B | `npm run check:secrets-scope` + gitleaks |
| C2 | `TARGET_SERVICE_KEY` referenced only in the three allowed modules | B | `check:secrets-scope` |
| C3 | `npm audit --production --audit-level=high` clean; Dependabot enabled | B | CI log |
| C4 | Injection fixture X flags suspicious content and changes no disposition | B | fixture result |
| C5 | No stack trace, SQL, path or upstream message in any error envelope | B | `tests/api/envelope.test.ts` |
| C6 | Rate limits fail closed; auth has per-IP and per-email counters | B | `tests/security/rate-limit-*` |
| C7 | Headers and CSP verified on the deployed origin | B | `npm run smoke -- --security-headers` |
| C8 | No real PII in any environment; retention policy documented | B | data inventory + seed review |
| C9 | External penetration test of the write path and auth | C | report + remediation plan; pilot with synthetic data only until complete |
| C10 | Multi-tenant isolation | D | single-organisation deployment; gap §7 |

### 3.4 Reliability and failure handling

| # | Criterion | Status | Evidence |
|---|---|---|---|
| D1 | Failure suite F-01…F-26 green on the release commit | B | `artifacts/failure/<sha>/` |
| D2 | Chaos run: 200 cases, dependency kills, zero unverified writes, zero double executions | B | `artifacts/chaos/<sha>/summary.json` |
| D3 | Load test: 20 rps ingest for 30 min, p95 < 400 ms, errors < 0.1% | B | `artifacts/load/<sha>/summary.json` |
| D4 | Target-down drill: no blind retry, every affected case resolves through verification | B | drill transcript |
| D5 | Restore drill: RPO ≤ 5 min, RTO ≤ 60 min, audit chain verified after restore | B | `artifacts/drills/restore-<date>.json` |
| D6 | Outbox DLQ test and replay tool exercised | B | `tests/outbox/dlq.test.ts` |
| D7 | Circuit breakers and retry budget behaviour observed in a drill | B | drill transcript |
| D8 | Active-active multi-region | D | single-region with PITR; gap §7 |

### 3.5 Observability

| # | Criterion | Status | Evidence |
|---|---|---|---|
| E1 | Every span and metric in `OBSERVABILITY.md` §4–5 emitted on the demo path | B | trace export + metrics scrape |
| E2 | SLO dashboards provisioned from `ops/dashboards/*.json` | B | dashboard import test |
| E3 | Each alert fired once in staging with the linked runbook | B | `artifacts/alerts/<sha>.json` |
| E4 | Invariant tripwires wired: unverified write, chain break, gate bypass | B | synthetic trigger test |
| E5 | Logs carry `requestId`/`traceId`/`caseRef` and contain no PII or prompt text | B | log sample review + redaction test |
| E6 | 24/7 on-call rota with paging | M | rota document |

### 3.6 Audit and accountability

| # | Criterion | Status | Evidence |
|---|---|---|---|
| F1 | Immutability triggers active on audit, report, verification | B | `tests/audit/immutability.test.ts` |
| F2 | Chain verification passes over the full demo dataset | B | `npm run audit:verify -- --full` |
| F3 | Hourly anchors written to an external store, object-lock/WORM | C | demo uses local files; production requires the bucket configuration to be verified |
| F4 | Anchor-to-chain comparison tested, including a deliberately broken range | B | `tests/audit/anchor-verify.test.ts` |
| F5 | Audit export for an auditor (case-scoped, signed manifest) | C | endpoint + manual; included in pilot scope |
| F6 | Retention: audit forever, logs 30/90 days, traces 7 days | B | retention config |
| F7 | Every approval, execution, break-glass and policy activation has a correlated audit event | B | `tests/audit/correlation.test.ts` |

### 3.7 Operations

| # | Criterion | Status | Evidence |
|---|---|---|---|
| G1 | Every alert has a runbook; every runbook was executed by someone who did not write the code | B | runbook review notes |
| G2 | Deploy, rollback and migration rehearsed in staging | B | release log |
| G3 | Rollback time < 15 min measured | B | drill timing |
| G4 | Backup and PITR configured, restore access tested | B | provider config + D5 |
| G5 | Secret rotation exercised for all three service keys | B | `tests/security/key-rotation.test.ts` + drill |
| G6 | Capacity model recorded and load-tested at 2× expected pilot volume | C | load report |
| G7 | Status page and incident comms template | M | links in incident doc |
| G8 | Data-processing agreement and sub-processor list | M | legal |

### 3.8 Evaluation and change control

| # | Criterion | Status | Evidence |
|---|---|---|---|
| H1 | Deterministic vs agent comparison published for the release | B | `artifacts/eval/<sha>/comparison.md` |
| H2 | Adversarial suite includes injection, contradictory evidence, stale-valid data, replay | B | fixtures X + adversarial tier |
| H3 | Prompt change bumped `promptVersion` and re-ran the full suite | B | CI check + eval artifact |
| H4 | Policy change activated through `POST /admin/policy/activate` with a review ticket | B | audit event `POLICY_ACTIVATED` |
| H5 | No metric regression beyond tolerance on two consecutive runs | B | eval artifacts |
| H6 | Model or provider change evaluated against the same fixtures | B | eval artifact |

## 4. Drills and their acceptance thresholds

| Drill | Pass condition | Frequency |
|---|---|---|
| Target down mid-execution | 0 blind retries; 100% of affected cases end in `UNKNOWN` then resolve via verification | Every executor change |
| DB failover | 0 partial rows; no lost approval; reconcile resolves ambiguous commits | Quarterly |
| Audit break | writes frozen within 60 s of detection; chain verified after repair; SEV1 recorded | Every audit change |
| Restore | RPO ≤ 5 min, RTO ≤ 60 min, chain and fingerprints valid | Quarterly |
| Quorum | high-risk execution blocked at 0/1 approvals; allowed at 2 with senior; approver-executor blocked | Every policy change |
| Key rotation | old key 401 after 24 h; zero failed writes during overlap | Every rotation |
| Load | p95 gate < 400 ms, error < 0.1%, no invariant trips at 20 rps | Every release affecting ingest |

A drill result is invalid without: commit sha, environment, timestamp, operator, command, observed
metric deltas, and the artifact path.

## 5. Sign-off

| Role | Accountable for | Cannot also be |
|---|---|---|
| Engineering lead | A, D, H criteria | — |
| Security lead | B, C, F criteria and pen-test remediation | Engineering lead |
| Operations lead | E, G criteria, on-call rota, drills | Engineering lead |
| Product owner | Risk acceptance, scope of pilot, DPA | Security lead |
| Auditor (advisory) | F evidence, access review, break-glass review | Any approver of this release |

One person may not hold two sign-offs. Sign-off records the commit sha, the readiness report hash, the
accepted conditions and an expiry (90 days or the next material change, whichever is first).

The go/no-go meeting is 30 minutes and answers four questions only: which criteria failed, what is the
compensating control, who accepts the residual risk, and when does it expire. Anything else is a
separate meeting.

## 6. Re-certification triggers

A new readiness evaluation is mandatory when any of the following changes:

- a new write path, execution kind, or target adapter;
- a change to `AuditEvent` schema, chain algorithm, or anchoring;
- a new role, permission, or SoD rule;
- a new external dependency (model, identity provider, object store, queue);
- a change to the policy engine, risk bands, or quorum rules;
- any SEV1 incident;
- 90 days since the last approval, whichever comes first.

## 7. Residual gaps for this release

These are honest and must appear in the README and the demo's "what is not built" beat.

| Gap | Verdict impact | Compensating control |
|---|---|---|
| Single organisation, no row-level tenancy | C10 deferred | One tenant per deployment; contract states it |
| No active-active / multi-region | D8 deferred | PITR + 60 min RTO; pilot tolerates single-region outage |
| External anchor store required for F3 | Conditional | Demo uses local anchors; production bucket config verified before approval |
| Pen test not yet performed | Conditional | Synthetic data only; no real customer data until complete |
| 24/7 on-call not staffed by this repository | Manual | Pilot business-hours support with a named escalation path |
| OIDC depends on a real IdP | Conditional | Production refuses credentials login; staging uses a test IdP |
| No SCIM / automated joiner-mover-leaver | C safety net | Quarterly access review + same-day deactivation |
| LLM quality is not a security control | — | Deterministic fallback and policy never trust the model's disposition alone |
| Exactly-once target writes are not claimed | — | At-most-once with `UNKNOWN` + verification; documented in `FAILURE_MODES.md` |

## 8. Claims we must not make

- "SOC 2 certified", "HIPAA compliant", "GDPR certified" — no audit has been performed.
- "Zero downtime" — deploys may briefly return 503; the client retries with the same key.
- "Exactly once" — the executor is at-most-once with explicit `UNKNOWN` reconciliation.
- "Fully autonomous" — the model never writes; a human approves consequential writes.
- "Production-approved" when only D2 evidence exists.

## 9. Working the gate

When a criterion fails:

1. Do not downgrade it to `C` to ship. Change the status only with a compensating control, an owner
   and an expiry, recorded in §7.
2. Add the remediation as a dated action item in `IMPLEMENTATION_PLAN.md`, not a comment.
3. Re-run `npm run readiness` on the same commit after the fix; attach the new report.
4. If the failure is in an invariant, stop. There is no pilot exception for `aic_unverified_write_total`,
   `aic_audit_chain_break_total`, or a gate bypass.
