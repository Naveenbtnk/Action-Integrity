# DATABASE.md — Operations, Migrations and Data Safety

Field-level definitions live in `BACKEND_SCHEMA.md`. This file covers how the database is run,
changed, seeded and protected.

---

## 1. Stack and connection

- PostgreSQL 16. Local: `docker compose up -d db` (host port 15432, db `action_integrity`).
- Cloud: Neon (pooled connection string for the app, direct string for migrations).
- ORM: Prisma 7. Client is a singleton in `lib/db.ts`; no new `PrismaClient()` outside it.
- `DATABASE_URL` from environment only. `.env.example` lists names, never values.
- Rate-limit state lives in Redis in production (`REDIS_URL`); the in-process store is local-only and
  is listed as a gap when Redis is absent.

Two URLs are required in CI: `DATABASE_URL` (test database) and `DIRECT_DATABASE_URL` (migrations).
Tests run against a dedicated database named `action_integrity_test`; the suite truncates it between
scenarios and refuses to run if the URL does not end in `_test`.

## 2. Migration workflow

```bash
npx prisma migrate dev --name <change>     # local: create + apply
npx prisma migrate deploy                  # CI/staging/prod: apply only
npx prisma generate                        # after any schema edit
```

Rules:

1. Never edit an applied migration. Fix forward with a new migration.
2. Never run `prisma migrate reset` against anything but a local or `_test` database. The command
   requires `ALLOW_DB_RESET=true` in env as a second gate.
3. Partial unique indexes, check constraints, triggers and append-only rules are not expressible in
   the Prisma schema → add them in the generated SQL migration and name the migration for them
   (e.g. `20261103120000_action_hold_partial_unique`).
4. **Expand → migrate → contract**, one release apart:
   - release N adds nullable columns/tables and, if needed, dual writes;
   - release N+1 backfills (batched, idempotent) and switches reads;
   - release N+2 drops the old column in a release with no other schema change.
5. New indexes on populated tables use `CREATE INDEX CONCURRENTLY` in a migration marked
   `-- prisma: no-transaction`. A normal `CREATE INDEX` holds a write lock and is a production incident.
6. Production deploy order: migrate → deploy app. The app must tolerate being one migration behind
   for the length of a rolling deploy (additive-only rule). A failed migration aborts the release.
7. Every migration is tested twice: on an empty `_test` database and on a copy of the seeded database
   with representative row counts. A migration that takes a table lock longer than 2 s on the copy is
   rejected.
8. Destructive change (drop table/column, type narrowing) requires an ADR, an export of the affected
   data, and an incident-commander-approved maintenance window. "Fix forward" never means "lose data".

## 3. Seed workflow

```bash
npm run seed            # idempotent, SEED_PROFILE=demo
npm run seed:reset      # truncate + reseed (local/test only)
npm run seed:scenario -- --key=A-prevention-sso-revoke
```

Seed profile `demo` builds:

| Entity           | Volume                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts         | 5,000 (`src_account_registry` + `tgt_account`)                                                                                                         |
| Entitlements     | ~12,000 rows in `tgt_entitlement`                                                                                                                      |
| Contracts        | 8 active `DataContract` rows                                                                                                                           |
| Source records   | contract 12,000 · billing 5,000 · usage 30,000 · support 900                                                                                           |
| Outbound actions | 40 (12 pending, 26 executed, 2 compensated; all 28 postwrite actions have restore points)                                                              |
| Users            | 7: `viewer`, `analyst`, `reviewer`, `reviewer2`, `senior`, `admin`, `auditor`. Two reviewers exist so every write journey can show approver ≠ executor |
| Policy versions  | 2 (one `ACTIVE`, one `RETIRED`) with matching `config/policy/<version>.json`                                                                           |
| Audit anchors    | 1 baseline anchor covering the seed events                                                                                                             |

Seeds are deterministic: a fixed PRNG seed (`SEED=20261026`) drives all generated values, so
scenario assertions stay stable. No real personal data; names are synthetic. The Phase 1 seed
refuses production entirely; a reviewed production identity bootstrap is a later release step.
Local seed passwords are random, printed once on first creation and never written to disk or logs.

`seed:scenario` applies only the delta needed for one evaluation scenario, so the harness can run
13 fixtures sequentially without a full reseed.

`demo:reset` (Phase 13) is the guarded demo variant of `seed:reset`: it refuses without
`ALLOW_DEMO_RESET=1` and a host in `DEMO_DB_HOSTS`, then prints a state fingerprint. Use `seed:reset`
for local development and `demo:reset` before a live walkthrough. Reset never touches the audit chain
outside the demo database; an anchored production ledger is never truncated.

## 4. Transactions and integrity rules

- Every state transition writes `Case` + `AuditEvent` in one transaction (`prisma.$transaction`) and
  locks the case row (`SELECT … FOR UPDATE`).
- Action ingest is a single transaction covering `OutboundAction`, `Case`, `CaseExposedAccount`,
  `ActionHold`, `AuditEvent` and the notification `OutboxEvent`.
- Approval, policy recomputation, evidence append and policy activation all run under the case row
  lock so quorum cannot be counted against a moving evidence set.
- Case execution writes `ActionExecution (PENDING)` + case `EXECUTING` + `OutboxEvent` in one transaction,
  **then** calls the target, **then** writes the result in a second transaction. The transaction
  boundary deliberately stops before the network call: a rollback cannot undo a target write.
- Gate-level `ALLOW` has no case. Its execution and verification rows therefore have nullable
  `caseId`; the intent, pre-write restore point, audit event and outbox event still commit before
  the target call. A compensation stores a second restore point for its own pre-write state.
- A crash between call and result leaves `PENDING`, which the reconciler turns into `UNKNOWN` — never
  success. No code path retries a target write.
- Isolation: default `READ COMMITTED`. Gate decisions, approvals, execution preconditions and
  reconciliation use `SELECT … FOR UPDATE` on the row that guards the invariant. Serializable is used
  only for audit chain append, with one retry on `40001`.
- Advisory locks (`pg_try_advisory_lock`) guard scheduled jobs: `reconcile`, `anchor`, `eval:<mode>`,
  `cleanup`. A job that cannot take its lock exits successfully without work.
- Money: `bigint` minor units. Never `float`. Currency is `USD` in v1 and not configurable per row.

## 5. Indexes that matter

| Index                                                     | Query it serves                           |
| --------------------------------------------------------- | ----------------------------------------- |
| `Case(status, severity, openedAt desc)`                   | investigation queue default sort          |
| `Case(lastTransitionAt desc)`                             | "recently active" filter                  |
| `Case(approvalExpiresAt)`                                 | approval-expiry sweep                     |
| `IntegrityEvent(status, detectedAt desc)`                 | open events list                          |
| `OutboundAction(idempotencyKey)` unique                   | duplicate ingest rejection                |
| `ActionHold(outboundActionId) WHERE releasedAt IS NULL`   | "is this action held?" on every gate call |
| `Approval(caseId, reopenCount, reviewerId)` unique        | quorum counting and duplicate rejection   |
| `PolicyVersion(status) WHERE status='ACTIVE'` unique      | exactly one live policy                   |
| `IdempotencyRecord(scope, key)` unique                    | mutation replay                           |
| `OutboxEvent(status, nextAttemptAt)`                      | publisher claim query                     |
| `ActionExecution(status, startedAt)`                      | stale `PENDING` reconcile                 |
| `tgt_entitlement(accountId, entitlementKey)` unique       | point lookup during verification          |
| `src_usage_event_daily(accountId, featureKey, eventDate)` | activity evidence for one account         |
| `AuditEvent(caseId, createdAt)`                           | case timeline                             |
| `AuditEvent(seq)` unique                                  | chain verification and anchors            |
| `AuditEvent(requestId)`, `AuditEvent(traceId)`            | incident correlation                      |
| `InvestigationReport(caseId, createdAt desc)`             | latest report                             |

Watch for: `CaseExposedAccount` scans on large exposures (a case can cover 5,000 accounts) — always
paginate and select only `accountId, externalRef`.

## 6. Append-only enforcement

- `AuditEvent`, `InvestigationReport`, `VerificationResult`, `EscalationEvent` and `AuditAnchor`:
  Postgres triggers raise an exception on `UPDATE`/`DELETE`.
- `tgt_audit` is append-only by the same mechanism; the target service only inserts.
- Prisma client extension (`lib/db.ts`) throws `ImmutableRecordError` before the query is sent.
- `Approval` is not append-only: its `status` changes to `SUPERSEDED`/`EXPIRED`/`REVOKED`. The decision
  fields (`reviewerId`, `decision`, `disposition`, `rationale`, bounds, `createdAt`) are immutable via
  a trigger that permits changes only to `status`.
- A CI test asserts both layers reject mutation, and that the trigger exists and is enabled. The test
  disables the trigger in a throwaway schema to prove the detection path works, then restores it.

## 7. Retention and archival

| Table                                                       | Retention           | Mechanism                                        |
| ----------------------------------------------------------- | ------------------- | ------------------------------------------------ |
| `AuditEvent`, `AuditAnchor`                                 | Forever             | Monthly partitions after 10M rows; never deleted |
| `Case`, `Approval`, `ActionExecution`, `VerificationResult` | 7 years             | Archive to cold storage, keep keys               |
| `IdempotencyRecord`                                         | 30 days             | Nightly delete                                   |
| `OutboxEvent` delivered                                     | 30 days             | Nightly delete; DLQ kept until replayed          |
| `JobHeartbeat`, `DegradationState`                          | 90 days             | Nightly delete                                   |
| `KpiSnapshot`                                               | 24 months           | Daily rollup after                               |
| `SourceSnapshot`                                            | 90 days             | Keep the ones referenced by cases                |
| Logs / traces                                               | 30–90 days / 7 days | See `OBSERVABILITY.md` §10                       |

Archival is a copy, not a move, for audit-linked rows: an auditor must always be able to resolve a
`caseRef` and an audit `seq`.

## 8. Production safety

- No `DROP`, no destructive `ALTER` without a documented expand/contract plan.
- Backups: PITR with continuous WAL; RPO ≤ 5 min, RTO ≤ 60 min (`OPERATIONS.md` R-12). A restore is
  validated by row counts, the demo fingerprint and `npm run audit:verify -- --full` before cutover.
- Never repair source data. If a source is wrong, that is evidence for a case, not a migration.
- The evaluation harness runs against a separate database in CI, never against the demo database.
- The demo/Vercel database is synthetic-only and may be reset; it must never hold real records.

## 9. Reset and recovery

| Situation                      | Procedure                                                               |
| ------------------------------ | ----------------------------------------------------------------------- |
| Local DB broken                | `npm run seed:reset` (guarded)                                          |
| Failed migration mid-way       | `prisma migrate resolve --rolled-back <name>`, fix forward; R-13        |
| Execution left `PENDING`       | `POST /internal/reconcile` — marks `UNKNOWN`, then verify; R-06         |
| Outbox event poisoned          | Inspect, fix, `POST /internal/outbox/:id/replay`; R-02                  |
| Audit chain break              | Freeze writes, snapshot, verify range, restore from anchor + PITR; R-05 |
| Accidental data loss           | PITR restore into a scratch DB, validate, then cut over; R-12           |
| Demo corruption before a pitch | `npm run demo:reset` — full reset + reseed + replay fixture set         |

## 10. Schema-change checklist (attach to the PR)

1. Migration is additive or expand/contract; no destructive statement without an ADR.
2. `BACKEND_SCHEMA.md` updated in the same PR; Prisma model matches 1:1.
3. New table has its append-only/immutability decision recorded.
4. New index has a query it serves and was created `CONCURRENTLY` if the table is populated.
5. New enum value has a handler for old rows and a migration default where needed.
6. Seed and fixtures updated; `seed:reset` still produces the documented fingerprint.
7. `npx prisma migrate diff` clean; migration tested on a seeded copy.
8. Audit chain verification passes after the migration; anchors still resolve.
9. Rollback story written in the PR (app rollback is expected; schema rollback only via PITR).
10. If the change touches `AuditEvent` or the chain algorithm, a new anchor algorithm version is
    declared and the old verifier remains able to read old ranges.
