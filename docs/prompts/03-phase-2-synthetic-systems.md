# Phase 2 — Synthetic enterprise systems

**Read first:** `docs/ARCHITECTURE.md` §3 (`lib/adapters`, `lib/target`), `docs/API.md` §6.9,
`docs/SECURITY.md` §3, `docs/FAILURE_MODES.md` F-04/F-05, `docs/DECISIONS.md` ADR-005, ADR-023.
**Goal:** five read-only source systems and one writable target that behave like real systems —
including slow, failed and lost responses — behind a swappable interface.
**Depends on:** Phase 1 green.

## Scope guard

No integrity checks, no gate, no cases, no agent. Adapters and their HTTP surface only. Production
code outside `src/lib/executor` must not import the target adapter's write method (tests may, to
exercise it directly). No retry inside the target write path.

## Build

1. `src/lib/adapters/types.ts`:
   ```ts
   export interface SourceAdapter {
     key: 'contract' | 'billing' | 'usage' | 'support' | 'account';
     fetchRecords(q: SourceQuery): Promise<SourceRecord[]>;
     describe(): Promise<SourceDescriptor>;
   }
   export interface TargetAdapter {
     getEntitlement(accountId: string, key: string): Promise<EntitlementState | null>;
     getServiceStatus(accountId: string): Promise<ServiceStateRecord | null>;
     captureRestorePoint(ref: TargetRef): Promise<RestorePointPayload>;
     applyChange(change: TargetChange, idempotencyKey: string): Promise<TargetWriteResult>;
     restoreFromSnapshot(ref: TargetRef, snapshot: unknown, idempotencyKey: string): Promise<TargetWriteResult>;
   }
   ```
   `TargetWriteResult = { status: 'SUCCEEDED'|'FAILED'|'UNKNOWN'; response: unknown; failureCode?: string }`.
   Supporting shapes live here, not duplicated in callers: `TargetRef`, `TargetChange`,
   `RestorePointPayload`, `SourceQuery`, `SourceRecord`, `SourceDescriptor`.
2. Five source adapters reading only their own `src_*` tables. `describe()` returns a stable schema
   hash (SHA-256 over sorted field names + types), row count and `capturedAt`. Source reads have a
   5 s timeout and **may** be retried once (SAFE_READ); they never mutate.
3. Target as a service behind its own HTTP boundary:
   - `src/lib/target/service.ts` owns all `tgt_*` reads/writes: `captureRestorePoint` hashes current
     state; `applyChange` writes inside a transaction and inserts `tgt_audit` with the idempotency
     key; `restoreFromSnapshot` restores exactly the declared fields; a replay returns the original
     result, never a second write;
   - `src/lib/adapters/target/http-client.ts` implements `TargetAdapter` over HTTP with
     `x-target-key`, `TARGET_TIMEOUT_MS` (default 10 s) and `traceparent` propagation. It takes
     `{ baseUrl, serviceKey }` as arguments and never reads env, so the credential stays in
     `lib/executor`;
   - the client never retries `applyChange`/`restoreFromSnapshot`. A timeout or aborted response is
     `UNKNOWN`; a non-2xx with a committed row is `UNKNOWN`; a pre-commit error is `FAILED`.
4. `src/lib/adapters/test-hooks.ts`: `setFailureMode('timeout' | 'after-commit' | 'before-commit' |
   'slow')`, inert in production (`NODE_ENV=production` throws). `after-commit` returns `UNKNOWN`;
   `before-commit` returns `FAILED` with no row change.
5. Routes under `src/app/api/v1`:
   - `GET /sources/[source]/records?accountId=&limit=` — agent key, projection only;
   - `GET /target/entitlements?accountId=&key=`, `GET /target/service-status?accountId=`,
     `GET /target/restore-point?targetObjectType=&accountId=&key=`;
   - `POST /target/entitlements/change`, `POST /target/service-status/change`,
     `POST /target/entitlements/restore`, `POST /target/service-status/restore` — target key only
     (`requireTargetKey`, timing-safe compare), `Idempotency-Key` required, return
     `{ result, auditId, beforeState }`. Writes echo `requestId` into `tgt_audit`.
6. `src/lib/adapters/registry.ts`: `getSource(key)` is the only source construction point. The target
   adapter has no global singleton; only `lib/executor` may construct it.
7. Integration tests: read one account from each source; apply a change; re-read; replay the key and
   assert exactly one `tgt_audit` row and one state change; assert each source exposes only declared
   fields; assert a source read cannot mutate; assert `tgt_*` is written only from
   `lib/target/service.ts` and the write method is imported only by `lib/executor/*` and tests.

## Acceptance criteria

- [ ] A change through the target adapter is visible on re-read and recorded in `tgt_audit` with
      `beforeState`, `afterState`, `requestId`.
- [ ] Replaying the same key performs no second write and returns the original result.
- [ ] `after-commit` yields `UNKNOWN`; `before-commit` yields `FAILED` with unchanged state.
- [ ] No automatic retry occurs on either write failure (assert one target call).
- [ ] A `/target/*` write with the agent key returns 403; console cookies are rejected.
- [ ] A source read cannot mutate any row (transaction test).
- [ ] Source-scan test proves the `tgt_*` boundary and the executor-only import.
- [ ] Restore point round-trips: capture → change → restore → state hash equals the captured hash.

## Verification

```bash
npm run test:integration -- adapters target failure
npm run test:unit -- target-http
curl -s -H "x-agent-key: $AGENT_SERVICE_KEY" \
  "localhost:3000/api/v1/sources/billing/records?accountId=acc_00042" | jq
```

## Commit

`feat(adapters): five source adapters and idempotent, fail-closed target system`

## Stop

Report per `AGENTS.md` §6. Do not implement integrity checks.
