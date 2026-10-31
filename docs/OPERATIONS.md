# OPERATIONS.md — Environments, release, incidents and runbooks

The operating manual for running Action Integrity. `FAILURE_MODES.md` describes what breaks;
this file describes who does what when it does. If a runbook step is not possible with the shipped
scripts, the script is missing and the phase is not done.

---

## 1. Environments

| Environment | Purpose | Data | Identity | Writes to target |
|---|---|---|---|---|
| Local | Development, demo | Seeded synthetic (`SEED=20261026`) | Credentials | Yes, local target stub |
| Preview | Per-PR review | Ephemeral seeded DB | Credentials, seeded users | Yes, preview target stub |
| Staging | Release rehearsal, drills | Seeded synthetic, refreshed weekly | OIDC + seeded service keys | Yes, staging target stub |
| Production | Real use | Real or pilot records | OIDC only, credentials disabled | Yes, real adapter |

Rules:

- Every environment has its own `TARGET_SERVICE_KEY`, `AGENT_SERVICE_KEY`, `OPS_SERVICE_KEY` and
  database. A key from one environment is rejected in another (the key id is prefixed with the env).
- `NODE_ENV=production` disables seeded passwords, `ALLOW_DB_RESET`, `ALLOW_DEMO_RESET`, debug routes
  and pretty logs. Startup fails if any is set.
- Production data never leaves production. No database dump into staging; use the seed fixtures there.
- The demo/Vercel deployment is a **production-shaped demo**, not a production instance: it runs with
  seeded synthetic data and `INVESTIGATION_MODE=agent`. Its `SECURITY.md` gaps still apply.

## 2. Scheduled jobs

All jobs are idempotent, take an advisory lock, and write an audit event per changed row.

| Job | Cadence | Entry point | Lock |
|---|---|---|---|
| Reconcile | 60 s | `POST /internal/reconcile` (`SERVICE_OPS`) | `reconcile` |
| Outbox drain | 10 s or continuous worker | `npm run outbox:drain` / `/internal/outbox/drain` | `outbox:<shard>` |
| Approval expiry | 5 min | part of reconcile | `reconcile` |
| Audit anchor | hourly | `POST /internal/audit/anchor` | `anchor` |
| Audit chain verify | daily 02:00 + after every migration | `npm run audit:verify -- --full` | `audit-verify` |
| KPI snapshot | hourly | `POST /internal/kpis/snapshot` | `kpi` |
| Dependency probes | 30 s | in-process | — |
| Idempotency cleanup | daily | delete `IdempotencyRecord` older than 30 days, never audit | `cleanup` |

A missed job is detected by absence: every job writes a heartbeat row and emits
`aic_job_last_success_timestamp`. Two missed intervals raise SEV3; the audit verify and reconcile jobs
raise SEV2.

## 3. Release process

### 3.1 Pull request gates

Required, in order, and all blocking:

1. `npm run typecheck` · `npm run lint`
2. `npm run test:unit` · `npm run test:integration`
3. `npm run test:failure` (subset tagged `pr`; full suite nightly)
4. `npm run test:rbac` · `npm run test:envelope`
5. `npx prisma migrate diff --from-schema-datasource … --exit-code` — migrations in sync
6. `npm run check:secrets-scope` · `npm run check:policy-hash`
7. `npm audit --production --audit-level=high`
8. Deterministic eval suite: 13/13, no metric regression beyond `config/metrics.json` tolerance

### 3.2 Migration policy

- **Forward-only.** Never edit an applied migration. Never `prisma db push` outside local.
- **Expand → migrate → contract**, one release apart:
  - release N: add nullable columns/tables, dual-write if needed;
  - release N+1: backfill and switch reads;
  - release N+2: drop the old column, in a release that contains no other schema change.
- A migration that rewrites a large table uses batched backfill in a script, not a single `UPDATE`.
- `CONCURRENTLY` for new indexes on populated tables; otherwise the deploy holds a write lock.
- Migrations run against the **direct** database URL before the app is promoted. A failed migration
  aborts the release; it never leaves the app ahead of the schema.
- Every release records `{ gitSha, migrationNames, policyHash, promptVersion }` in the deploy log.

### 3.3 Promotion

1. Merge to `main` → build → deploy to staging.
2. Run `npm run smoke -- --base-url=<staging>` and `npm run eval:deterministic`.
3. Run the drill tagged for this release (at minimum `drill:target-down` on any executor change,
   `drill:audit-break` on any audit change, `drill:restore` quarterly).
4. Promote to production with 10% of traffic (platform canary or a second deployment).
5. Watch `aic_gate_decisions_total`, 5xx rate, `aic_outbox_lag_seconds`,
   `aic_unverified_write_total` for 30 minutes.
6. Full traffic. Record the release in the change log with the approver.

### 3.4 Rollback

- **Application:** redeploy the previous image. Safe because migrations are expand-only and the
  previous version ignores new nullable columns.
- **Policy:** register the previous rules as a new reviewed `DRAFT` version, then activate that new
  version with its hash and review ticket. Retired policy documents remain immutable. Activation
  supersedes open approvals and returns approved cases to `AWAITING_APPROVAL`.
- **Schema:** no down-migrations. A destructive change requires an incident, a PITR restore (R-12) and
  an incident commander decision. Never "fix forward" a data-loss migration on production.
- **Feature that cannot be disabled:** if a release cannot be rolled back within 15 minutes, it does
  not ship.

## 4. Incident management

### 4.1 Severity

| Sev | Definition | Response | Comms |
|---|---|---|---|
| SEV1 | Harm occurred or is imminent: unverified write, broken audit chain, gate bypass, data loss, credentials exposed | Page immediately, incident commander in 5 min, freeze consequential writes | Status page + stakeholder update every 30 min |
| SEV2 | Core path degraded: target down, DB degraded > 5 min, outbox DLQ, anchor stale > 3 h, break-glass used | Page in business hours, IC in 15 min | Update every 2 h |
| SEV3 | Partial degradation with a workaround: LLM fallback elevated, one stuck case, authz denial spike | Ticket, next business day | Daily summary |
| SEV4 | Cosmetic, single-user issue, doc error | Backlog | — |

The invariant tripwires in `OBSERVABILITY.md` §6 are SEV1 by definition, even if the blast radius
looks small.

### 4.2 Roles

- **Incident commander (IC):** decides, does not debug. Any `ADMIN` or `SENIOR_REVIEWER` on call.
- **Operations lead:** runs runbooks, owns the timeline.
- **Scribe:** records timestamps, commands, decisions in the incident doc.
- **Comms lead:** external updates. For SEV1, a different person from the IC.
- **Auditor:** joins every SEV1 within 24 h; may not be the IC.

### 4.3 Post-incident

Within 5 business days: a blameless review with a timeline, customer impact, root cause, the control
that failed, the control that caught it, and action items with owners and dates. Action items are
recorded in `DEPLOYMENT_STATUS.md` or the release issue tracker.

## 5. Runbooks

Each runbook follows the same shape: **S**ymptoms → **I**mmediate → **D**iagnose → **R**ecover →
**V**erify. Commands assume production env vars are present and the operator has `ADMIN` or
`SERVICE_OPS`.

### R-01 — Target unavailable or gate errors

- **S:** `TargetErrorRateHigh`, `GateErrorRateHigh`, executions `UNKNOWN`, ingest 5xx.
- **I:** Confirm `aic_dependency_up{dependency="target"}`. If 0, stop approving executions; do not
  retry failed writes. Post an internal notice.
- **D:** Check target adapter logs for `TARGET_UNAVAILABLE`; check network/DNS; confirm
  `AIC_BASE_URL` and key id. Verify the target's own audit table is reachable.
- **R:** Restore the target. Circuit breaker closes after two successful probes. Drain any outbox
  backlog (R-02). Do **not** replay writes; run reconcile then verify each affected case.
- **V:** `npm run smoke`; `aic_executions_total{status="UNKNOWN"}` stops rising; affected cases show a
  verification result.

### R-02 — Outbox backlog or DLQ

- **S:** `OutboxLagHigh`, `OutboxDlqNotEmpty`, downstream effects missing (anchors, notifications).
- **I:** Determine whether the business transaction committed (it did — the outbox is post-commit).
  Do not re-run the business action.
- **D:** `GET /internal/outbox?status=DLQ` — inspect `failureCode` and attempt count. A validation
  failure means a code bug; a 5xx means the dependency.
- **R:** For a dependency outage, wait and let the publisher drain. For a poison event, fix the bug,
  deploy, then `POST /internal/outbox/:id/replay` (idempotent). Inspect the consumer result before
  replaying more than one.
- **V:** `aic_outbox_pending == 0` for 10 minutes; DLQ count 0; the consumer's own record exists.

### R-03 — LLM outage or cost spike

- **S:** `LlmFallbackElevated`, `aic_llm_requests_total{outcome="error"}` rising, fallback > 10%.
- **I:** Do nothing to the gate. Holds continue; fallback reports cannot yield `ALLOW`.
- **D:** Check Gemini status, quota, key validity and `aic_llm_tokens_total` against baseline. A 429
  with healthy quota means concurrency, not capacity.
- **R:** Reduce investigation concurrency; if the circuit is open, wait for half-open. Re-investigate
  cases with `isFallback=true` once healthy — `POST /cases/:ref/investigate` with `force`.
- **V:** fallback < 2%; a re-investigated case shows a native report; token spend back to baseline.

### R-04 — Database unavailable or degraded

- **S:** `DbUnavailable`, ingest 503, console 5xx, connection pool exhausted.
- **I:** The system is already fail-closed: no writes without a DB. Confirm `L3_DB_DEGRADED` on
  `/health`. Do not switch to a local store or disable audit.
- **D:** Provider status; connection count by state; long-running queries (`pg_stat_activity`);
  failover state. Check whether the pool is exhausted by a slow query rather than by load.
- **R:** Kill the offending query, fail over, or wait for the provider. Scale the pool only after
  confirming the query plan. On failover, expect ambiguous commits: run reconcile and check
  idempotency records.
- **V:** `/health` `db: "ok"`; ingest 201; `aic_dependency_up{dependency="db"} == 1`; audit chain verify
  passes.

### R-05 — Audit chain broken or anchor stale

- **S:** `AuditChainBroken` (SEV1) or `AuditAnchorStale`.
- **I:** Declare SEV1. Consequential writes are frozen at `L4_AUDIT_BROKEN`. Preserve the database:
  no repairs, no deletes, snapshot immediately.
- **D:** `npm run audit:verify -- --full` to find the first broken `seq`. Compare with `AuditAnchor`
  roots to identify the range and the time. Check whether the immutability trigger exists and is
  enabled; a missing trigger is a migration or manual-change incident.
- **R:** For a stale anchor, restore the object-store credential and run `POST /internal/audit/anchor`.
  For a broken chain, restore the affected range from the external anchor + PITR backup into a
  forensic copy, then rebuild the chain forward under IC direction. Never silently "rehash".
- **V:** verify reports `chain_ok` over the full range; anchors match the external objects; writes
  unfrozen only after `ADMIN` acknowledgement and an audit event recording who unfroze and why.

### R-06 — Stuck case or `UNKNOWN` execution

- **S:** `ExecutionUnknownStale`, `HoldSlaBreach`, a case sitting in `VERIFYING` or `HOLDING`.
- **I:** Do not close the case. Do not re-execute.
- **D:** Read the case timeline; check the execution row (`status`, `startedAt`, `attemptCount`), the
  target audit row and the current target state. If the target shows the write, this is F-06; if not,
  F-04/F-14.
- **R:** Run reconcile, then `POST /cases/:ref/verify`. Observed == expected ⇒ execution `SUCCEEDED`,
  case closes. Mismatch ⇒ `REOPENED`, investigate. Inconclusive after two reads ⇒ escalate to the
  owner; the case stays open.
- **V:** Execution terminal (`SUCCEEDED`/`FAILED`), a `VerificationResult` exists, case status is
  consistent, audit events written.

### R-07 — Policy activation and stale policy

- **S:** `PolicyHashMismatch`, `POLICY_STALE` at execute, approvals suddenly superseded.
- **I:** Stop activating. Existing approvals remain valid only for the hash they bound.
- **D:** `GET /admin/policy` — compare active version/hash with `config/policy/<version>.json` and the deploy
  log. Confirm the activation was intended and reviewed.
- **R:** Activate the intended `DRAFT` version (requires a review ticket id and `ADMIN`). Cases return to
  `AWAITING_APPROVAL`; notify reviewers. If the wrong version is live, register the correct rules as
  a new reviewed version and activate it.
- **V:** `/health.policyHash` matches the intended version; `aic_policy_stale_rejections_total` stops;
  open cases have fresh approvals.

### R-08 — Service key rotation

- **S:** Scheduled rotation, suspected exposure, or a key-id mismatch in logs.
- **I:** Do not delete the old key yet. Set `TARGET_SERVICE_KEY_PREVIOUS` (and the matching
  `*_PREVIOUS` for agent/ops) to the old value, deploy the new value as current.
- **D:** Confirm both keys work; check which callers still present the old key id.
- **R:** Update callers (target stub, cron, external agent). After 24 h, remove the previous key and
  redeploy. Rotate one principal at a time.
- **V:** Old key returns 401; new key works; `npm run smoke` passes; audit has `KEY_ROTATED` events.

### R-09 — Break-glass used

- **S:** `BreakGlassUsed`, an `ACTIVE` elevation older than 15 min, or a co-sign request in the channel.
- **I:** Confirm the case, the reason, and the two admins. Verify the elevation is scoped to one case
  and under 60 min.
- **D:** Read `GET /admin/break-glass/:id` and the case timeline. Confirm the co-signer is not the
  requester and the approval is bound to the current evidence and policy hashes.
- **R:** If the elevation is not justified, revoke it immediately and escalate to the IC. If used,
  ensure execution was verified and the case closed correctly; AUDITOR review within 24 h.
- **V:** Elevation terminal (`USED`/`EXPIRED`/`DENIED`), audit events present, review recorded.

### R-10 — Authorization denial spike

- **S:** `AuthzDeniedSpike`, a user reports missing buttons, or a 403 storm after a deploy.
- **I:** Determine whether it is a bug (role mapping, migration) or an attack (credential probing).
- **D:** Break down `aic_authz_denied_total` by permission and actor; check `sessionEpoch` bumps and
  recent role changes; check for a single IP hitting many routes.
- **R:** Fix the mapping and redeploy; or block the source at the edge and rotate credentials. Never
  grant `ADMIN` as a quick fix.
- **V:** Denials return to baseline; the affected user can perform their role; no privilege widening
  recorded.

### R-11 — Error budget burn

- **S:** `ErrorBudgetBurn` at 2% of the 30-day budget in one hour.
- **I:** Treat as SEV2. Identify the SLO that is burning (gate availability, execution latency, outbox).
- **D:** Open the relevant dashboard, correlate with deploys and dependency incidents.
- **R:** Roll back the last deploy if the burn started with it. Otherwise mitigate the dependency.
- **V:** Burn rate back under 1×; a follow-up action item exists even if the cause was external.

### R-12 — Restore from backup (DR)

- **S:** Data loss, a destructive migration, or a quarterly drill.
- **I:** Declare SEV1 if production. Freeze writes. Record the target restore timestamp with the IC.
- **D:** Identify the last known good time before the damage; verify the backup and WAL window cover it.
- **R:** `npm run drill:restore -- --to <timestamp> --target scratch` first. Validate: row counts, the
  demo fingerprint, the audit chain, and a sample of cases/executions. Then repeat against production
  under IC direction. Point the app at the restored database only after validation.
- **V:** `npm run audit:verify -- --full` passes; `npm run smoke` passes; RPO ≤ 5 min and RTO ≤ 60 min
  measured and recorded.

### R-13 — Failed or stuck migration

- **S:** Deploy aborts at `prisma migrate deploy`; migration lock held; schema half-applied.
- **I:** Do not retry blindly. Do not drop the `_prisma_migrations` row.
- **D:** Inspect the failed migration and `pg_locks`. Determine whether the statement committed (DDL
  in Postgres is transactional, so a failed migration usually rolled back cleanly).
- **R:** Fix forward with a new migration. If the lock is held by a dead session, terminate that
  session, not the database. If data was partially backfilled, resume the batched script idempotently.
- **V:** Migration status clean, app boots, smoke passes, audit verify passes.

### R-14 — Identity provider outage

- **S:** `L5_IDENTITY_DEGRADED`; new logins fail; existing sessions still work.
- **I:** Confirm service keys are unaffected; the gate and executor continue. Do not re-enable password
  login in production.
- **D:** IdP status page, OIDC discovery latency, clock skew on the app host.
- **R:** Wait for the IdP; keep existing sessions until expiry. If a critical approval is blocked,
  use break-glass (R-09), not a shared account.
- **V:** New login succeeds; roles resolve from claims; no fallback credential path exists.

## 6. Backup and disaster recovery

- Postgres managed with PITR, WAL archived continuously; RPO ≤ 5 min.
- Daily full backup retained 35 days; monthly retained 12 months; audit anchors retained indefinitely
  and stored outside the database provider account.
- Quarterly restore drill: restore to a scratch instance, run the fingerprint and audit verification,
  record RPO/RTO in `PRODUCTION_READINESS.md` §4. A drill that is skipped means the release gate is
  not met, not that it passes.
- Restores are validated before cutover; a restore that cannot verify the audit chain is not a restore.

## 7. Secrets and access

| Secret | Holder | Rotation | Notes |
|---|---|---|---|
| `TARGET_SERVICE_KEY` | executor + target auth | 90 days | Dual-key overlap 24 h |
| `AGENT_SERVICE_KEY` | external ingest agent | 90 days | Same overlap scheme |
| `OPS_SERVICE_KEY` | cron/worker | 90 days | Cannot decide cases |
| `DATABASE_URL` | app, migrations | provider-managed | Separate pooled/direct URLs |
| `AUTH_SECRET` | Auth.js | 180 days | Rotation invalidates sessions |
| `OIDC_CLIENT_SECRET` | Auth.js | 180 days | IdP-managed |
| `GEMINI_API_KEY` | investigator only | 90 days | Read-only scope where available |
| `ANCHOR_STORE_*` | anchor worker | 180 days | Write-only to the bucket prefix |

- No secret in the repository, in logs, in a prompt, or in a client bundle. `check:secrets-scope`
  fails CI if `TARGET_SERVICE_KEY` is referenced outside `lib/env.ts`, `lib/executor/*`,
  `lib/target/auth.ts`.
- Production access is just-in-time, named accounts, no shared logins. Break-glass accounts are
  hardware-key protected.
- Quarterly access review (§11 in `RBAC.md`); leavers are deactivated the same day.

## 8. Capacity

Planning assumptions for a pilot: 5,000 accounts, ~40 outbound actions/day, 13 evaluation scenarios,
1–5 concurrent reviewers, 2 investigation workers.

| Resource | Sizing | Scale signal |
|---|---|---|
| Web | 2 instances, 0.5 vCPU / 1 GB | p95 latency, 5xx |
| Worker (outbox/reconcile/anchor) | 1 instance, leader-elected by advisory lock | outbox lag |
| Postgres | 2 vCPU / 4 GB, 20 connections/app | pool wait, slow queries |
| Gemini concurrency | 4 | 429 rate, investigation p95 |

Scale out web first; the executor is serialized per case, not globally. Never raise DB connections
without checking the provider limit; use a pooler.

## 9. Cost controls

- `aic_llm_tokens_total` per case target < 20k input+output; alert at 2× the 7-day median.
- Investigation is rate-limited per case (3 / 10 min) and cached; force re-investigation requires a
  reason.
- Outbox and audit tables grow; partition audit by month only after 10M rows, with a migration plan.
- Evaluation runs are capped (`EVAL_MAX_CONCURRENCY=2`) and never run on production data.

## 10. Routine calendar

| Cadence | Task | Owner |
|---|---|---|
| Daily | Review `/app/settings/operations`, DLQ, UNKNOWN executions, failed anchors | On-call |
| Weekly | Dependency updates, audit log spot check | Eng |
| Monthly | Restore backup to scratch and verify | Ops |
| Quarterly | Access review; DR drill; break-glass review | Security + Ops |
| Semi-annual | Incident tabletop (audit break, target compromise) | IC rotation |
| Annual | External penetration test; policy review | Security |

## 11. Operational definition of done

A phase or release is operationally done only when:

1. Every new failure path maps to a row in `FAILURE_MODES.md` and has a test.
2. Every new alert maps to a runbook above and has been fired once in staging.
3. Dashboards show the new path; the log line and span exist.
4. The runbook was executed by someone who did not write the code, and their corrections are merged.
5. `PRODUCTION_READINESS.md` §3 evidence column was updated — or the item is explicitly deferred.
