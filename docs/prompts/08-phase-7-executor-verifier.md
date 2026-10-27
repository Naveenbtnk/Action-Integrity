# Phase 7 — Executor, verifier and reconciliation

**Read first:** `docs/ARCHITECTURE.md` §3 and §7, `docs/FAILURE_MODES.md` §2–§4 and F-04–F-18,
`docs/API.md` §6.4, `docs/SECURITY.md` §3, `docs/DECISIONS.md` ADR-007, ADR-013, ADR-023.
**Goal:** exactly one module writes, at most once, and a separate module proves the business state is
correct — including when the target response is lost.
**Depends on:** Phase 6 green.

## Scope guard

Only `lib/executor/*` may construct the target client and call `applyChange` /
`restoreFromSnapshot`. The client receives `{ baseUrl, serviceKey }` from the executor; it never reads
env. Verification reads the target — it never trusts the write response. **No automatic retry of a
write.** A `BLOCK` performs no target write. No UI.

## Build

1. `src/lib/executor/restore-point.ts`: `capture(action)` reads current state through the adapter and
   persists `RestorePoint` (state + `stateHash`) before every write, including the `ALLOW` path at
   ingest. Capture failure aborts the write (fail closed).
2. `src/lib/executor/execute.ts`:
   ```
   execute({ caseRef, kind: 'RELEASE' | 'RESTORE_LAST_KNOWN_GOOD' | 'BLOCK', actor })
   ```
   In one transaction before any network call, re-check: `case.status = APPROVED`; quorum and role
   coverage (`assertQuorum`); approval `status = VALID` and `expiresAt > now`; `boundEvidenceHash` =
   current; `boundPolicyHash` = active; `boundDisposition` = decision; approver ≠ the actor taking
   this step (write or block completion);
   break-glass completeness; degradation level does not forbid writes (`L2`/`L3`/`L4` ⇒ 503
   `DEGRADATION_BLOCKED`); no other execution in flight (`ALREADY_EXECUTING`).
   Then commit an `ActionExecution` row `PENDING` (intent), **commit**, make **one** target call, and
   commit the result `SUCCEEDED | FAILED | UNKNOWN`. Never wrap the network call in a DB transaction.
   - timeout, aborted response, or non-2xx after a committed target row ⇒ `UNKNOWN`;
   - pre-commit error ⇒ `FAILED`, state unchanged;
   - `kind = BLOCK` ⇒ no restore point, no target call, no `ActionExecution`; mark action `BLOCKED`,
     release the hold, audit, transition `APPROVED → VERIFYING`. The approver is still refused this
     step (`APPROVER_CANNOT_EXECUTE`); a different reviewer performs it and the response carries
     `noTargetWrite: true`;
   - idempotency key `release:<actionId>` or `comp:<caseId>:<reopenCount>:<targetRef>`; replay returns
     the original execution.
   `UNKNOWN` is a valid result, not an error. It never counts as recovered and blocks closure.
3. `src/lib/executor/reconcile.ts`:
   - `PENDING` executions older than `EXECUTION_TIMEOUT_MS` (default 120 s) ⇒ `UNKNOWN`, case
     `VERIFYING`, audit with before/after;
   - expired `EvidenceRequest` ⇒ `EXPIRED`, case `ESCALATED`;
   - overdue approvals ⇒ `EXPIRED`, case `AWAITING_APPROVAL`;
   - orphan outbox events republished (publisher lands in Phase 11).
   Idempotent. Exposed as `npm run reconcile:executions` and `POST /internal/reconcile`
   (`ops:reconcile`), with `JobHeartbeat` updates.
4. `src/lib/executor/compensation-eligibility.ts`: `{ eligible, reason }`; false for irreversible
   action types, missing restore point, or a target object that no longer exists.
5. `src/lib/verifier/verify.ts`: build `expectedState` from the restore point (compensation), the
   released payload (release), or `payload.from` (block). Read the target (up to 2 attempts, SAFE_READ
   only); compare declared fields; persist `VerificationResult` with `expectedState`,
   `observedState`, `mismatches[]`, `passed`.
   - `passed` ⇒ `CLOSED_RESOLVED`;
   - `failed` ⇒ `REOPENED`, `EscalationEvent`, outbox notification, recovery not counted;
   - if the target cannot be read after all attempts, write **no** verification row, transition to
     `ESCALATED`, return `502 TARGET_UNAVAILABLE`;
   - resolve an `UNKNOWN` execution: `observed == expected` ⇒ `SUCCEEDED`,
     `resolvedByVerification = true`; else `FAILED`.
6. Outbox: enqueue `CASE_REOPENED`, `CASE_ESCALATED`, `CASE_VERIFIED` events in the same transaction
   as the transition. No publisher yet; Phase 11 delivers.
7. Routes: `POST /cases/:ref/execute` (`case:execute`; high risk also `case:execute_high`),
   `/verify` (`case:verify`), `/reopen` (`case:reopen`), and wire `POST /actions/ingest` `ALLOW` to
   the real write path. All mutations require `Idempotency-Key`.
8. Metrics: `aic_executions_total{kind,status}`, `aic_target_requests_total{operation,outcome}`,
   `aic_unverified_write_total` (increment only on a write attempted without a passing verification
   path — must stay zero), `aic_verifications_total{result,disposition}`,
   `aic_verification_duration_seconds`. Span `execution.execute` and `verification.read` with
   `caseRef` and `outcome`.
9. Tests: double execute with one key ⇒ one write; adapter `after-commit` ⇒ `UNKNOWN` and no retry;
   compensation without restore point ⇒ 409 + `SAFE_REFUSAL`; verification mismatch ⇒ `REOPENED`;
   role/quorum/SoD failures ⇒ no target row; crash between intent and call ⇒ reconcile + verify.

## Acceptance criteria

- [ ] Scenario A closes `CLOSED_RESOLVED` only after `verification.passed === true`; entitlement stays
      `ACTIVE`; zero `ActionExecution` rows; zero target writes.
- [ ] Scenario B restores from the restore point and verifies `ServiceState.ENABLED`; the executor is
      a different person from both approvers.
- [ ] Scenario D: success response with unchanged state ⇒ `passed: false`, `REOPENED`, recovery
      counter unchanged.
- [ ] Scenario E: no restore point ⇒ `409 NO_RESTORE_POINT`, `SAFE_REFUSAL`, zero target writes.
- [ ] Lost response (`after-commit`) ⇒ `UNKNOWN`, one target call, execute disabled until verification
      resolves it.
- [ ] Verification of the lost-response case resolves the execution to `SUCCEEDED` or `FAILED`; the
      case never closes on the unknown.
- [ ] Two sequential executes with one key ⇒ one write, same execution returned; a parallel execute
      returns `409 ALREADY_EXECUTING`.
- [ ] Every precondition failure (`APPROVAL_QUORUM_NOT_MET`, `APPROVER_CANNOT_EXECUTE`,
      `APPROVAL_EXPIRED`, `EVIDENCE_CHANGED`, `POLICY_STALE`, `BREAK_GLASS_INCOMPLETE`,
      `DEGRADATION_BLOCKED`) writes no `tgt_*` row.
- [ ] Reconcile turns a stale `PENDING` into `UNKNOWN`, and no retry occurs automatically.
- [ ] Source-scan proves `tgt_*` writes exist only in `lib/target/service.ts`, the write method is
      imported only by `lib/executor/*` (and tests), and `TARGET_SERVICE_KEY` is read only in
      `lib/env.ts` and `lib/executor/*`.

## Verification

```bash
npm run test:failure -- execute verify reconcile
npm run test:integration -- executor verifier
npm run test:scenarios -- --scenario=B
npm run test:scenarios -- --scenario=D
npm run test:scenarios -- --scenario=E
npm run reconcile:executions -- --dry-run
```

## Commit

`feat(executor): at-most-once writes, UNKNOWN resolution and business-state verification`

## Stop

Report per `AGENTS.md` §6. Do not build the console.
