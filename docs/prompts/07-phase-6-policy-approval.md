# Phase 6 — Policy, RBAC, quorum and separation of duties

**Read first:** `docs/RBAC.md` (normative, all), `docs/ARCHITECTURE.md` §6,
`docs/BACKEND_SCHEMA.md` §9–§11, `docs/API.md` §6.4–§6.5, `docs/DECISIONS.md` ADR-015–ADR-018.
**Goal:** one deterministic decision, and enough *different* accountable people to authorise it —
with no platform-admin shortcut.
**Depends on:** Phase 5 green.

## Scope guard

No execution (Phase 7). Policy never calls an LLM and never treats model confidence as authority —
confidence is one input to a formula the code owns. No UI beyond returning data. If a rule in
`RBAC.md` seems inconvenient, it is still the rule; stop and report instead of relaxing it.

## Build

1. `config/policy/2026.10.1.json` (canonical JSON, hashed):
   ```json
   {
     "version": "2026.10.1",
     "exposureWindowHours": 24,
     "evidenceCompletenessMinimum": 0.8,
     "confidenceMinimum": 0.7,
     "riskBands": { "approvalRequired": 40, "highRisk": 70 },
     "quorum": { "highRiskApprovals": 2, "exposureThreshold": 250, "approvalWindowHours": 12 },
     "valueThresholdsMinor": { "mandatoryApproval": 2500000 },
     "irreversibleActionTypes": ["ACCOUNT_STATUS_CHANGE"],
     "allowedDispositions": {
       "ENTITLEMENT_REVOKE": ["BLOCK","HOLD_FOR_EVIDENCE","RELEASE_AFTER_CORRECTION","COMPENSATE","ESCALATE","SAFE_REFUSAL"],
       "ENTITLEMENT_GRANT":  ["BLOCK","HOLD_FOR_EVIDENCE","RELEASE_AFTER_CORRECTION","ESCALATE","SAFE_REFUSAL"],
       "ACCOUNT_STATUS_CHANGE": ["BLOCK","HOLD_FOR_EVIDENCE","COMPENSATE","ESCALATE","SAFE_REFUSAL"]
     }
   }
   ```
   `scripts/policy-hash.ts` prints `sha256:` over canonical JSON (sorted keys, UTF-8, no whitespace
   variance). `lib/policy` recomputes it; never trust a stored hash without recomputation.
2. `src/lib/policy/risk.ts`: pure `scoreRisk({ exposureCount, estimatedValueMinor, confidence,
   evidenceCompleteness, actionType, hasRestorePoint }) → 0..100`, documented weights, no clock or
   randomness. Boundary tests at 39/40 and 69/70.
3. `src/lib/policy/evaluate.ts`: `evaluate(caseRow, report, policyVersion)` returns
   `{ riskScore, riskBand, disposition, allowedDispositions, approvalRequired, requiredApprovals,
   requiredRoles, approvalExpiresAt, reasons[], policyHash, evidenceHash, isFallback: false }`.
   Rules in order:
   - `evidenceCompleteness < 0.8` ⇒ `HOLD_FOR_EVIDENCE`; remove every write-permitting disposition;
   - `confidence < 0.7` ⇒ `ESCALATE`, approval required;
   - `BLOCK` on an `EXECUTED` action ⇒ `COMPENSATE`; `COMPENSATE` on a `HELD` action ⇒ `BLOCK`;
   - `COMPENSATE` without a `RestorePoint` ⇒ `SAFE_REFUSAL`;
   - model recommendation outside `allowedDispositions` ⇒ substitute the safest allowed one plus
     `RECOMMENDATION_CONSTRAINED`;
   - required approvals: **1** for `BLOCK`/`SAFE_REFUSAL`/`ESCALATE`/`HOLD_FOR_EVIDENCE`; **2**
     (≥1 `SENIOR_REVIEWER`) for a write when `risk ≥ 70` **or** `exposureCount ≥ 250`; otherwise 1;
   - no `ADMIN` is ever an approver role.
   If no `PolicyVersion` is `ACTIVE`, fail closed with `409 POLICY_UNAVAILABLE` — never fall back to
   a built-in default.
4. `src/lib/policy/persist.ts`: writes `PolicyDecision` + `POLICY_EVALUATED` audit in one transaction.
   The decision pins `policyHash`, `evidenceHash`, `inputsHash`, `requiredApprovals`,
   `requiredRoles`, `approvalExpiresAt`.
5. `src/lib/policy/activate.ts` + `POST /admin/policy/activate` (`policy:activate`, ADMIN):
   verify `version` + `hash` + `reviewTicket`; retire the previous version; activate the new one;
   supersede **every** `VALID` approval on open cases; move those cases `APPROVED →
   AWAITING_APPROVAL`; write `POLICY_ACTIVATED` and an outbox event. A hash mismatch is
   `409 POLICY_HASH_MISMATCH` and changes nothing.
6. `src/lib/approval/`:
   - `record({ caseId, actor, decision, disposition, rationale })` — disposition must be in
     `allowedDispositions` and match any existing `VALID` approval; rationale ≥20 chars for
     `REJECT`/`OVERRIDE`; unique `(caseId, reopenCount, reviewerId)`; binding fields from the current
     decision; `expiresAt = firstApprovalAt + 12 h`;
   - `assertQuorum(caseId, decision)` — distinct `VALID` approvers, role coverage, expiry,
     evidence/policy/report/disposition binding; returns `{ met, current, required, requiredRoles,
     satisfiedRoles, missingRoles }`; short quorum is a returned `met: false`, not a thrown error;
     it throws `APPROVAL_EXPIRED`, `EVIDENCE_CHANGED`, `POLICY_STALE` or `APPROVAL_CONFLICT` when a
     binding is broken. Only the execute precondition converts `met: false` into
     `APPROVAL_QUORUM_NOT_MET`;
   - `assertSeparationOfDuties(caseId, actor)` — approver ≠ the actor taking the post-approval step,
     write or block completion, is always required;
     `APPROVER_CANNOT_EXECUTE`; override author cannot approve or execute (`REVIEWER_CONFLICT`);
     if every cited item was authored by the approver, a different reviewer is required;
   - `reject` ends the lifecycle: other approvals `REVOKED`, case `REJECTED`.
   Quorum is met ⇒ case `APPROVED`. Quorum unmet after an approval is **not an error**; the case
   stays `AWAITING_APPROVAL` and the response shows the missing approvals/roles.
7. `src/lib/rbac.ts`: complete `ROLE_PERMISSIONS` from `RBAC.md` §4 (six roles, `Role[]` union),
   `requirePermission`, `assertRouteCoverage` for every route, and `AUTHZ_DENIED` audit +
   `aic_authz_denied_total{permission}` for privileged denials. `ADMIN` holds no business permission;
   the database already forbids `ADMIN` with reviewer/auditor roles.
8. `src/lib/break-glass/`: request (`ADMIN`, reason ≥50, TTL ≤60, one case, one active per admin),
   co-sign by a **different** `ADMIN` creating a `breakGlass` approval, requester-only execution
   window, revoke, TTL expiry, `PENDING_COSIGN → DENIED` after 15 min, `USED` pages security and
   creates a 24 h auditor task. No self co-sign, no cross-case scope, no policy/user changes.
9. Routes: `POST /cases/:ref/policy`, `/approve`, `/evidence` (supersede approvals on add),
   `/evidence-requests`, `/escalate`; `GET /cases/:ref/approvals`; `GET /admin/policy`;
   `POST /admin/break-glass`, `GET /admin/break-glass` (register, `break_glass:request` or `AUDITOR`),
   `GET /admin/break-glass/:id`, `POST /admin/break-glass/:id/cosign`,
   `POST /admin/break-glass/:id/revoke`. Add the `disposition` filter to `GET /cases` (single value,
   `PolicyDecision.disposition`) for `/app/recoveries`. All mutations require `Idempotency-Key`.
10. Audit types: `POLICY_EVALUATED`, `POLICY_ACTIVATED`, `APPROVAL_RECORDED`,
    `APPROVAL_REJECTED`, `APPROVAL_SUPERSEDED`, `APPROVAL_EXPIRED`, `CASE_ESCALATED`,
    `BREAK_GLASS_REQUESTED|COSIGNED|REVOKED|EXPIRED|USED`, `AUTHZ_DENIED`.

## Acceptance criteria

- [ ] Completeness 0.6 yields `HOLD_FOR_EVIDENCE`, no write-permitting disposition, and 422 on any
      approval that would permit a write.
- [ ] Risk 82: one approval leaves the case `AWAITING_APPROVAL` with `missingRoles:
      ["SENIOR_REVIEWER"]`; a second, distinct senior approval makes it `APPROVED`.
- [ ] The same reviewer approving twice is `409 DUPLICATE_APPROVER`; a second distinct reviewer is
      appended, never 409.
- [ ] `ADMIN` approval is 403; an `ADMIN`+`SENIOR_REVIEWER` user cannot be created; `AUDITOR`
      mutations are 403.
- [ ] Adding evidence after quorum supersedes every `VALID` approval, returns the case to
      `AWAITING_APPROVAL`, and execute later returns `EVIDENCE_CHANGED`.
- [ ] Activating a new policy supersedes approvals and execute returns `POLICY_STALE`; the audit row
      records version and hash.
- [ ] `REJECT` without rationale is 400; a valid reject revokes other approvals and ends the
      lifecycle.
- [ ] Break-glass self co-sign is rejected; a co-signed elevation lets only the requester execute;
      `USED` writes the audit event and the security page.
- [ ] High-risk break-glass: the co-signature fills the senior slot but is one approval; the case
      stays `AWAITING_APPROVAL` until a distinct reviewer approves.
- [ ] Every role × route matches `RBAC.md`; a route absent from `ROUTE_PERMISSIONS` fails startup.
- [ ] A privileged denial writes exactly one `AUTHZ_DENIED` event and increments the counter.
- [ ] `lib/policy` imports neither `lib/agent` nor any adapter (source-scan test).

## Verification

```bash
npm run test:unit -- policy approval
npm run test:rbac
npm run test:integration -- approval break-glass policy-activation
npm run test:scenarios -- --scenario=A --upto=policy
```

## Commit

`feat(policy): pinned policy versions, permission RBAC, quorum approvals and break-glass`

## Stop

Report per `AGENTS.md` §6. Do not execute anything and do not build the UI.
