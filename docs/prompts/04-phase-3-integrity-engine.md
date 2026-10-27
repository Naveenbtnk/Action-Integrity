# Phase 3 — Integrity engine

**Read first:** `docs/ARCHITECTURE.md` §3 (`lib/integrity`), `docs/BACKEND_SCHEMA.md` §6,
`docs/PRD.md` §4 M1, `docs/EVALUATION.md` §5 (`I-freshness-breach`, `L-cross-source-invariant`).
**Goal:** detect a failure that schema validation alone misses, deterministically and idempotently.
**Depends on:** Phase 2 green.

## Scope guard

No cases, no gate, no LLM, no UI. Checks are pure functions over snapshots. `lib/integrity` must not
import `lib/db` (the caller persists), `lib/agent`, or any adapter — add the source-scan test now.

## Build

1. `src/lib/integrity/types.ts`: `CheckInput = { contract, snapshot, relatedSnapshots? }`,
   `CheckResult = { violated, checkType, severity, summary, scopeSelector, evidenceRefs[] }`.
2. Five pure checks in `src/lib/integrity/checks/`. The contract's field role selects the value check:
   a non-empty `semanticDefinition` ⇒ `semantic-check`; otherwise `enum-check`. At most one value
   check event per contract per evaluation.
   - `schema-check.ts` — required fields present and `schemaHash` matches the contract ⇒ else `SCHEMA`.
   - `enum-check.ts` — observed values ⊄ (`expectedValues` ∪ `aliasMap` keys) ⇒ `ENUM`.
   - `semantic-check.ts` — observed values ⊄ (`expectedValues` ∪ equivalent aliases) on a contract
     with `semanticDefinition` ⇒ `SEMANTIC`. This is the check that catches `CURRENT`.
   - `freshness-check.ts` — `capturedAt - sourceUpdatedAt > freshnessSlaSeconds` ⇒ `FRESHNESS`.
   - `cross-source-check.ts` — a declared `DataContract.invariants` rule fails ⇒ `CROSS_SOURCE`.
3. `src/lib/integrity/evaluate.ts`:
   ```
   evaluateContracts(keys?) →
     for each ACTIVE contract: capture SourceSnapshot (hash payloads) →
     run applicable checks → diff against IntegrityEvent.fingerprint
     → insert only new events → return { evaluated, eventsCreated, eventsSuppressed, events[] }
   ```
   One transaction per contract. Re-evaluating unchanged data creates nothing. A failed source read
   fails that contract's evaluation closed (no event invented, error surfaced), and never blocks the
   other contracts.
4. `POST /api/v1/integrity/evaluate` — `service:evaluate`, rate limit 6/min per agent key, body
   `{ contractKeys?: string[] }`, response per `API.md` §6.2.
5. `GET /api/v1/integrity/events` — `integrity:read`, `status`/`severity`, cursor pagination.
6. `POST /api/v1/integrity/events/:id/dismiss` — `integrity:dismiss` (`REVIEWER`,
   `SENIOR_REVIEWER`), reason required, exactly one `INTEGRITY_DISMISSED` audit event.
7. Contract seed refinement: `billing.plan_status` declares `expectedValues: ["ACTIVE","SUSPENDED"]`,
   empty `aliasMap`, a non-empty `semanticDefinition`, and `contract.entitlement_status` declares the
   cross-source invariant used by fixture L. Keep the injection text in the support fixture as data.
8. Logging: one `integrity.checks` span per run with contract count and events created; no payload
   excerpts in logs.

## Acceptance criteria

- [ ] A snapshot containing `planStatus: "CURRENT"` produces exactly one `SEMANTIC` event whose
      `scopeSelector` names the affected accounts and whose `evidenceSnapshotIds` is non-empty.
- [ ] Running evaluate twice on unchanged data creates zero new events (`eventsSuppressed = n`).
- [ ] A fresh source with unchanged values produces zero events.
- [ ] A source older than its SLA produces exactly one `FRESHNESS` event.
- [ ] Billing `ACTIVE` + contract `SUSPENDED` produces exactly one `CROSS_SOURCE` event.
- [ ] A failed source read produces an error response and no partial event rows.
- [ ] Dismiss without a reason is 400; `ANALYST`/`VIEWER` dismiss is 403; `AUDITOR` is 403.
- [ ] `lib/integrity` imports no `lib/db`, `lib/agent` or adapter (source-scan test).
- [ ] One audit event per dismiss, none per suppressed event.

## Verification

```bash
npm run test:unit -- integrity
npm run test:integration -- evaluate dismiss
curl -s -X POST -H "x-agent-key: $AGENT_SERVICE_KEY" -H 'content-type: application/json' \
  -d '{"contractKeys":["billing.plan_status"]}' localhost:3000/api/v1/integrity/evaluate | jq
```

## Commit

`feat(integrity): pure contract checks with idempotent event emission`

## Stop

Report per `AGENTS.md` §6. Do not build the gate.
