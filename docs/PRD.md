# PRD — Data-to-Action Integrity

**Product name:** Action Integrity (working title)
**Tagline:** Stop a bad data change from becoming a bad business decision — and prove the fix.
**Version:** 2.0 (production-shaped edition)
**Status:** Ready to build
**Source of truth:** `docs/` — this file is the north star for scope questions.

---

## 1. Problem

Enterprise automation and AI agents convert data directly into business actions: granting or
revoking entitlements, changing account status, triggering service workflows, sending customer
communications. Data-observability products detect pipeline problems and stop at an alert or a
recommendation. Nobody reliably answers the next question:

> Can this specific outbound action still be trusted, what has already been affected, and is the
> business state now correct?

The dangerous case is **semantically valid drift**: the schema still passes, the pipeline still
runs, but the *meaning* of a field changed. A downstream automation then removes a customer's
entitlement. Technically successful. Commercially wrong.

## 2. Target user

| Role | Uses the product to |
|---|---|
| Data reliability engineer | Register contracts, triage integrity events |
| Automation / agent operations engineer | Inspect why an outbound action was held |
| Analyst | Run investigations, request and add evidence |
| Business-system owner / reviewer | Supply authoritative evidence, approve corrections |
| Senior reviewer | Approve high-blast-radius corrections and provide the second approval |
| Incident manager | Drive a case to verified closure |
| Platform administrator | Manage users, policy activation, evaluation and operations — never decide a business action |
| Risk / internal auditor | Audit decisions, compensation history, access and the audit chain |

Primary buyer: CDO / VP Data Reliability / VP Enterprise Automation. MVP is demonstrated to iOPEX.

## 3. Core value proposition

A bounded control loop between unreliable data and a business system:

**unreliable evidence → exposed action → hold → agent investigation → accountable approval →
deterministic block, release or compensation → verified business state → auditable closure**

We do not build a data-quality platform, lineage platform, agent observability tool, or chatbot.
We build the last mile.

## 4. Must-have features (v1)

| # | Feature | Definition of done |
|---|---|---|
| M1 | Data contracts + deterministic integrity checks | Contract registry; schema/enum, semantic, freshness and cross-source conflict checks emit `IntegrityEvent` rows with evidence refs |
| M2 | Outbound action gate | Every outbound action must pass a deterministic gate that returns `ALLOW`/`HOLD`/`BLOCK`; holds are enforced, not advisory |
| M3 | Exposure analysis | Given an integrity event, compute exposed pending and completed actions and open a case |
| M4 | Agentic investigation | Gemini-powered investigator reconciles contradictory evidence, produces competing hypotheses, requests missing evidence, and returns a cited recommendation |
| M5 | Policy-bounded disposition | Deterministic risk score and thresholds map a case to one permitted disposition; approval required above defined risk |
| M6 | Human approval | Named reviewer approves, rejects or overrides with rationale; recorded in the audit ledger |
| M7 | Deterministic execution | Release a held action, or execute the single allowlisted compensation (`RESTORE_LAST_KNOWN_GOOD`), idempotently |
| M8 | Business-state verification | Read the target system after execution and compare to expected state; success only if observed state matches |
| M9 | Evidence and decision ledger | Append-only audit of every event, citation, recommendation, approval, execution and verification, externally anchored |
| M10 | Evaluation harness | 13 functional fixtures, deterministic baseline mode, adversarial tier, KPI computation comparing agent vs baseline |
| M11 | KPI dashboard | Prevention, investigation, recovery, approval and business-outcome metrics from §9 |
| M12 | Safe refusal | Any recovery requiring an irreversible or out-of-scope action produces an evidence packet and no execution |
| M13 | Role-based access and separation of duties | Six roles with a permission matrix; `ADMIN` cannot approve or execute; an approver cannot execute their own case |
| M14 | Approval quorum | High risk or high exposure requires two distinct approvals, one from a `SENIOR_REVIEWER`; approvals bind to evidence, policy, report and disposition and expire |
| M15 | Policy versioning and hash pinning | One active policy document; every decision names its version and hash; activation is explicit and audited |
| M16 | Reliable side effects and recovery | Transactional outbox with bounded retries and a DLQ; reconciliation resolves `PENDING`/`UNKNOWN`, expired approvals and SLA breaches |
| M17 | Observability and SLOs | Structured logs, traces and metrics correlated by `requestId`/`traceId`/`caseRef`; dashboards, alerts and runbooks |
| M18 | Break-glass | Two-admin, one-case, ≤60-minute elevation with co-signed approval, full audit and mandatory review |
| M19 | Operations console | `/app/settings/operations` shows degradation, dependencies, outbox/DLQ, anchors, stale cases and job health |
| M20 | Production readiness gate | Automated evidence report plus named sign-offs; claims distinguish production-capable from production-approved |

## 5. Nice to have (post-MVP, do not build now)

- Second action class (customer notification suppression).
- Additional evidence adapters.
- Reviewer workload balancing.
- Contract authoring UI (v1 registry is seeded/read-only).
- Slack/Teams approval routing and notification adapters.
- Historical pattern mining across cases.
- SCIM provisioning and automated access review.
- Multi-tenant isolation with row-level scoping.
- Active-active multi-region deployment.
- Sovereign/on-prem anchor store alternatives.

## 6. Explicitly out of scope

Generic observability · lineage platform · universal schema-drift detection · generic agent
monitoring · universal rollback · autonomous money movement · legal or regulatory judgment ·
irreversible production changes · fully autonomous contract interpretation · replacing enterprise
approval systems · silently repairing source data · a chat interface · a dashboard whose only
action is generating an alert.

**Scope boundary for compensation:** exactly one target system and one compensation mechanism
(`RESTORE_LAST_KNOWN_GOOD` from a restore point captured before the action). This is bounded
recovery, not universal rollback. If no restore point exists, the system must refuse and escalate.

## 7. Initial use case

**Incorrect customer-entitlement update.** A billing feed changes the meaning of a plan-status
field (`ACTIVE` → `CURRENT`). The schema stays valid. An automation prepares to revoke the `SSO`
entitlement from a set of accounts. Action Integrity holds the revocation, traces the semantic
conflict, requests confirmation from the contract owner, and routes a cited recommendation to a
reviewer. On approval the revocation is blocked and never executes, or, if already applied, the
entitlement is restored from its restore point and the target state is re-read and verified.

## 8. Demonstration scenarios (acceptance stories)

| ID | Scenario | Required observable outcome |
|---|---|---|
| A | Prevention | Semantic conflict detected; outbound revoke held; agent cites conflict; reviewer approves a block; entitlement remains `ACTIVE`; verified with zero target writes |
| B | Post-action compensation | Bad status change already applied; case reconstructs exposure; single compensation restores prior state; service status verified |
| C | Conflicting evidence | Source says inactive, usage/billing/support say active; no automatic winner; evidence requested; action held; escalation recorded |
| D | Verification failure | Compensation API returns 200 but state unchanged; case moves to `REOPENED` and is not counted as recovered; owner notified |
| E | Safe refusal | Recovery would need an irreversible financial/legal action; system refuses, emits evidence packet, no execution |
| F | False positive | Benign schema-compatible change; gate returns `ALLOW`; no case opened; recorded for false-block measurement |
| G | Duplicate delivery | Same action submitted twice; exactly one gate decision, one hold, one execution |
| H | Stale but valid | Data fresh and semantics unchanged; action allowed |
| I | Freshness breach | Evidence past its freshness bound; gate fails closed rather than acting on stale data |
| J | Missing-evidence timeout | Evidence SLA expires with no answer; case escalates instead of guessing |
| K | High-value escalation | Estimated value and exposure force two approvals, one from a `SENIOR_REVIEWER`; a distinct person executes |
| L | Cross-source invariant | Billing says `ACTIVE`, contract says `SUSPENDED`; no silent winner, case escalates |

Scenarios A–E come from the project brief. F–H are required to measure false blocks and
idempotency, and to prove the system does not block everything. I–L cover fail-closed paths and the
approval boundary. `EVALUATION.md` adds one security fixture (`X`) for prompt injection in evidence;
the functional suite is 13 fixtures in total, and a separate adversarial tier attacks the approval,
policy and execution controls.

## 9. Success metrics (KPI definitions live in `docs/EVALUATION.md`)

**Prevention** — unsafe actions held/blocked; exposure-weighted actions prevented; time from
integrity event to hold; action-risk precision; false-block rate.

**Investigation** — time to identify exposed actions; time to authoritative evidence; share of
cases needing human evidence requests; share of recommendations changed by reviewers;
evidence-completeness score at decision; fallback rate; tokens per case.

**Approval and control** — approvals per case; time to quorum; quorum-failure rate; separation-of-
duties rejections; approval staleness (superseded/expired); break-glass rate.

**Recovery** — compensating-action success rate; time from quorum to corrected state;
verified-closure rate; duplicate-action/compensation rate; reopen rate after failed verification;
`UNKNOWN` resolution time.

**Operations** — gate p95 latency; outbox lag; audit completeness; audit anchor age; unverified
writes (must be zero); chain breaks (must be zero); fallback rate.

**Business outcome** — customer-impact minutes avoided; support effort avoided; financial exposure
prevented; audit effort avoided; repeat occurrence of the same integrity failure.

## 10. Success criteria (release gate)

The edition is only accepted when the demo shows, end to end:

1. One real outbound action class with consequential effect.
2. A failure that schema validation alone does not catch.
3. Correct containment (hold) of the exposed action.
4. Adaptive evidence gathering with explicit missing-evidence requests.
5. A cited recommendation with competing hypotheses.
6. A justified human-approval boundary.
7. One real, executed tool action against a target system.
8. Deterministic enforcement (no LLM in the write path or threshold logic).
9. A verified safe block, or a successful compensation, both proven by a target-state read.
10. Observed business-state verification, not API-response trust.
11. An auditable evidence and decision history.
12. Measurable performance versus the deterministic baseline.
13. High-risk execution blocked with one approval and allowed only with quorum from two distinct
    people, one senior.
14. The approver is refused execution; the executor is a different person.
15. An approval given against older evidence fails at execute with `EVIDENCE_CHANGED`.
16. A policy change invalidates approvals and is itself audited with version and hash.
17. A target timeout produces `UNKNOWN`, never a retry, and is resolved by a verification read.
18. A killed dependency leaves no partial rows and no unverified write.
19. The audit chain verifies and matches an externally written anchor.
20. An operator sees dependency health, degradation level, outbox/DLQ and anchor age on
    `/app/settings/operations`; each alert rule names the runbook that resolves it.
21. Break-glass requires a second admin to co-sign, is scoped to one case, expires, and pages security
    when used.
22. `npm run readiness -- --level D2` produces evidence on the release commit; the README states the
    verdict and the residual gaps.

## 11. Disqualifiers

Reject if: only monitoring/alerts are demonstrated; a plain contract + workflow solves the case as
safely; no successful hold can be shown; no approved compensation can be executed and verified;
reviewers must redo the whole investigation; false blocks cost more than unsafe actions avoided;
or the MVP needs universal rollback, real money movement, or unrealistic enterprise access.

## 12. Non-functional requirements

- **Determinism:** identical inputs, active policy and `INVESTIGATION_MODE` produce identical control
  decisions and identical quorum/SOD outcomes. LLM output is cached per
  `(caseId, evidenceHash, promptVersion, mode)` and never gates a write.
- **Availability:** gate decisions available 99.9% over 30 days; console 99.5%. A dependency failure
  holds work; it never produces an allow.
- **Latency:** gate decision p95 ≤ 400 ms; case page < 1.5 s p95 on seeded data; investigation p95 ≤
  10 s; execution p95 ≤ 60 s to terminal status.
- **Auditability:** every state transition writes an `AuditEvent` in the same transaction; ledger
  rows are immutable; the chain is anchored hourly to external storage and verifiable on demand.
- **Failure posture:** fail closed. Missing critical evidence ⇒ hold or escalate, never allow. A
  broken audit chain freezes consequential writes.
- **Retry posture:** reads retry with a budget; target writes never retry; unknown outcomes become
  `UNKNOWN` and are resolved by reading state.
- **Idempotency:** every mutation is keyed; a repeated request replays one response, a conflicting
  payload is rejected, and no duplicate target write is possible.
- **Separation of duties:** the actor taking any post-approval step (write or block completion) is
  never an approver; high risk needs two distinct approvers.
- **Accessibility:** WCAG 2.2 AA for the case console; full keyboard operation of the approval flow,
  including the quorum panel.
- **Dataset size:** 5,000 accounts, 12,000 entitlements, ~40 outbound actions — enough to make
  exposure analysis non-trivial without a heavy seed.
- **Retention:** audit forever; cases/approvals 7 years; logs 30/90 days; traces 7 days; idempotency
  records 30 days.
- **Recovery:** RPO ≤ 5 min, RTO ≤ 60 min, rehearsed quarterly.

## 13. Production posture and honest claims

Two verdicts are reported separately (`PRODUCTION_READINESS.md`):

- **Production-capable** — the controls exist and have technical evidence on the release commit.
- **Production-approved** — named humans accepted the residual risks for a specific environment and
  dataset, including IdP configuration, penetration test, data-processing agreement and on-call.

This repository targets **D2 (production-capable)** with documented conditions. It does **not** claim
D3, SOC 2, HIPAA, "zero downtime", "exactly-once target writes", or full autonomy. The model never
writes; a human quorum approves every consequential write; the verifier proves the result.

## 14. Constraints that shape the product

- One target system, one compensation mechanism, one action class. Breadth is not the differentiator.
- Synthetic data only in the demo; real data requires redaction, retention and a DPA that are not yet
  implemented.
- Single organisation; no row-level tenancy.
- The demo deployment is production-shaped, not production-approved.
