# APP_FLOW — Navigation, Roles and User Journeys

**Roles:** `VIEWER`, `ANALYST`, `REVIEWER`, `SENIOR_REVIEWER`, `ADMIN`, `AUDITOR`.
The UI asks `can(permission)`; it never branches on a role name. `RBAC.md` is normative for who may
do what — this file describes what a person sees, in what order, and which state each surface handles.

Seeded users (development only): `viewer@aic.local`, `analyst@aic.local`, `reviewer@aic.local`,
`reviewer2@aic.local`, `senior@aic.local`, `admin@aic.local`, `auditor@aic.local`. `reviewer2` is the
second accountable operator: every write journey ends with an executor who did not approve.

`UI_UX_BRIEF.md` is normative for the visual layer (layout, tokens, typography, components, copy,
motion). This file defines routes, permissions, journeys and the states each surface must handle.
State labels are mapped to the real enums in `UI_UX_BRIEF.md` §6; the enum, not the label, is the
contract.

---

## 1. Pages

Every authenticated page lives under `/app`. `/` is the public product introduction, not the landing
page for signed-in operators. Routes and their visual specification are in `UI_UX_BRIEF.md` §3.

| Route | Purpose | Permission | Who sees it |
|---|---|---|---|
| `/` | Public product introduction | public | unauthenticated |
| `/trust` | Security and operating model, including known gaps | public | unauthenticated |
| `/login` | Sign-in (OIDC and, in dev, credentials) | public | unauthenticated |
| `/app/overview` | **Default landing** — posture and the next piece of work | `case:read` | all roles |
| `/app/actions` | Action Queue — pending, held, released, blocked, executed | `action:read` | all roles |
| `/app/actions/[actionId]` | Why one action is allowed, held or blocked | `action:read` | all roles |
| `/app/investigations` | Investigation queue (active, evidence, approval, reopened, escalated) | `case:read` | all roles |
| `/app/investigations/[caseId]` | Investigation workspace with decision record and execution | `case:read` | all roles |
| `/app/evidence` | Evidence Explorer (per-case graph) and contract registry entry | `case:read` + `contract:read` | all roles |
| `/app/recoveries` | Recovery queue | `case:read` | all roles |
| `/app/recoveries/[caseId]` | Recovery run and verification plan | `case:read` | all roles |
| `/app/verification` | Business-state closure queue | `case:read` | all roles |
| `/app/policies` | Active policy, hash and history | `policy:read` | all roles (activate: `ADMIN`) |
| `/app/policies/[policyId]` | Policy version detail and activation | `policy:read` | all roles (activate: `ADMIN`) |
| `/app/integrations` | Integration capabilities and data contracts | `contract:read` | all roles |
| `/app/integrations/[integrationId]` | Integration or contract detail | `contract:read` | all roles |
| `/app/audit` | Audit ledger and chain proof | `audit:read` | all roles |
| `/app/analytics` | KPI families; Evaluation tab | `kpi:read`; tab: `eval:read` | all roles; Evaluation: `ADMIN`, `AUDITOR` |
| `/app/settings` | Settings index | authenticated | all roles (sections filtered) |
| `/app/settings/access` | Users, roles, sessions | `user:read` | `ADMIN` (manage), `AUDITOR` (read) |
| `/app/settings/approvals` | Approval matrix; break-glass register | `policy:read` + role `ADMIN` or `AUDITOR`; elevate: `break_glass:request` | `ADMIN` (elevate), `AUDITOR` (read); the matrix alone is read-only for every role at `/app/policies` |
| `/app/settings/operations` | Dependencies, outbox/DLQ, anchors, unknown executions, stale cases, heartbeats | `ops:read` | `ADMIN`, `AUDITOR` |
| `/app/settings/notifications` | Notification routing (read-only in v1) | `ops:read` | `ADMIN` |
| `/forbidden` | Permission explanation, no data | authenticated | all roles |

Route notes:

- **Contracts live under Integrations.** The former `/contracts` page is the "Data contracts" tab of
  `/app/integrations`; there is no separate registry route.
- **KPIs and evaluation share Analytics.** `/app/kpis` and `/eval` no longer exist. Evaluation is a tab
  visible only to `eval:read` holders; `/app/analytics` itself is `kpi:read`.
- **Operations replaces `/ops`.** Outbox, DLQ, anchors, dependency health and job heartbeats live at
  `/app/settings/operations`.
- **Break-glass lives under Approvals.** Request, co-sign, revoke and the register live at
  `/app/settings/approvals`; the case-level dialog opens from the investigation workspace.
- **Recovery run key is the case ref.** A recovery is a case lifecycle, not a separate `Run` row.

Redirects:

- unauthenticated → `/login?next=<path>`; after login → `next` or `/app/overview`; after logout →
  `/login`.
- authenticated without the page permission → `/forbidden?permission=<code>&next=<path>`; the page
  names the route, the required permission and the user's roles, and never fetches the resource.
- `SESSION_STALE` (role changed or session epoch bumped) → `/login?reason=session_stale`; an unsaved
  rationale is restored once, then cleared.
- `ADMIN` has no business actions: the workspace renders, every approve/execute control is absent, and
  a banner says *"Platform administrators do not decide business actions."*

## 2. Navigation

Persistent left rail (248 px expanded, 72 px collapsed; drawer below 768 px), grouped as Monitor,
Investigate, Resolve, Control, Improve and Administration. Items are filtered by permission — hidden,
not disabled.

| Group · Item | Permission | VIEWER | ANALYST | REVIEWER | SENIOR_REVIEWER | ADMIN | AUDITOR |
|---|---|---|---|---|---|---|---|
| Monitor · Overview | `case:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Monitor · Actions | `action:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Investigate · Investigations | `case:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Investigate · Evidence | `case:read` + `contract:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Resolve · Recoveries | `case:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Resolve · Verification | `case:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Control · Policies | `policy:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Control · Integrations | `contract:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Control · Audit | `audit:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Improve · Analytics | `kpi:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Administration · Access | `user:read` | — | — | — | — | ✓ | read |
| Administration · Approvals | `policy:read` + role `ADMIN` or `AUDITOR` | — | — | — | — | ✓ | read |
| Administration · Operations | `ops:read` | — | — | — | — | ✓ | ✓ |
| Administration · Notifications | `ops:read` | — | — | — | — | ✓ | — |

Badge counts (a count, never a notification of work the viewer cannot perform):

| Item | Counts |
|---|---|
| Investigations | cases in `HOLDING`, `AWAITING_EVIDENCE`, `AWAITING_APPROVAL`, `VERIFYING`, `REOPENED`, `ESCALATED` |
| Actions | actions in `PENDING`, `HELD` |
| Recoveries | `APPROVED` + `EXECUTING` cases with `disposition = COMPENSATE` |
| Verification | cases in `VERIFYING`, `REOPENED` |
| Approvals | `AWAITING_APPROVAL` cases the viewer may approve |

Top bar: workspace/environment (`DEMO` / `SANDBOX` / `PRODUCTION`, never colour alone) · global search
(action id, account id, case ref, contract key) · `ModeBadge` (`AGENT` / `DETERMINISTIC`) · policy chip
(`2026.10.1`, full hash in tooltip; links to `/app/policies`) · degradation chip (hidden at `L0`, amber
`L1`, red `L2`–`L4`, violet `L5`; links to `/app/settings/operations` for `ops:read`, otherwise shows
plain-language impact) · user menu with every held role and `Sign out`.

## 3. First screen

`/` is the public introduction: hero, the Detect → Hold → Investigate → Decide → Recover → Verify
loop, the before/after entitlement scenario, and *"Open sandbox"*. It is not a dashboard and contains
no operational data.

`/login` → one card, product name, `Continue with SSO`, and the line *"Accounts are provisioned by an
administrator. There is no self-service sign-up or password reset."* In local development only, an
email/password block appears when `AUTH_CREDENTIALS_ENABLED=true`, with the seeded accounts as
one-click fills; the block and the list are absent from the production render, not hidden with CSS. A
failed sign-in is one generic sentence (no account enumeration); repeated failure shows the retry
window from `Retry-After`, never a permanent lock; a limiter outage shows
`RATE_LIMITER_UNAVAILABLE`, never an unthrottled form. `?next=` is honoured only as a same-origin
relative path. There is no `/signup`, `/invite` or `/reset` route.

After sign-in the operator lands on `/app/overview`, which ranks the highest-risk action first.

## 4. Journey: Prevention (Scenario A)

1. `analyst` opens **Investigations**; case `AIC-0007` appears with severity `HIGH` and `12 accounts
   exposed`.
2. **Summary** tab: integrity event, exposed action payload, `HOLD` decision with reasons, state
   `HOLDING`, policy chip, and the hold's age against its SLA.
3. **Run investigation** (`case:investigate`). Button becomes `Investigating…`; the workspace polls
   `GET /cases/:ref` every 2 s while `INVESTIGATING`.
4. **Hypotheses** tab: two hypotheses with supporting and contradicting evidence cards;
   recommendation `HOLD_FOR_EVIDENCE`, confidence `0.62`; one missing-evidence item
   (`contract owner confirmation`).
5. **Request evidence** (`case:request_evidence`) → owner team, question, deadline. Case moves to
   `AWAITING_EVIDENCE`; the deadline is visible on the case and the Investigations row.
6. Evidence arrives (seeded fixture or **Add evidence**) and contradicts the revoke. The case returns
   to `INVESTIGATING`; a second report recommends `BLOCK` at `0.88`. Case moves to
   `AWAITING_APPROVAL`.
7. **Decision record** tab shows the `DecisionPacket` and `ApprovalRail`: `QuorumSummary` with
   `required 1`, `current 0`, disposition `BLOCK`, risk `64`, evidence hash and policy version the
   approval will bind to.
8. `reviewer` selects `BLOCK`, writes a rationale of at least 20 characters, submits.
   `1 / 1` met; case `APPROVED`.
9. **Complete block** is disabled for `reviewer` with `SoDExplainer`: *"You approved this case. Another
   reviewer must complete the block."* `reviewer2` signs in and selects **Complete block**: the control
   plane marks the action `BLOCKED`, performs **no target write** and writes no `ActionExecution` row.
   Case moves to `VERIFYING`.
10. **VerificationChecklist** shows expected `SSO ACTIVE`, observed `SSO ACTIVE`, `passed = true`. Case
    `CLOSED_RESOLVED`. The execution section says **Blocked — no target write**; timeline shows zero
    executions; footer shows citations, time-to-hold and total duration.

## 5. Journey: High-risk compensation (Scenario B)

Same entry, but the exposed action is already `EXECUTED`. The action detail and case summary show the
**restore point** captured before the action. Risk is `82` and exposure `480`.

1. Investigation recommends `COMPENSATE`; policy requires **2 approvals, one `SENIOR_REVIEWER`**.
2. `QuorumSummary` reads `required 2`, roles `[SENIOR_REVIEWER, any]`, window 12 h, and lists the
   binding hashes.
3. `reviewer` approves; the rail shows `1 / 2` and *"A SENIOR_REVIEWER must also approve."*
4. `senior` approves independently (own session, own rationale); `2 / 2`, case `APPROVED`.
5. Both approvers see **Execute** disabled (`APPROVER_CANNOT_EXECUTE`) with `SoDExplainer`; `reviewer2`
   executes from the **Recovery run** page (`/app/recoveries/[caseId]`). `ExecutionConfirmation` names
   the exact object, the restore point age, and states the write cannot be undone from the console.
6. The target call succeeds but the response is lost. Execution is `UNKNOWN`, not success.
   `UnknownExecutionBanner`: *"Outcome unconfirmed — do not re-run."*
7. `reviewer2` runs **Verify**. Observed state equals the restore point → execution resolved
   `SUCCEEDED` (`resolvedByVerification = true`); case closes verified. If observed state differs, the
   case is `REOPENED` and the owner is paged (Journey D).

## 6. Journey: Conflicting evidence (Scenario C)

Investigation returns two equally weighted hypotheses and `confidence: 0.41`. Policy forces
`ESCALATE`; the Execute control is disabled with *"Evidence cannot establish an authoritative truth."*
A reviewer can only record a disposition decision, not execute. The evidence request shows the owner
team and the SLA clock; on expiry the case is `ESCALATED` by reconciliation, not by a UI timer.

## 7. Journey: Safe refusal (Scenario E)

Recommendation `SAFE_REFUSAL`. The Decision record replaces the approval form with a `DecisionPacket`
and an **evidence packet** panel (downloadable JSON + Markdown summary) and a link to the
human-controlled process. No approve or execute affordance is rendered. Policy still records why
refusal was chosen.

## 8. Journey: Verification failure (Scenario D)

Execution succeeds; verification reads a different state. `VerificationChecklist` banner: *"API
reported success; business state was not restored."* Case `REOPENED`, owner notified through the
outbox, KPI "verified closure rate" drops, recovery counter does not increment. The Verification queue
(`/app/verification`) shows the expected/observed diff, the read timestamp and the mismatch rows.

## 9. Journey: Quorum not met (fixture K, negative)

With one approval the case stays `AWAITING_APPROVAL`. The execute control is disabled with
`1 of 2 approvals — missing SENIOR_REVIEWER`. Direct `POST /execute` returns 409
`APPROVAL_QUORUM_NOT_MET` with the same detail; the UI renders the envelope and refreshes
`QuorumSummary`. There is no client-side override, and the disabled state is never the only
enforcement.

## 10. Journey: Unknown execution resolution

1. `POST /cases/:ref/execute` returns `202` with `status: "UNKNOWN"`. The execution card is amber and
   says **Outcome unconfirmed — do not re-run**; **Execute** stays disabled.
2. **Verify** is primary. `observed == expected` ⇒ execution `SUCCEEDED`, case closes. Otherwise
   execution `FAILED`, case `REOPENED`.
3. If the target cannot be read, no verification row is written, the case becomes `ESCALATED` and the
   UI shows `TARGET_UNAVAILABLE` with the support reference.
4. Reconciliation marks stale `PENDING` executions `UNKNOWN`; the case page shows the same banner
   after a refresh. The UI never renders `UNKNOWN` as success or as failure.

## 11. Journey: Break-glass

1. `admin` opens **Break-glass** from the case (`BreakGlassDialog`): reason ≥ 50 characters, TTL ≤ 60
   minutes, scope fixed to that case. State `PENDING_COSIGN`, expires in 15 minutes if unsigned.
2. A **different** `admin` co-signs in their own session (in development, create a second admin at
   `/app/settings/access`; the seed ships one). The co-signature is recorded as a `breakGlass`
   approval and moves the elevation to `ACTIVE`.
3. The requester — and only the requester — may execute inside the TTL. The co-signer approved, so
   approver ≠ executor still holds.
4. The case shows a persistent violet `BreakGlassBanner`: *"Break-glass elevation active — auditor
   review required."* A `USED` elevation pages security and creates a 24 h `AUDITOR` review task; the
   register at `/app/settings/approvals` shows it.
5. Revoke, TTL expiry or timeout: `REVOKED` / `EXPIRED` / `DENIED`; the banner disappears and the
   reason is kept in the timeline.

## 12. Journey: Degradation

| Level | What the UI does |
|---|---|
| `L1_LLM_DEGRADED` | Investigation tab shows *"Baseline mode — model unavailable"*; reports are labelled `fallback`. No blocking. |
| `L2_TARGET_DEGRADED` | Execute is disabled with *"Target unavailable — holds remain in force"*. Ingest still returns `HOLD`; writes return 503 `DEGRADATION_BLOCKED`. |
| `L3_DB_DEGRADED` | Console is read-only from cache/`/health`; all mutations disabled with the level named. |
| `L4_AUDIT_BROKEN` | Full-width red banner: *"Audit chain broken — writes frozen."* Only `ADMIN`/`AUDITOR` see `/app/settings/operations` actions (snapshot, verify, restore). No business action is accepted. |
| `L5_IDENTITY_DEGRADED` | New sign-ins fail with a plain message; existing sessions continue; OIDC errors are not echoed. |

The chip is derived from `GET /health` / `GET /ops/status`, never computed in the browser. A level can
only be tightened from the UI; raising it requires the probe to recover.

## 13. Journey: Policy activation invalidates approvals

`admin` activates `2026.10.2` from `/app/policies/[policyId]` with a review ticket. Any case holding
valid approvals shows a banner: *"Policy changed — approvals superseded; re-approve under 2026.10.2."*
The case returns to `AWAITING_APPROVAL`, the approval list marks rows `SUPERSEDED`, and an execute
attempt returns 409 `POLICY_STALE`. The same pattern applies to `EVIDENCE_CHANGED` and
`APPROVAL_EXPIRED`.

## 14. Journey: Operations (`/app/settings/operations`)

Panels: dependencies (DB, target, LLM, IdP, Redis) with latency and last probe · outbox
`pending / DLQ / oldestAgeSeconds` · anchors `lastSeq / ageSeconds / status` · unknown executions ·
stale cases · job heartbeats. Mutating controls (`drain`, `replay`, `anchor`, `verify`, `reconcile`)
require a reason, name the affected ids, and show the `requestId` afterwards. `AUDITOR` sees the same
data without the controls. A DLQ event is replayed only after its payload is inspected; the UI never
offers a bulk "retry all".

## 15. States for every data surface

| Surface | Loading | Empty | Error | Partial |
|---|---|---|---|---|
| Overview | posture skeletons | *"No cases yet. Submit an action or run integrity evaluation."* | inline retry | last-known counts + stale badge |
| Action Queue | skeleton rows | *"No outbound actions in range."* | inline retry | last-known list + stale badge |
| Action detail | section skeletons | n/a | full-page error with `Retry` | per-section error boundary |
| Investigations | skeleton rows | *"No investigations yet."* | inline retry | last-known list + stale badge |
| Investigation workspace | section skeletons | *"Investigation not started."* | per-tab error boundary | partial hypotheses tagged `incomplete` |
| Evidence graph | canvas spinner | *"No evidence collected."* | retry, list fallback preserved | missing nodes marked explicitly |
| Recoveries | skeleton rows | *"No recoveries in range."* | inline retry | last-known list + stale badge |
| Recovery run | step skeleton | *"No recovery plan yet."* | retry with run id | steps resume from server state |
| Verification | spinner | *"Not verified yet."* | *"Verification could not run."* | expected vs observed diff |
| Policies | skeleton rows | *"No policy versions."* | inline retry | history partial |
| Integrations / contracts | skeleton rows | *"No contracts registered."* | inline retry | snapshot history partial |
| Audit | skeleton rows | *"No audit events match these filters."* | inline retry, filters preserved | chain verification pending |
| Analytics | chart skeletons | *"No completed cases in range."* | retry | last computed + timestamp |
| Evaluation tab | run progress | *"No runs yet."* | failed-run banner | partial results table |
| Operations | panel skeletons | *"No outbox events."* | panel-level retry | dependency stale timestamp |
| Settings / Access | table skeleton | *"No users match."* | retry | read-only when permission is missing |

## 16. Overlays and confirmations

- **Approve** and **Execute** are two separate surfaces, never combined, never in the same dialog.
- `ApprovalDecisionSheet` shows: decision, disposition, risk band, `requiredApprovals` /
  `requiredRoles` from the server, short evidence hash, policy version, rationale rules, and a warning
  when the actor is not eligible (wrong tier, reviewer conflict, duplicate).
- Reject requires a rationale (≥ 20 characters) and states that other approvals will be `REVOKED`
  and the lifecycle ends.
- `ExecutionConfirmation` names the exact target effect, the restore point (compensation), and for
  `risk ≥ 70` requires typing the case ref. Copy states that a write cannot be undone from the
  console.
- Break-glass requires the case ref, a ≥ 50-character reason and a TTL; co-sign happens in a
  different session and is a separate dialog.
- Leaving an unsaved rationale warns before navigation; the draft is kept for one return only.
- There are no destructive hard-deletes in the UI. Case closure is a status change.

## 17. Edge-case behaviours

- Session expiry during approval → 401 → `/login?next=…`; rationale restored once from
  `sessionStorage`, then deleted.
- Sign-in is rejected when the IdP returns a role outside the allowlist: the page states it, and no
  session, default role or partial cookie is created.
- An authenticated user who opens `/login` is redirected to `next` or `/app/overview`; an off-origin
  `next` is discarded rather than followed.
- Back button after execution must not re-trigger it: `POST` is not in history; a refresh re-fetches
  state. The execute form uses one `Idempotency-Key` per case lifecycle and a new one after a reopen.
- Two reviewers approve concurrently: both rows appear; no 409 unless the same reviewer repeats.
  A concurrent execute returns 409 `ALREADY_EXECUTING` and the UI refreshes.
- Every 409/422/503 renders the stable error code, the human sentence and the next allowed action:
  `APPROVAL_QUORUM_NOT_MET` → show missing roles; `APPROVER_CANNOT_EXECUTE` → offer another
  executor; `APPROVAL_EXPIRED` / `EVIDENCE_CHANGED` / `POLICY_STALE` → re-approve;
  `BREAK_GLASS_INCOMPLETE` → complete co-sign; `DEGRADATION_BLOCKED` → name the level.
- `RATE_LIMITED` shows the `Retry-After` countdown; `RATE_LIMITER_UNAVAILABLE` fails closed with a
  503 page, never a retry loop.
- Double-submit with the same key replays the stored response (`meta.replayed`); a new key after a
  terminal state shows `INVALID_TRANSITION`.
- Direct URL to a case the role cannot act on → page renders read-only with a disabled banner naming
  the missing permission.
- `INVESTIGATION_MODE=deterministic` → the Investigate button reads *"Baseline mode"*; reports are
  tagged `deterministic` and make no LLM call.
- `ADMIN` + reviewer role is rejected at user creation; the user form explains the conflict rather
  than saving and failing later.
- A terminal case hides action controls and keeps the evidence, decision, execution and verification
  history readable.

## 18. Production-control components

`DecisionPacket` · `ApprovalRail` · `QuorumSummary` (server values only) · `ApprovalDecisionSheet`
(never contains Execute) · `SoDExplainer` · `BreakGlassBanner` · `BreakGlassDialog` ·
`DegradationBanner` · `PolicyChip` · `UnknownExecutionBanner` · `VerificationChecklist` · `OpsTable` ·
`IdempotentForm` (one key per attempt, shows `replayed`) · `ErrorEnvelopeBanner` (code, sentence,
next action, `requestId`).

Each component renders server-provided facts. None of them recomputes quorum, risk, policy or
degradation in the browser; none of them is an authorization boundary.

## 19. Accessibility

WCAG 2.2 AA. Full keyboard operation of approve, execute, break-glass and verification; focus moves
into a dialog and returns to its trigger; quorum, degradation and break-glass changes announce through
a live region; status is never conveyed by colour alone; timers and SLA clocks have text alternatives;
data tables have captions and scoped headers; the evidence graph has a navigable list and relationship
table. Error banners are focusable and readable by screen readers. Red is never the sole signifier.

## 20. What the UI must never do

- Show "success" before a `VerificationResult` with `passed = true`.
- Present `UNKNOWN` as success or failure.
- Offer approve and execute in one click, or to the same person.
- Derive quorum, risk, disposition or policy hash from client constants.
- Treat a hidden button as authorization, or a disabled button as the only enforcement.
- Echo prompts, evidence excerpts, rationales, secrets or upstream messages into logs, URLs or error
  copy.
- Auto-retry a write, or resubmit with a new key because the first attempt looked stuck.
- Display a completed state for a case whose audit write failed.
- Present an editable policy or a notification preference that has no endpoint behind it.
