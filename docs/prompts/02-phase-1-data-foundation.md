# Phase 1 — Data foundation

**Read first:** `docs/BACKEND_SCHEMA.md` (all of it), `docs/DATABASE.md` §2–§5,
`docs/DECISIONS.md` ADR-006, ADR-010, ADR-016–ADR-023.
**Goal:** every table, enum and constraint exists, is migrated, and is seeded deterministically.
**Depends on:** Phase 0 green.

## Scope guard

No business logic, no routes beyond health, no UI. Do not add fields that are not in
`BACKEND_SCHEMA.md`. If a field seems missing, report it — do not invent it. Append-only and
role-conflict rules are database constraints in this phase, not conventions for later.

## Build

1. `prisma/schema.prisma`: all enums and models from `BACKEND_SCHEMA.md` §2–§12, with `@@map` to
   `snake_case` singular tables and `@map` on multi-word columns. Money is `BigInt`; JSON is `Json`;
   timestamps `@db.Timestamptz`. Include, at minimum:
   - `Role = VIEWER | ANALYST | REVIEWER | SENIOR_REVIEWER | ADMIN | AUDITOR`;
   - `ApprovalStatus = VALID | SUPERSEDED | EXPIRED | REVOKED`;
   - `PolicyStatus = DRAFT | ACTIVE | RETIRED`;
   - `OutboxStatus = PENDING | PUBLISHING | DELIVERED | FAILED | DLQ`;
   - `BreakGlassStatus = PENDING_COSIGN | ACTIVE | USED | EXPIRED | DENIED | REVOKED`;
   - `DegradationLevel = L0_NORMAL … L5_IDENTITY_DEGRADED`;
   - `ActorType = SYSTEM | AGENT | USER | SERVICE`.
2. User and approval model:
   - `User.passwordHash` nullable, `roles Role[]`, `oidcSubject?`, `sessionEpoch Int @default(0)`;
   - `Approval` carries `boundEvidenceHash`, `boundPolicyHash`, `boundReportId`, `disposition`,
     `expiresAt`, `status`, `breakGlass`, `elevationId?`, `reopenCount`.
3. Migration 1 — base schema (`prisma migrate dev --name init`).
4. Migration 2 — constraints Prisma cannot express (raw SQL):
   - `CREATE UNIQUE INDEX action_hold_open_unique ON "action_hold" ("outbound_action_id") WHERE "released_at" IS NULL;`
   - `CREATE UNIQUE INDEX policy_version_one_active ON "policy_version" ("status") WHERE "status" = 'ACTIVE';`
   - `Approval(caseId,reopenCount,reviewerId)`, `IdempotencyRecord(scope,key)`,
     `AuditAnchor(fromSeq,toSeq)`, and `JobHeartbeat(job)` are already unique in the Prisma schema.
   - `ALTER TABLE "user" ADD CONSTRAINT user_admin_not_business CHECK (NOT ('ADMIN'::"Role" = ANY("roles") AND "roles" && ARRAY['REVIEWER','SENIOR_REVIEWER','AUDITOR']::"Role"[]));`
   - `reject_mutation()` trigger on `audit_event`, `investigation_report`, `verification_result`,
     `escalation_event`, `audit_anchor`; direct psql `UPDATE`/`DELETE` must raise, not silently no-op;
   - approval trigger: only `status` may change after insert;
     any other column update raises. A status change still writes an audit event in application code.
5. `src/lib/db.ts`: implement the immutability extension for the four append-only models
   (`ImmutableRecordError`) and for `PolicyVersion` documents once `ACTIVE`.
6. `prisma/seed.ts`: deterministic PRNG (`SEED=20261026`). Build:
   - 5,000 accounts (`acc_00001`…) across three segments and three regions;
   - ~12,000 `tgt_entitlement` rows (`SSO` on ~60%);
   - 8 `DataContract` rows including `billing.plan_status` (`expectedValues: ["ACTIVE","SUSPENDED"]`,
     empty `aliasMap`, non-empty `semanticDefinition`, owner `billing-platform`) and
     `contract.entitlement_status` (owner `contract-ops`);
   - matching `src_*` rows for all five sources;
   - **7 users**: `viewer`, `analyst`, `reviewer`, `reviewer2`, `senior`, `admin`, `auditor`; bcrypt
     cost 12; passwords printed once to stdout, never written to a file or log;
   - 40 `OutboundAction` rows: 12 `PENDING`, 26 `EXECUTED`, 2 `COMPENSATED`; all 28
     postwrite actions have a `RestorePoint`;
   - 2 `PolicyVersion` rows (one `ACTIVE` matching `config/policy/2026.10.1.json`, one `RETIRED`),
     both hashes recomputed from the files;
   - 1 baseline `AuditAnchor` covering the seeded audit events;
   - 2 sample `CLOSED_RESOLVED` cases so the KPI page has data;
   - zero `OutboxEvent` and zero `IdempotencyRecord` rows.
7. `src/lib/seed/corpus.ts`: export the generators so the Phase 9 fixture loader reuses them.
8. Seed is idempotent: upsert by natural key; a second run changes no row counts and prints the same
   state fingerprint. `seed:reset` refuses unless the URL ends in `_test` or `ALLOW_DB_RESET=true`.

## Acceptance criteria

- [ ] `npx prisma migrate deploy` on an empty database succeeds from scratch.
- [ ] `npm run seed && npm run seed` leaves identical row counts and fingerprint.
- [ ] Two open holds on one action are impossible (partial index test).
- [ ] Two `ACTIVE` policy versions are impossible (partial index test).
- [ ] The same reviewer cannot hold two approvals in one lifecycle (unique index test).
- [ ] `prisma.auditEvent.update(...)` throws `ImmutableRecordError`; direct SQL `UPDATE` raises.
- [ ] An `ADMIN` + `SENIOR_REVIEWER` insert is rejected by the database check.
- [ ] Updating an `Approval` rationale after insert raises; updating `status` succeeds.
- [ ] Row counts match `docs/DATABASE.md` §3 within ±1%.
- [ ] `npm run seed:reset` refuses a non-`_test` database without `ALLOW_DB_RESET=1`.

## Verification

```bash
npx prisma migrate deploy && npm run seed && npm run seed
npm run test:db -- immutability policy user-roles approval
psql "$DATABASE_URL" -c 'select count(*) from tgt_entitlement;'
```

## Commit

`feat(db): full control-plane schema, production constraints and deterministic seed`

## Stop

Report per `AGENTS.md` §6. Do not build adapters yet.
