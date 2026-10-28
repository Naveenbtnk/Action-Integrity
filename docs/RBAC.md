# RBAC.md — Roles, permissions, quorum and separation of duties

This file replaces the earlier three-role hierarchy (ADR-016). It is normative for
`lib/rbac.ts`, every route handler, and every test that exercises authorization. A route that is not
in the table in §6 does not ship.

---

## 1. Design rules

1. **Permission-based, deny by default.** A handler asks for a permission, never for a role name.
2. **Server-side only.** The UI hides controls for usability; hiding is not authorization.
3. **Fresh role read.** Roles are read from `User` on every privileged request. A role in the JWT is
   a UI hint and never an authorization source.
4. **Two-axis control.** For write dispositions the decision needs *enough* approvals (quorum, §4)
   from *different* people (separation of duties, §5), and the executor is checked separately.
5. **No platform-admin shortcut.** `ADMIN` cannot approve or execute a business action. Platform
   administration and business accountability are different jobs. The only exception is documented
   break-glass (§8), which still produces two distinct humans.
6. **Every denial is observable.** A denied privileged call writes an `AUTHZ_DENIED` audit event and
   increments `aic_authz_denied_total{permission}`. Denials on read permissions are logged only.

## 2. Principals

### 2.1 Human roles

| Role | Who | Purpose |
|---|---|---|
| `VIEWER` | Support, engineering, stakeholders | Read cases, actions, contracts, KPIs and audit |
| `ANALYST` | Support / operations analyst | Run investigation, request and add evidence, compute policy, escalate |
| `REVIEWER` | Accountable operator | Approve and execute low/medium-risk dispositions and execute an approved high-risk one, verify, reopen, dismiss events |
| `SENIOR_REVIEWER` | Senior operator / owner delegate | Same as `REVIEWER` plus high-risk approvals |
| `ADMIN` | Platform administrator | Users, policy activation, evaluation, reconciliation, anchors. **Cannot decide business actions** |
| `AUDITOR` | Compliance / internal audit | Read everything, verify the audit chain, read ops state. No mutations |

`SENIOR_REVIEWER` is not "seniority of `REVIEWER`" for approval counting: a high-risk case needs one
`SENIOR_REVIEWER` *and* one other approver, and the two must be different users (§4).

### 2.2 Service principals

| Principal | Credential | Scope |
|---|---|---|
| `SERVICE_AGENT` | `x-agent-key: AGENT_SERVICE_KEY` | Ingest, evaluate, source reads |
| `SERVICE_TARGET` | `x-target-key: TARGET_SERVICE_KEY` | Synthetic target namespace only |
| `SERVICE_OPS` | `x-ops-key: OPS_SERVICE_KEY` | Reconciliation, outbox drain, audit anchoring, KPI snapshot |

Service principals cannot hold console sessions; console sessions cannot call `/target/*` or
`/internal/*`. Keys are compared with `crypto.timingSafeEqual` and are never accepted from a cookie.

## 3. Permission catalogue

| Permission | Kind | What it allows |
|---|---|---|
| `case:read` | read | Lists and details, report, evidence, timeline |
| `action:read` | read | Held actions and their gate decisions |
| `contract:read` | read | Contract registry and snapshot hashes |
| `integrity:read` | read | Integrity events |
| `kpi:read` | read | Computed KPI windows |
| `audit:read` | read | Audit events and single-event chain proof |
| `policy:read` | read | Active policy document, version and hash |
| `eval:read` | read | Evaluation runs and results |
| `user:read` | read | User directory |
| `ops:read` | read | Outbox, DLQ, anchors, dependency health |
| `integrity:dismiss` | write | Dismiss an integrity event with a reason |
| `case:investigate` | write | Start or force an investigation |
| `case:request_evidence` | write | Create an evidence request |
| `case:add_evidence` | write | Append evidence |
| `case:compute_policy` | write | Recompute the deterministic policy decision |
| `case:approve` | privileged | Record an approval |
| `case:approve_high` | privileged | Record an approval on a high-risk case |
| `case:execute` | privileged | Execute an approved disposition |
| `case:execute_high` | privileged | Execute a high-risk disposition |
| `case:verify` | write | Run verification |
| `case:reopen` | write | Reopen a closed case |
| `case:escalate` | write | Escalate or hand off |
| `kpi:refresh` | write | Bypass the KPI cache and persist a snapshot |
| `eval:run` | write | Start an evaluation run |
| `policy:activate` | privileged | Activate a new policy version |
| `user:manage` | privileged | Create, deactivate, change roles |
| `ops:reconcile` | write | Run reconciliation |
| `ops:outbox` | write | Drain or replay outbox / DLQ |
| `ops:anchor` | write | Anchor the audit chain |
| `audit:verify` | write | Run chain verification over a range |
| `break_glass:request` | privileged | Open an incident elevation |
| `break_glass:cosign` | privileged | Co-sign someone else's elevation |
| `break_glass:read` | read | View emergency access records; ADMIN and AUDITOR only |
| `service:ingest` | service | `POST /actions/ingest` |
| `service:evaluate` | service | `POST /integrity/evaluate` |
| `service:source_read` | service | `/sources/*` |
| `service:target_read` | service | `GET /target/*` |
| `service:target_write` | service | `POST /target/*` |

## 4. Role → permission matrix

`✓` granted · `—` not granted.

| Permission | VIEWER | ANALYST | REVIEWER | SENIOR_REVIEWER | ADMIN | AUDITOR |
|---|---|---|---|---|---|---|
| `case:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `action:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contract:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `integrity:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `kpi:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `policy:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `eval:read` | — | — | — | — | ✓ | ✓ |
| `user:read` | — | — | — | — | ✓ | ✓ |
| `ops:read` | — | — | — | — | ✓ | ✓ |
| `integrity:dismiss` | — | — | ✓ | ✓ | — | — |
| `case:investigate` | — | ✓ | ✓ | ✓ | — | — |
| `case:request_evidence` | — | ✓ | ✓ | ✓ | — | — |
| `case:add_evidence` | — | ✓ | ✓ | ✓ | — | — |
| `case:compute_policy` | — | ✓ | ✓ | ✓ | — | — |
| `case:escalate` | — | ✓ | ✓ | ✓ | — | — |
| `case:approve` | — | — | ✓ | ✓ | — | — |
| `case:approve_high` | — | — | — | ✓ | — | — |
| `case:execute` | — | — | ✓ | ✓ | — | — |
| `case:execute_high` | — | — | ✓ | ✓ | — | — |
| `case:verify` | — | — | ✓ | ✓ | — | — |
| `case:reopen` | — | — | ✓ | ✓ | — | — |
| `kpi:refresh` | — | — | — | — | ✓ | — |
| `eval:run` | — | — | — | — | ✓ | — |
| `policy:activate` | — | — | — | — | ✓ | — |
| `user:manage` | — | — | — | — | ✓ | — |
| `ops:reconcile` | — | — | — | — | ✓ | — |
| `ops:outbox` | — | — | — | — | ✓ | — |
| `ops:anchor` | — | — | — | — | ✓ | — |
| `audit:verify` | — | — | — | — | ✓ | ✓ |
| `break_glass:request` | — | — | — | — | ✓ | — |
| `break_glass:cosign` | — | — | — | — | ✓ | — |
| `break_glass:read` | — | — | — | — | ✓ | ✓ |

Service permissions are held only by service principals and are never granted to a human role.

## 5. Quorum and approval binding

### 5.1 Required approvals

Computed deterministically by `lib/policy` and persisted on `PolicyDecision` as
`requiredApprovals` / `requiredRoles`; the approver screen reads them from there, never from a
constant in the UI.

| Condition | Approvals | Required roles |
|---|---|---|
| Disposition writes and (`risk ≥ 70` or `exposureCount ≥ 250`) | 2 | ≥ 1 `SENIOR_REVIEWER`, the other any approver |
| Disposition writes below that threshold | 1 | any approver |
| `BLOCK`, `SAFE_REFUSAL`, `ESCALATE`, `HOLD_FOR_EVIDENCE` | 1 | any approver |

Seniority is an *approval* control, not an execution one: any `REVIEWER` may execute an approved
high-risk disposition, provided they are not one of its approvers (§6).

"Disposition writes" means `RELEASE_AFTER_CORRECTION` or `COMPENSATE`. `ALLOW` at ingest needs no
human approval: it is a deterministic gate decision and the executor performs the write. A `BLOCK`
acknowledgement needs one approver and performs no target write, but completing the block is still a
post-approval step: §6 applies, so a different reviewer completes it.

### 5.2 Approval record

An `Approval` is bound to the decision it reviewed:

- `boundEvidenceHash` — hash of the ordered evidence set at approval time;
- `boundPolicyHash` — `PolicyDecision.policyHash` at approval time;
- `boundDisposition` — the disposition being approved (the `Approval.disposition` column);
- `boundReportId` — the report the approver saw;
- `expiresAt` — approval window, default 12 h from the first approval in the lifecycle;
- `status` — `VALID | SUPERSEDED | EXPIRED | REVOKED`.

Unique `(caseId, reopenCount, reviewerId)`: one approval per reviewer per lifecycle. Two approvals
from the same user are `DUPLICATE_APPROVER` (409), not a quorum.

### 5.3 Invalidation

Adding evidence, re-running the investigation, or activating a different policy **supersedes every
`VALID` approval on the case** in the same transaction. The case moves `APPROVED → AWAITING_APPROVAL`
and the UI shows why.

At `POST /cases/:ref/execute` the executor re-checks, in order: quorum count, role coverage, approval
`status = VALID` and `expiresAt > now`, `boundEvidenceHash` equals the current evidence hash,
`boundPolicyHash` equals the active policy hash and `boundDisposition` equals the decision. Any
mismatch fails closed with a specific 409 (§7). An approval is never "close enough".

### 5.4 Rejection

A single `REJECT` with rationale ends the lifecycle: `AWAITING_APPROVAL → REJECTED`. Other recorded
approvals are marked `REVOKED`. A rejection is not outvoted; re-deciding requires new evidence or a
reopen, and the audit trail keeps the dissenting rationale.

## 6. Separation of duties

| Rule | Checks | Error |
|---|---|---|
| The actor taking the post-approval step (write or block completion) is not an approver of that case lifecycle | `Approval.reviewerId != session.user.id` for all valid approvals | 409 `APPROVER_CANNOT_EXECUTE` |
| Quorum approvals come from distinct users | count of distinct `reviewerId` | 409 `APPROVAL_QUORUM_NOT_MET` |
| A reviewer who recorded `OVERRIDE` cannot approve or execute the same case | `Approval.decision = OVERRIDE` by actor | 409 `REVIEWER_CONFLICT` |
| Break-glass execution requires a co-signed approval | elevation `ACTIVE` **and** a `breakGlass` approval by the co-signer | 409 `BREAK_GLASS_INCOMPLETE` |
| Evidence authors do not approve their own decisive evidence | `EvidenceItem.addedById` set equals approver and report leans on it | 409 `REVIEWER_CONFLICT` |

The last rule is deliberately narrow: a reviewer may add supporting evidence and then approve, but if
the same person authored *every* item the report cites, approval requires a different reviewer. This
avoids blocking normal triage while preventing a single author from manufacturing a case.

There is no configuration flag to disable these rules. A demo or pilot that cannot field a reviewer
plus a senior uses break-glass (§8), which still requires two distinct admins.

## 7. Errors

| Code | Status | When |
|---|---|---|
| `FORBIDDEN` | 403 | Authenticated, permission missing |
| `USER_INACTIVE` | 403 | Deactivated account |
| `INVALID_SERVICE_CONTEXT` | 403 | Console session on a service route or the reverse |
| `APPROVAL_QUORUM_NOT_MET` | 409 | Execute with fewer valid approvals than required |
| `APPROVER_CANNOT_EXECUTE` | 409 | Executor is an approver |
| `DUPLICATE_APPROVER` | 409 | Same reviewer approves twice in one lifecycle |
| `APPROVAL_EXPIRED` | 409 | Approval window elapsed |
| `APPROVAL_CONFLICT` | 409 | Two approvals name different dispositions |
| `EVIDENCE_CHANGED` | 409 | Evidence hash differs from the approval binding |
| `POLICY_STALE` | 409 | Active policy hash differs from the approval binding |
| `REVIEWER_CONFLICT` | 409 | Separation-of-duties rule in §6 |
| `BREAK_GLASS_INCOMPLETE` | 409 | Elevation not co-signed, expired, or wrong case |

`CASE_ALREADY_APPROVED` is removed. Two reviewers approving concurrently is normal quorum behaviour,
not an error; the second approval is appended. Only a duplicate by the *same* reviewer is rejected.

## 8. Break-glass

Use only when a high-risk case cannot meet quorum because a required role is unavailable and waiting
would itself cause harm. It does not waive the verifier, the gate, the policy hash check, or the
evidence-completeness check.

1. `ADMIN` opens `POST /admin/break-glass` with `{ caseRef, reason ≥ 50 chars, ttlMinutes ≤ 60 }`.
   State `PENDING_COSIGN`, scope is that one case, expires in 15 min if not co-signed.
2. A **different** `ADMIN` calls `POST /admin/break-glass/:id/cosign`. The co-signature records an
   `Approval` with `breakGlass = true`, `decision = APPROVE`, and the co-signer as reviewer. That
   counts toward quorum and satisfies the required-role check for that lifecycle only. On a high-risk
   case it occupies the `SENIOR_REVIEWER` slot but is still **one** approval: quorum needs a distinct
   reviewer approval as well, so a high-risk break-glass execution needs three humans (co-signer,
   approver, requester).
3. The requester — and only the requester — may execute, within the TTL. §6 still holds: the
   co-signer approved, the requester executes.
4. `PENDING_COSIGN` → `DENIED` on timeout, `ACTIVE` → `EXPIRED` on TTL or `REVOKED` on revoke, `USED` after execution.
5. Every transition writes an audit event and increments `aic_break_glass_total{state}`. Any
   `USED` elevation pages security and requires `AUDITOR` review within 24 h, recorded in
   `docs/audits/break-glass-<date>.md` (outside the repo if it names people).
6. Hard limits: one active elevation per admin, one case per elevation, no self co-sign, no elevation
   on a case the admin is investigating, and break-glass cannot activate policy or edit users.

An elevation never changes `Case.status` on its own; it only supplies approvals.

## 9. Enforcement

- `lib/rbac.ts` exports `ROLES`, `ROLE_PERMISSIONS`, `PERMISSIONS`, `ROUTE_PERMISSIONS` and
  `requirePermission(session | serviceContext, permission)`.
- `requirePermission` is called at the top of every handler, before body parsing. A handler that
  lacks it fails `tests/api/envelope.test.ts`.
- `ROUTE_PERMISSIONS` is a literal list of `{ method, pattern, permission, service? }`. At startup,
  `assertRouteCoverage()` compares it against the filesystem list of `src/app/api/**/route.ts`; a
  missing or extra entry throws at boot and fails CI.
- Permission checks and business-conflict checks are separate functions: `requirePermission` lives
  in `lib/rbac.ts`; `assertQuorum` and `assertSeparationOfDuties` are exported from `lib/approval`
  and called by the handler. SoD failures are business conflicts (409), not authorization failures.
- `User.roles` is `Role[]`; a user may hold `REVIEWER` and `AUDITOR`, and permissions are the union.
  `ADMIN` + `SENIOR_REVIEWER` is **forbidden** by a database check — the platform administrator
  cannot also be a business approver.

## 10. Tests

| Test | Assertion |
|---|---|
| `tests/rbac/matrix.test.ts` | For every role × route, the decision matches §4/§6; unlisted route fails startup |
| `tests/rbac/quorum.test.ts` | 0/1/2 approvals, duplicate approver, missing senior, expired window, stale evidence, stale policy |
| `tests/rbac/sod.test.ts` | Approver executing, override author approving, break-glass without co-sign, admin with senior role rejected at write time |
| `tests/rbac/break-glass.test.ts` | Full lifecycle, self co-sign rejected, TTL expiry, scope limited to one case, audit events written |
| `tests/api/envelope.test.ts` | Missing permission ⇒ 403 envelope with stable `requestId`; no stack trace |
| `tests/audit/authz.test.ts` | Privileged denial writes exactly one `AUTHZ_DENIED` event |

All tests use real Postgres. No test mocks `requirePermission`.

## 11. Provisioning and review

- Users are created by `npm run seed` (development only) or `POST /admin/users` (`ADMIN`, audited).
  OIDC users are provisioned on first login with the role in the `roles` claim, mapped by allowlist;
  unknown role claims are rejected, never defaulted.
- Role changes force session invalidation (`User.sessionEpoch` bumped; JWT carries the epoch and a
  mismatch returns 401).
- Quarterly access review: `GET /admin/users?reviewDue=1` produces the list; `AUDITOR` records the
  outcome in `docs/audits/access-review-<quarter>.md`. Inactive accounts are deactivated, not deleted,
  so audit references stay resolvable.

## 12. Residual gaps

| Gap | Impact | Owner |
|---|---|---|
| No attribute-based or row-level scoping | Single organisation only | Add `organisationId` before multi-tenant |
| Break-glass trusts two admins to behave | Collusion possible | Out-of-band approval + auditor review |
| Role provisioning via OIDC claim mapping is allowlist-only | No SCIM lifecycle automation | Add SCIM before large rollout |
| UI does not yet show the full permission matrix | Reviewers may not know why a button is absent | Phase 8 surfaces the reason from the 403 `details` |
