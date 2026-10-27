# Read-only audit 1 — Failure and deployment consistency

**Mode:** READ ONLY. Do not modify, move, rename, refactor, format or generate code. Do not "fix"
anything. Do not change configuration. After the report, stop and wait for explicit approval.

## Setup

Read `AGENTS.md`, `docs/TRD.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`,
`docs/EVALUATION.md` and then the actual code, migrations, `next.config.ts`, `package.json`,
`docker-compose.yml` and any deploy configuration. Compare **documented** behaviour with
**implemented** behaviour and report every divergence.

## Scope

Find the smallest condition that could cause the largest production failure, across:

- code or build artifact mismatch between local, CI and the deployed environment;
- partial or mixed deploys, stale builds, cached artifacts, and migrations applied out of order;
- env/secret/policy-version mismatch (including `POLICY_VERSION` vs `config/policy.json`, the active
  `PolicyVersion` hash, and `GEMINI_MODEL` differences);
- migration ↔ application incompatibility; a migration that cannot run on a non-empty database;
- route/contract incompatibility between the console, the automation caller and the target adapter;
- feature-flag or mode inconsistency (`INVESTIGATION_MODE` per environment, eval mode passed per run);
- dependency and runtime drift (Node version, Prisma engine, Postgres major version);
- missing startup checks, health checks, rollout gates, smoke tests;
- a rollback that would not restore a working state (migration irreversibility, env drift);
- missing kill-switch or safe stop for ingest, execution, investigation, outbox or anchoring;
- race conditions, duplicate execution, non-idempotent retries, double approval;
- an approval or execution path that can retry a target write, or that maps a timeout to `FAILED`
  instead of `UNKNOWN` without a verification read;
- quorum computed differently in the console, the API and the eval harness, or an approval that
  survives an evidence, report or policy change;
- outbox publish/consume drift: events enqueued but never drained, a DLQ that grows unpaged, a
  consumer deployed at a different version than the producer, or effects published outside the
  business transaction;
- web and worker deployed at different versions, no worker deployed at all, or duplicated schedulers
  (reconciliation, anchoring) without a lock;
- a degradation level that differs between web and worker, or an `L4` chain break that does not
  actually block writes;
- queue/worker/scheduler mismatch (reconciliation job concurrency, advisory locks, anchor cadence);
- cache or storage inconsistency, and in-process rate-limit state across instances;
- monitoring and alerting gaps that allow silent failure (held actions nobody is paged about, a
  zero-tolerance counter that never fires, an unanchored hour head);
- single points of failure and cascading paths (Gemini → fallback → case blocked);
- behaviour during deploy, restart, crash, timeout, DB outage, network loss;
- anything that could corrupt `tgt_*` state, break the audit chain, or expose service credentials.

## Required format per finding

```
[SEVERITY] CRITICAL | HIGH | MEDIUM | LOW
[STATUS]   CONFIRMED | UNVERIFIED
[CLASS]    MISSING | BROKEN | MISCONFIGURED | UNVERIFIED
[LOCATION] exact file / route / migration / env var / config key
[EVIDENCE] what proves it — quote the line, command output or absence
[FAILURE CHAIN] how it reaches production failure, step by step
[IMPACT] users / business state / data / availability / security
[TRIGGER] exact condition required
[DETECTION] what would reveal it, and how fast
[PREVENTION] recommended safeguard
[RECOVERY] rollback or containment requirement
```

Never claim something works without evidence. Never report a speculative item as confirmed. Do not
report style issues.

## Report sections

1. CRITICAL BLOCKERS — must be closed before a demo on a shared URL
2. HIGH-RISK FINDINGS
3. MEDIUM / LOW FINDINGS
4. DEPLOYMENT CONSISTENCY MATRIX — local vs CI vs deployed: code, env, policy version and hash,
   migration head, Node/Postgres versions, web/worker versions
5. FAILURE SCENARIOS AND BLAST RADIUS — ranked by impact × probability × reach
6. WORKER AND SCHEDULER MATRIX — process, interval, lock, batch bound, retry ceiling, DLQ path, and
   what happens to a held action when each one is down
7. DEGRADATION AND FREEZE BEHAVIOUR — what each level (`L0`–`L5`) and an `L4` chain freeze actually
   block, verified rather than claimed
8. MISSING SAFETY GUARDS
9. ROLLBACK AND RECOVERY GAPS
10. TOP 10 FIX PRIORITIES — each one line, ordered by risk
11. PRODUCTION-READINESS SCORE with the scoring rubric stated

Save as `docs/audits/<YYYY-MM-DD>-failure-deployment.md`. Stop after writing the report.
