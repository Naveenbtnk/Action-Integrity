# OBSERVABILITY.md — Telemetry, SLOs and alerts

Normative for `src/lib/observability/*`, every route handler, the executor, the outbox worker and the
audit jobs. Observability is not a dashboard added at the end: a phase is not done until its
consequential path emits the spans, logs and metrics named here.

---

## 1. Principles

1. **One request, one correlation chain.** Every request has `requestId` and `traceId`; every
   consequential record (case, execution, approval, outbox event, audit event) carries both, plus the
   domain ids that let an operator move from an alert to the exact row.
2. **Outcomes, not activity.** Count decisions, executions, verifications and breaches. Request counts
   alone cannot tell you whether the product prevented harm.
3. **No sensitive payloads.** No prompts, excerpts, rationales, passwords, tokens, keys or full
   records in logs, span attributes or metric labels. Log ids, counts, hashes and durations.
4. **Cardinality is a budget.** Never label a metric with `caseRef`, `accountId`, `userId`, `email`,
   `requestId`, `executionId` or any unbounded value. Those belong in traces and logs.
5. **Fail open for telemetry, fail closed for the product.** A telemetry exporter failure must never
   block or alter a gate decision, approval, write or verification. Audit persistence is different:
   it is part of the transaction and is never best-effort.

## 2. Correlation model

| Field | Source | Present on |
|---|---|---|
| `requestId` | Incoming `x-request-id` if it matches `^[A-Za-z0-9_-]{8,64}$`, else generated `req_…` | Logs, envelope `meta.requestId`, audit events, outbox events |
| `traceId` / `spanId` | OpenTelemetry context | Logs, span attributes, audit events, outbox events |
| `caseRef` | Domain | Logs for case routes, audit events, traces |
| `actionId`, `executionId`, `approvalId`, `outboxEventId` | Domain | Logs and spans on the path that owns them |
| `policyVersion`, `policyHash` | Active policy | Every decision-bearing response `meta`, `PolicyDecision`, audit event |
| `evidenceHash` | Evidence set | Report, approval binding, execution request, audit event |

`x-request-id` is echoed on every response and logged. `traceparent` is propagated to the synthetic
target on executor writes and to Gemini only if the client supports it (the Gemini call carries a
span, not a trace header).

## 3. Logging

- **Library:** Pino, JSON to stdout. One logger per process from `lib/observability/logger.ts`.
  No `console.log` in `src/` (lint rule).
- **Levels:** `fatal`, `error`, `warn`, `info`, `debug`. Production default `info`; `debug` per-route
  only via `LOG_LEVEL_DEBUG_ROUTES` and never in production without an incident.
- **Required fields on every line:** `ts`, `level`, `service` (`aic-web` | `aic-worker`), `env`,
  `version` (git sha), `msg`.
- **Required fields on request lines:** `requestId`, `traceId`, `route`, `method`, `status`,
  `durationMs`, `actorType`, `actorIdHash`, `code`.
- **Domain lines** add `caseRef`, `actionId`, `executionId`, `approvalId`, `outboxEventId`,
  `policyVersion`, `policyHash`, `evidenceHash` as applicable.
- **Redaction (Pino `redact`):** `req.headers.authorization`, `req.headers.cookie`,
  `res.headers["set-cookie"]`, `x-agent-key`, `x-target-key`, `x-ops-key`, `password`, `token`,
  `secret`, `apiKey`, `excerpt`, `body`, `rationale`, `prompt`, `response.text`.
- **Never log:** emails in clear (use `sha256(lower(email)).slice(0,12)` as `actorIdHash`), account
  ids in access logs, LLM prompt or completion text, raw evidence payloads.
- **Sampling:** errors always; all state transitions and decisions always; successful reads sampled at
  10% by `requestId` hash. Sampling never changes audit writes.
- **Client errors** log at `warn` with the error code, never the stack. Server errors log at `error`
  with the stack **server-side only**; the response envelope never contains it.

Log line examples (normative shape):

```json
{"ts":"2026-10-26T09:12:00.412Z","level":"info","service":"aic-web","env":"production",
 "version":"a1b2c3d","msg":"gate.decided","requestId":"req_7f3a…","traceId":"4bf92f…",
 "caseRef":"AIC-0007","actionId":"act_019…","decision":"HOLD","reasonCodes":["SCHEMA_DRIFT"],
 "durationMs":12,"policyVersion":"2026.10.1","policyHash":"sha256:9c1e…"}
```

## 4. Traces

OTel SDK, OTLP/HTTP exporter enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise a
no-op tracer. No agent sidecar is required locally.

| Span | Parent | Required attributes |
|---|---|---|
| `http.server` | — | `http.method`, `http.route` (pattern, not raw path), `http.status_code`, `request.id` |
| `gate.evaluate` | `http.server` | `gate.decision`, `reason.count`, `contracts.evaluated` |
| `integrity.checks` | `gate.evaluate` | `checks.run`, `events.created`, `events.suppressed` |
| `case.transition` | caller | `case.from`, `case.to`, `transition.reason` |
| `agent.investigate` | `http.server` | `agent.mode`, `agent.model`, `agent.tokens.input`, `agent.tokens.output`, `agent.retried`, `agent.fallback`, `report.disposition`, `report.confidence` |
| `policy.decide` | `http.server` | `risk.score`, `policy.disposition`, `policy.version`, `policy.hash`, `approvals.required` |
| `approval.record` | `http.server` | `approval.decision`, `approval.disposition`, `approval.break_glass`, `quorum.current`, `quorum.required` |
| `execution.execute` | `http.server` | `execution.kind`, `execution.status`, `target.object_type`, `idempotent.replay` |
| `target.write` | `execution.execute` | `http.method`, `http.route`, `http.status_code`, `target.audit_id` |
| `restore.capture` | `execution.execute` | `restore.point_id`, `restore.state_hash` |
| `verification.read` | `http.server` | `verification.passed`, `verification.mismatch.count` |
| `outbox.publish` | worker | `outbox.event_type`, `outbox.attempt`, `outbox.lag_ms` |
| `audit.anchor` | worker | `anchor.from_seq`, `anchor.to_seq`, `anchor.root_hash` |

Rules: never put evidence text, rationale, prompt or raw record fields in span attributes. LLM spans
record token counts and model id only. `target.write` spans are always sampled (100%) because they are
the harm surface; an execution trace is never dropped.

## 5. Metrics

Prefix `aic_`. Exported via OTLP or the `/metrics` route (protected by `OPS_SERVICE_KEY` when
`METRICS_ENDPOINT_ENABLED=1`). Instrument names and labels are fixed here; a new metric needs a line
in this table.

### 5.1 Control plane

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aic_http_requests_total` | counter | `route`, `method`, `status` | Every request; `route` is the pattern, never the raw path |
| `aic_http_request_duration_seconds` | histogram | `route`, `method` | Request wall time |
| `aic_gate_decisions_total` | counter | `decision`, `reason` | Gate outcomes |
| `aic_gate_duration_seconds` | histogram | `decision` | Gate evaluation time |
| `aic_integrity_events_total` | counter | `type`, `severity` | Events created |
| `aic_cases_total` | gauge | `status` | Cases by state (from DB, refreshed every 30 s) |
| `aic_case_transitions_total` | counter | `from`, `to` | State transitions |
| `aic_case_time_to_decision_seconds` | histogram | `disposition`, `severity` | Ingest → approval quorum or terminal decision |
| `aic_hold_age_seconds` | histogram | `severity` | Age of currently held cases at scrape |
| `aic_investigations_total` | counter | `mode`, `result` | Report produced / fallback / failed |
| `aic_agent_calls_total` | counter | `outcome` | LLM calls including retries |
| `aic_agent_latency_seconds` | histogram | `outcome` | LLM call wall time |
| `aic_approvals_total` | counter | `decision`, `quorum_met` | Recorded approvals |
| `aic_quorum_rejections_total` | counter | `code` | `APPROVAL_QUORUM_NOT_MET`, `APPROVER_CANNOT_EXECUTE`, etc. |
| `aic_break_glass_total` | counter | `state` | `PENDING_COSIGN`, `ACTIVE`, `USED`, `EXPIRED`, `DENIED`, `REVOKED` |

### 5.2 Execution and verification

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aic_executions_total` | counter | `kind`, `status` | Execution outcomes |
| `aic_execution_duration_seconds` | histogram | `kind`, `status` | Executor wall time |
| `aic_verifications_total` | counter | `result`, `disposition` | `pass`, `fail`, `error` |
| `aic_verification_duration_seconds` | histogram | `result` | Verification read and comparison wall time |
| `aic_unverified_write_total` | counter | — | **Invariant tripwire — must stay 0** |
| `aic_target_requests_total` | counter | `operation`, `outcome` | Target adapter calls |
| `aic_target_duration_seconds` | histogram | `operation` | Target latency |

### 5.3 Reliability

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aic_outbox_pending` | gauge | `event_type` | Undelivered events |
| `aic_outbox_lag_seconds` | histogram | `event_type` | `now - occurredAt` at publish |
| `aic_outbox_attempts_total` | counter | `event_type`, `result` | Publish attempts |
| `aic_outbox_dlq_total` | gauge | `event_type` | Dead-lettered events |
| `aic_dependency_up` | gauge | `dependency` (`db`, `target`, `gemini`, `idp`) | 1/0 synthetic probe |
| `aic_degradation_level` | gauge | `level` (`L0`–`L5`) | Current effective degradation level |
| `aic_job_last_success_timestamp` | gauge | `job` | Unix time of the last successful run; two missed intervals ⇒ SEV3 |
| `aic_dependency_duration_seconds` | histogram | `dependency`, `operation` | Probe latency |
| `aic_llm_requests_total` | counter | `model`, `outcome` | Gemini calls incl. retries |
| `aic_llm_tokens_total` | counter | `model`, `direction` | Input/output tokens |
| `aic_llm_fallback_total` | counter | `reason` | Deterministic fallback used |
| `aic_authz_denied_total` | counter | `permission` | Denied privileged calls |
| `aic_rate_limited_total` | counter | `group` | 429s |
| `aic_idempotency_replays_total` | counter | `route` | Replayed keys |

### 5.4 Accountability and audit

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aic_audit_events_total` | counter | `event_type`, `actor_type` | Appended events |
| `aic_audit_chain_break_total` | counter | — | **Invariant tripwire — must stay 0** |
| `aic_audit_anchor_age_seconds` | gauge | — | Time since last successful anchor |
| `aic_policy_stale_rejections_total` | counter | — | `POLICY_STALE` on execute |
| `aic_evidence_changed_total` | counter | — | `EVIDENCE_CHANGED` on execute |
| `aic_sod_rejections_total` | counter | `code` | Separation-of-duties blocks |

`aic_unverified_write_total` increments only in `lib/verifier` when a write is observed without a
subsequent passing verification and is not in `VERIFYING`. It is an alarm, not a dashboard curiosity.

## 6. SLOs

Window is rolling 30 days unless stated. Business-hours calculations use `America/New_York`,
Mon–Fri 08:00–20:00, and exclude the seeded demo dataset.

| SLO | Target | Measurement |
|---|---|---|
| Gate availability | 99.9% of authenticated ingest requests receive a gate decision (not 5xx/503) | `1 - rate(5xx on /actions/ingest)` |
| Gate latency | p95 ≤ 400 ms, p99 ≤ 1 s | `aic_gate_duration_seconds` |
| Investigation latency | p95 ≤ 10 s, p99 ≤ 25 s | `agent.investigate` span |
| Investigate availability | ≥ 99.0% produce a report (native or fallback) | `aic_investigations_total{result=~"report\|fallback"}` |
| Case decision latency | p95 ≤ 30 min business hours | `aic_case_time_to_decision_seconds` |
| Execution latency | p95 ≤ 60 s from execute request to terminal execution status | `aic_execution_duration_seconds` |
| Outbox freshness | p95 ≤ 5 s, p99 ≤ 30 s | `aic_outbox_lag_seconds` |
| Audit anchor freshness | ≤ 2 h since last successful anchor | `aic_audit_anchor_age_seconds` |
| Control-plane availability (console) | 99.5% | HTTP 5xx ratio on page routes |

**Zero-tolerance invariants** are not SLOs and have no error budget. Any occurrence is a SEV1 and
freezes consequential writes until resolved:

- a write to the target without a passing verification in the same case lifecycle
  (`aic_unverified_write_total > 0`);
- a broken audit hash chain (`aic_audit_chain_break_total > 0`);
- a gate decision overridden by anything other than the recorded approval quorum;
- an `AuditEvent` mutated or deleted.

## 7. Alerts

Each alert names a condition, severity, and the runbook in `OPERATIONS.md` §5.

| Alert | Condition | Sev | Runbook |
|---|---|---|---|
| `GateErrorRateHigh` | 5xx > 2% of ingest for 5 m | SEV2 | R-01 |
| `TargetErrorRateHigh` | target 5xx/timeout > 5% for 5 m | SEV2 | R-01 |
| `DbUnavailable` | `aic_dependency_up{dependency="db"} == 0` for 2 m | SEV1 | R-04 |
| `IdentityProviderDown` | `aic_dependency_up{dependency="idp"} == 0` for 5 m | SEV2 | R-14 |
| `OutboxLagHigh` | p95 lag > 30 s for 10 m | SEV2 | R-02 |
| `OutboxDlqNotEmpty` | `aic_outbox_dlq_total > 0` for 15 m | SEV2 | R-02 |
| `AuditChainBroken` | `aic_audit_chain_break_total > 0` | SEV1 | R-05 |
| `AuditAnchorStale` | anchor age > 3 h | SEV2 | R-05 |
| `UnverifiedWrite` | `aic_unverified_write_total > 0` | SEV1 | R-06 |
| `ExecutionUnknownStale` | any execution `UNKNOWN` > 15 m | SEV2 | R-06 |
| `LlmFallbackElevated` | fallback > 10% of investigations for 15 m | SEV3 | R-03 |
| `PolicyHashMismatch` | `aic_policy_stale_rejections_total` rising > 3 in 10 m | SEV2 | R-07 |
| `BreakGlassUsed` | any `USED` elevation | SEV2 | R-09 |
| `HoldSlaBreach` | any case `HOLDING` > 4 h | SEV3 | R-06 |
| `AuthzDeniedSpike` | 403s > 20/min for 10 m | SEV3 | R-10 |
| `ErrorBudgetBurn` | 2% of 30-day budget consumed in 1 h | SEV2 | R-11 |

SEV1 pages immediately (PagerDuty/Opsgenie in a real deployment; for this repository, the alert
handler prints and exits non-zero so CI and the ops drill can assert it). SEV2 pages during business
hours and posts to the incident channel. SEV3 is a ticket.

## 8. Audit correlation and anchoring

- Every `AuditEvent` stores `requestId`, `traceId`, `actorType`, `actorId`, `ip`, `userAgent`,
  `policyVersion`, `policyHash`, and `payload` with ids and hashes only.
- A reviewer can go from `/audit/:id` to the trace (copy `traceId`) and from a trace to the case.
  The UI shows a "copy trace id" control on the audit row and on the case header.
- **Anchoring:** every hour a worker computes the Merkle root of all `AuditEvent.hash` values since
  the previous anchor, writes an `AuditAnchor` row, and uploads `{ fromSeq, toSeq, rootHash,
  previousAnchorHash, anchoredAt }` to an external append-only store (S3 Object Lock by default;
  local development writes `var/anchors/<seq>.json`). The external copy is the third-party proof.
- `npm run audit:verify -- --from <seq> --to <seq>` recomputes the chain and compares each anchor to
  the external object. `AUDITOR` can trigger the same check through `POST /internal/audit/verify`.
- A failed anchor upload is logged, retried by the outbox, and raises `AuditAnchorStale` after 3 h. It
  never blocks a business write by itself; a *broken chain* does freeze writes (R-05).

## 9. Dashboards

Four boards, checked into `ops/dashboards/*.json` as provisionable definitions:

1. **Control plane** — gate decisions by reason, case funnel by status, hold age, decisions/hour,
   fallback rate.
2. **Execution & verification** — executions by kind/status, verification failures, `UNKNOWN` age,
   target latency, restore captures.
3. **Dependencies & pipeline** — DB pool, target 5xx, Gemini latency/429/fallback, outbox lag, DLQ,
   rate-limit rejections.
4. **Accountability** — approvals per case, quorum failures, SoD rejections, break-glass events,
   audit events/min, anchor age, chain-verification age.

The `/app/settings/operations` page (Phase 11) renders the operational subset a reviewer can act on:
outbox and DLQ counts, anchors, dependency health, `UNKNOWN` executions, stale cases. It reads the same
queries as the dashboards, never raw tables.

## 10. Retention and cost

| Signal | Local | Production | Notes |
|---|---|---|---|
| Logs | stdout | 30 days hot, 90 days cold | No PII; hash identifiers |
| Traces | in-memory/none | 7 days | 100% for executions, 10% for reads |
| Metrics | in-process | 13 months | 15 s scrape, 1 m recording rules |
| Audit events | Postgres, forever | Postgres + WORM anchors, forever | Never expires |
| KPI snapshots | Postgres | 24 months | Daily rollups after |

Cost guardrails: metric label values from a closed set; span attributes capped by a schema; no
per-account exemplars; sampling configurable per environment.

## 11. Local development

- `OTEL_SDK_DISABLED=true` and `METRICS_ENDPOINT_ENABLED=0` by default. Logs are pretty-printed when
  `NODE_ENV=development` and `LOG_PRETTY=1`.
- `npm run obs:demo` starts a no-dependency local viewer (a `/metrics` scrape plus the log tail) so a
  reviewer can see the spans without standing up a collector.
- Every failure drill in `FAILURE_MODES.md` prints the metric it moved and the log line it produced;
  a drill that cannot be observed from telemetry is not a drill.

## 12. What is not instrumented (and why)

- The LLM prompt and completion text: sensitive and high-cardinality. Only hashes, token counts,
  model id and prompt version are recorded.
- Individual evidence excerpts and rationales: PII risk. Record length, kind and citation count.
- Per-account target writes in metrics: cardinality. The audit event and target audit row carry the
  account id.
- Business KPIs are not metrics: they are computed from the database by `lib/eval/kpi-service.ts`,
  cached and snapshotted, so the numbers in `/app/analytics` are reproducible after the fact.
