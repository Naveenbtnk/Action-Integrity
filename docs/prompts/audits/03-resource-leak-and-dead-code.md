# Read-only audit 3 — Resource leaks, dead code and silent failure

**Mode:** READ ONLY. No edits, no deletions, no refactors. Stop after the report and wait for
explicit approval.

## Setup

Read `docs/ARCHITECTURE.md`, `docs/CODE_STYLE.md`, `AGENTS.md`, then inspect `src/lib/*`, the route
handlers, the eval runner, the reconciliation job, the adapters and the tests.

## Scope

1. **Resource leaks**
   - Prisma connections: pool size, transaction longevity, `$disconnect` in scripts, leaks in
     long-running jobs and in the eval runner.
   - Open handles: timers, intervals, unresolved promises, polling loops in the console and in the
     scenario runner, unbounded SSE or streaming.
   - Memory: full-table reads, unbounded `findMany`, evidence payloads held in memory, eval fixtures
     accumulating across scenarios, in-process rate-limit and cache maps with no eviction.
   - Files and network: temp files not cleaned, adapter HTTP clients without timeouts, retries that
     multiply requests, and any retry that can reach a target write.
   - Workers: outbox drain loops, anchor and reconciliation schedulers — overlapping runs, missing
     locks, unbounded batches, timers that survive shutdown, and a DLQ replay that re-runs work.
2. **Duplicate and dead code**
   - Duplicate SQL or metric computation outside `lib/eval/metrics.ts`.
   - A second write path to `tgt_*`, a second state-transition implementation, a second source of
     policy thresholds outside `lib/policy` + `config/policy.json`.
   - A second quorum, approval-binding or separation-of-duties implementation outside
     `lib/approval`; approval state written outside its transaction; an approval stored without its
     bound evidence/policy/report/disposition hashes.
   - An outbox effect published outside the business transaction, or a fire-and-forget side effect
     that bypasses `OutboxEvent`.
   - Dead exports, unreachable branches, unused env vars, abandoned routes, leftover debug logging or
     `console.log` with payloads.
   - Test-only paths reachable in production.
3. **Silent failure**
   - Swallowed errors (`catch {}`), missing `await`, floating promises, fire-and-forget writes.
   - Fail-open behaviour where the spec requires fail-closed (gate, verifier, rate limiter, auth,
     quorum, degradation, anchor verification).
   - A held action or stuck case with no owner, no deadline and no alert; an approval waiting on a
     missing senior with no reminder; a `PENDING_COSIGN` break-glass request that never expires.
   - Verification that passes on an API 200 without reading state; a timeout recorded as `FAILED`
     instead of `UNKNOWN`; an `UNKNOWN` execution closed without a verification read.
   - Metrics that can silently return zero and be displayed as a real result.
4. **Time and ordering**
   - Timezone handling (UTC storage vs local rendering), clock assumptions, createdAt vs business time.
   - Ordering assumptions in the evidence timeline and the audit chain.
   - Pagination cursors that can skip or repeat rows.

## Required format per finding

```
[SEVERITY] CRITICAL | HIGH | MEDIUM | LOW
[STATUS]   CONFIRMED | UNVERIFIED
[CLASS]    MISSING | BROKEN | MISCONFIGURED | UNVERIFIED
[LOCATION] file:line
[EVIDENCE] quoted code and the specific path that triggers it
[FAILURE CHAIN] what degrades, in what order, and what the user or operator sees
[IMPACT] correctness / availability / cost / auditability
[TRIGGER] the exact condition
[DETECTION] what would reveal it today
[PREVENTION] the smallest structural fix, not a rewrite
[RECOVERY] how to restore correct behaviour and state
```

Do not report unused variables or naming preferences. Only report something as dead if you have
searched the whole repository for its references and state the search you ran.

## Report sections

1. CRITICAL — can corrupt business state or close a case falsely
2. HIGH
3. MEDIUM / LOW
4. SINGLE-WRITER AND SINGLE-TRANSITION-OWNER CHECK — every write/transition site listed, with any
   violation named
5. RESOURCE BUDGET TABLE — per process: connections, timers, caches, and their bounds
6. SILENT-FAILURE MAP — every catch/swallow site and what it hides
7. DEAD-CODE INVENTORY — file, reason, reference search performed
8. TOP 10 FIX PRIORITIES
9. SCORE with rubric stated

Save as `docs/audits/<YYYY-MM-DD>-resource-dead-code.md`. Stop after writing the report.
