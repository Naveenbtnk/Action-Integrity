# UI/UX SPECIFICATION — Operator Control Room

**Status:** normative for the visual layer, information architecture, component inventory, motion and
frontend structure. It supersedes the earlier operator-console brief; that direction is retired.
**Experience direction:** steel blueprint at midnight.
**Source:** the supplied UI/UX specification dated 27 October 2026, adopted as the primary frontend
document. Backend contracts remain in `API.md`, `RBAC.md`, `BACKEND_SCHEMA.md` and `ARCHITECTURE.md`.
**Public-site amendment:** ADR-027 places the product and trust pages in a separate static Astro
project at `apps/public`. The authenticated console and API remain in Next.js. The canonical
visual tokens and accessibility rules below apply to both origins.

---

## 0. Authority and precedence

| Question | Authority |
|---|---|
| What a page looks like, how it is laid out, which component it uses | **this file** |
| Which route exists and who may open it | §3 here + `RBAC.md` |
| What a status means, which transitions are legal | `ARCHITECTURE.md` §4 + `BACKEND_SCHEMA.md` §2 |
| Which values are server-computed (quorum, risk, policy hash, degradation) | `API.md`, `RBAC.md` |
| What a button may call | `API.md` §6 |
| How a failure is worded and what the next action is | `API.md` §8 + `APP_FLOW.md` §17 |

Rules that survive every redesign, and are not negotiable in review:

- Status is never conveyed by colour alone: every state has an icon, a label and a sentence.
- `UNKNOWN` is never rendered as success or as failure.
- Quorum, risk, allowed dispositions, policy hash and degradation level are rendered from the server;
  the browser never derives them.
- Approve and execute are separate surfaces, never one control, never the same person.
- A disabled control always states the reason in text (`SoDExplainer`, `QuorumSummary`, policy copy).
- No success state before a `VerificationResult` with `passed = true`.
- No optimistic UI for approve, execute, verify, publish or release.
- Every error renders the stable code, a human sentence, the next allowed action and a copyable
  `requestId`.

## 1. Stack and dependency rule

| Layer | Choice | Job |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript `strict`, Tailwind CSS v4 | Application foundation; Server Components by default |
| Component layer | shadcn/ui generated on the **Base UI** primitive base | The only production component layer |
| Primitives | Base UI, imported directly only inside `components/ui/*` | Accessible behaviour not yet exposed by shadcn/ui |
| Queues and evidence tables | TanStack Table (headless) | Server-driven filter, sort, pagination, column visibility |
| Evidence graph | React Flow | Node/edge canvas with a navigable list alternative |
| Forms | React Hook Form + Zod resolvers | Policy, approval, evidence and settings forms |
| Motion accents | Magic UI, source-copied into `components/accent/*` | Live event insertion and one restrained status transition |
| Public-page accents | Aceternity UI, source-copied into `components/accent/*` | One background or tracing treatment on `/` only |
| Icons | Lucide, restricted to the product icon map | No emoji, no mixed icon sets |
| Charts | Recharts with an accessible table fallback | Analytics only; subordinate to case evidence |
| Component workbench | Storybook or equivalent | Every state: default, hover, focus, disabled, loading, error |
| **Prohibited** | Mantine, daisyUI, second theming system, second radius/type/shadow scale | — |

Dependency rules:

- `components/ui/*` is the only primitive/component import surface feature code may use.
- Direct `@base-ui/react` imports are allowed only inside `components/ui/*`.
- `components/accent/*` consumes the same tokens; no accent component keeps its original styling,
  glow, gradient or infinite animation.
- No page mixes visual components from more than one component system.
- Adding any dependency in this table requires ADR-025. Removing Mantine/daisyUI from the tree is an
  acceptance test, not a preference.

## 2. Product experience principle

The product is an **evidence-led control room**, not a monitoring wall. Every primary page advances
one of five operator questions, in order:

1. What consequential action is exposed?
2. Why does the supporting evidence appear unreliable?
3. What is currently contained or already affected?
4. Who must decide, and what may they safely do?
5. Was the intended business state actually restored?

Tenets: evidence before recommendation · business state before system state · one consequential
action per surface · explicit uncertainty · human accountability · reversible by design ·
progressive disclosure · no chat-first interface.

Signal Red marks the single next consequential action. It is never used for general emphasis,
navigation or decoration.

## 3. Information architecture, routes and bindings

### 3.1 Routes

All authenticated pages live under `src/app/app/**`; public pages under `src/app/(public)/**`; auth
under `src/app/(auth)/**`. The spec's `app/` tree is mounted under the repository's `src/` directory.

| Route | Page | Nav group | Permission | Server data | Phase |
|---|---|---|---|---|---|
| `/` | Product introduction | public | public | static | 8 |
| `/trust` | Security and operating model | public | public | static | 8 |
| `/login` | Sign in (`?next=`; OIDC, dev credentials) | — | public | Auth.js only — no app data | 8 |
| `/app/overview` | Overview | Monitor | `case:read` | `GET /cases`, `GET /actions`, `GET /health` (trend panel: `GET /kpis`) | 8 (trend 10) |
| `/app/actions` | Action Queue | Monitor | `action:read` | `GET /actions` | 8 |
| `/app/actions/[actionId]` | Action detail | Monitor | `action:read` | `GET /actions/:id` (additive read) | 8 |
| `/app/investigations` | Investigations | Investigate | `case:read` | `GET /cases` | 8 |
| `/app/investigations/[caseId]` | Investigation workspace | Investigate | `case:read` | `GET /cases/:ref`, `/report`, `/approvals` | 8 |
| `/app/evidence` | Evidence Explorer | Investigate | `case:read` + `contract:read` | `GET /contracts`, `GET /cases/:ref` | 8 |
| `/app/recoveries` | Recoveries | Resolve | `case:read` | `GET /cases?disposition=COMPENSATE` (additive filter) | 8 |
| `/app/recoveries/[caseId]` | Recovery run | Resolve | `case:read` | `GET /cases/:ref` | 8 |
| `/app/verification` | Verification queue | Resolve | `case:read` | `GET /cases?status=` | 8 |
| `/app/policies` | Policies | Control | `policy:read` | `GET /admin/policy` | 8 (read) / 11 (activate) |
| `/app/policies/[policyId]` | Policy version | Control | `policy:read` | `GET /admin/policy` | 8 (read) / 11 (activate) |
| `/app/integrations` | Integrations and data contracts | Control | `contract:read` | `GET /contracts`, `GET /health` | 11 |
| `/app/integrations/[integrationId]` | Integration / contract detail | Control | `contract:read` | `GET /contracts/:key` | 11 |
| `/app/audit` | Audit ledger | Control | `audit:read` | `GET /audit`, `GET /audit/:id` | 10 |
| `/app/analytics` | Analytics | Improve | `kpi:read` | `GET /kpis` | 10 |
| `/app/analytics` → Evaluation tab | Evaluation runs | Improve | `eval:read` | `GET /eval/runs`, `GET /eval/runs/:id` | 10 |
| `/app/settings` | Settings index | user menu | authenticated | — | 8 |
| `/app/settings/access` | Users, roles, sessions | Administration | `user:read` | `GET /admin/users`; mutations `user:manage` | 11 |
| `/app/settings/approvals` | Approval matrix, break-glass register | Administration | `policy:read` + role `ADMIN` or `AUDITOR`; elevate: `break_glass:request` | `GET /admin/policy`, `GET /admin/break-glass` (additive) | 11 |
| `/app/settings/operations` | Operations | Administration | `ops:read` | `GET /ops/status`; `/internal/*` mutations | 11 |
| `/app/settings/notifications` | Notification routing | Administration | `ops:read` (read-only) | outbox consumers; no preferences endpoint | 11 |
| `/forbidden` | Permission explanation, no data | — | authenticated | none | 8 |

Route notes:

- **Recovery run key is the case ref.** A recovery is a case lifecycle, not a separate `Run` entity;
  `[caseId]` is used in code, and the page title reads "Recovery run".
- **Policy version is immutable.** `/app/policies/[policyId]` renders the active document and its
  history. Simulation is performed by the evaluation harness and recorded as a `ScenarioRun`; there is
  no browser policy editor, and publishing is a separate `policy:activate` action.
- **Contracts live under Integrations.** The contract registry is the "Data contracts" tab of
  `/app/integrations`; there is no separate `/contracts` route.
- **Operations replaces `/ops`.** Outbox/DLQ, anchors, unknown executions, stale cases, job heartbeats
  and dependency health live at `/app/settings/operations`; the degradation chip links there for
  `ops:read` holders.
- **Break-glass lives under Approvals.** Request, co-sign, revoke and the elevation register live at
  `/app/settings/approvals`; the case-level dialog opens from the investigation workspace. The approval
  matrix itself is part of the policy and is readable by every role at `/app/policies`; the settings
  route is the administration surface that adds the register and the elevate controls.
- **Evaluation is a tab, not a route.** `/app/analytics` shows KPI families; `eval:read` holders also
  see the Evaluation tab with runs, tiers and baseline comparison.
- Three additive read shapes are required by this IA and are documented in `API.md`:
  `GET /actions/:id`, `GET /admin/break-glass`, and the `disposition` filter on `GET /cases`.

### 3.2 Redirects and guards

- Unauthenticated → `/login?next=<path>`; after login → `next` or `/app/overview`; after logout →
  `/login`.
- `next` is honoured only when it is a same-origin relative path; anything else is discarded and the
  user lands on `/app/overview`. There is no open redirect.
- An authenticated user who opens `/login` is redirected to `next` or `/app/overview` without a flash
  of the form.
- There is no `/signup`, `/register`, `/invite` or `/reset` route, and no link implies one; identity
  provisioning is out of band (`SECURITY.md` §2).
- Authenticated without the page permission → `/forbidden?permission=<code>&next=<path>`; the page
  names the route, the permission and the user's roles and fetches no resource data.
- `SESSION_STALE` → `/login?reason=session_stale`; an unsaved rationale is restored once, then
  deleted.
- `ADMIN` has no business actions: the workspace renders, every approve/execute control is absent, and
  a banner says *"Platform administrators do not decide business actions."*
- A direct URL to a resource the role may read but not act on renders read-only with the missing
  permission named.

### 3.3 Navigation groups

Persistent left rail (248 px expanded, 72 px collapsed; drawer below 768 px), filtered by permission —
hidden, never disabled:

| Group | Destinations |
|---|---|
| **Monitor** | Overview · Action Queue |
| **Investigate** | Investigations · Evidence Explorer |
| **Resolve** | Recoveries · Verification |
| **Control** | Policies · Integrations · Audit |
| **Improve** | Analytics |
| **Administration** | Access · Approvals · Operations · Notifications (permission-filtered) |

Do not flatten this into a top bar. The rail carries counts; the top bar carries environment, search,
mode, policy, degradation and the user menu.

Badge counts (never notifications of work the viewer cannot perform):

| Item | Counts |
|---|---|
| Investigations | cases in `HOLDING`, `AWAITING_EVIDENCE`, `AWAITING_APPROVAL`, `VERIFYING`, `REOPENED`, `ESCALATED` |
| Action Queue | actions in `PENDING`, `HELD` |
| Recoveries | `APPROVED` + `EXECUTING` cases with `disposition = COMPENSATE` |
| Verification | cases in `VERIFYING`, `REOPENED` |
| Approvals | `AWAITING_APPROVAL` cases the viewer may approve |

Top bar: workspace/environment (`DEMO` / `SANDBOX` / `PRODUCTION`, never colour alone) · global search
(action id, account id, case ref, contract key) · `ModeBadge` (`AGENT` / `DETERMINISTIC`) · `PolicyChip`
(version + short hash, full hash in tooltip, links to `/app/policies`) · degradation chip (hidden at
`L0`; amber `L1`; red `L2`–`L4`; violet `L5`; links to `/app/settings/operations` for `ops:read`,
otherwise plain-language impact) · user menu with every held role and `Sign out`.

## 4. Application shell

- **Left rail:** 248 px expanded, 72 px collapsed.
- **Top utility bar:** 56 px.
- **Main content:** fluid from 1024 px; gutters 24 px at 1024–1279, 32 px at 1280–1599, 40 px at
  1600+; maximum 1600 px for overview and forms; queue and graph pages may use full width.
- **Context rail:** optional 360 px right rail on action, investigation, recovery and verification
  detail pages.
- **Page header:** breadcrumb, title, compact metadata, one primary action, overflow menu.

Responsive:

| Width | Behaviour |
|---|---|
| ≥ 1440 px | rail + content + context rail |
| 1024–1439 px | collapsible rail; context rail becomes a sheet |
| 768–1023 px | read/triage layout; tables become prioritised cards; graph opens full screen |
| < 768 px | companion mode: alerts, status, approval review. Policy editing, graph manipulation and recovery execution are desktop-only |

Global facilities: `Ctrl/Cmd + K` command menu · saved queue views · deep links preserve filters and
selected evidence · persistent "data as of" timestamp on Overview and Analytics · skip link · visible
focus.

Global banners sit below the top bar and push content, never overlay it:

- Degradation banner (level, plain-language impact, `/app/settings/operations` for `ops:read`).
- Audit-chain banner at `L4`: full width, red, *"Audit chain broken — writes frozen."*
- Break-glass banner on the case: violet, requester, co-signer, expiry, `USED` ⇒ auditor review
  required.
- Policy-superseded banner on the case: *"Policy changed — approvals superseded; re-approve under
  2026.10.2."*

## 5. Page specifications

Each page states purpose, required blocks, the single primary action and the binding that matters.
Loading, empty, error and partial states are mandatory on every data surface (`APP_FLOW.md` §15).

### 5.1 Public surfaces — `/`, `/trust`, `/login`

These three routes render outside `ApplicationShell`: no rail, no top bar, no case data, and no session
or user row in the HTML. They share the tokens, type scale and 4 px radius, and nothing else.

**`/` and `/trust`** — purpose: explain the loop and establish trust. Sections: hero *"Stop bad data
before it becomes a bad business action."*; restrained loop Detect → Hold → Investigate → Decide →
Recover → Verify; before/after entitlement scenario; deterministic controls versus agentic reasoning;
audit and human-approval proof; CTA *"Open sandbox"*. One Aceternity background/grid treatment and at
most one Magic UI animation. No glows, blur fields, marquees or gradient buttons. The authenticated
product contains none of these. `/trust` describes the operating model, roles, audit chain and known
gaps from `SECURITY.md` §11 and `PRODUCTION_READINESS.md` §7 — the gaps stay visible.

**Sign in — `/login`** — purpose: one way in, no way to create an identity.

Layout: at ≥ 1024 px two panes — a brand pane (lockup, the one-line claim, the loop as four steps, one
audit sentence, environment chip) and a 400 px sign-in card on carbon; below 1024 px the brand pane
collapses to the lockup plus one line and the card centres; below 768 px the card is full-bleed. One
`h1`: *"Sign in to Action Integrity."* No illustration, carousel, testimonial or marketing gradient.

Card, in order:

1. **`Continue with SSO`** — full-width primary and, in production, the only visible action. Starts the
   Auth.js OIDC authorization-code + PKCE flow, carrying `?next=` through as state; on success it lands
   on `next` or `/app/overview`.
2. **Email and password** — rendered only when `AUTH_CREDENTIALS_ENABLED=true` and
   `NODE_ENV !== "production"`, inside a bordered "Local development" block with a muted caption. The
   field is absent from the production render, not hidden with CSS. Email (`autocomplete="username"`,
   `inputMode="email"`), password (`autocomplete="current-password"`, reveal toggle with
   `aria-pressed`), submit. Enter submits; paste and password managers are allowed.
3. **Provisioning line** — *"Accounts are provisioned by an administrator. There is no self-service
   sign-up or password reset."* Plain text with the security contact from config; no link to an
   invitation or reset form.
4. **Footer strip** — environment (`LOCAL` / `PREVIEW` / `PRODUCTION`), build SHA, active policy
   version. Space Mono 12 px, muted. Never user data.

Error and edge states, all in one `role="alert"` region above the card, focused when it appears:

| Condition | Copy | Behaviour |
|---|---|---|
| Failed credentials sign-in | *"Email or password is incorrect."* | The same string for an unknown email and a wrong password; the form does not branch on which failed and keeps the email |
| `429 RATE_LIMITED` on `/auth/*` | *"Too many attempts. Try again in N minutes."* | Wait taken from `Retry-After`; submit disabled until it elapses. The server stays the enforcement point; the disabled button is courtesy |
| `503 RATE_LIMITER_UNAVAILABLE` | *"Sign-in is temporarily unavailable."* | Show `requestId`; never fall back to an unlimited path |
| `?reason=session_stale` | *"Your access changed. Sign in again."* | Neutral notice, not an error |
| `USER_INACTIVE` | *"This account is deactivated. Contact an administrator."* | No hint about when, why or by whom |
| OIDC role claim not on the allowlist | *"Your identity provider returned a role this system does not recognise."* | Sign-in is rejected; never fall back to a default role |
| Provider unreachable | *"Single sign-on is unavailable."* | Offer retry; production never reveals the password form as an alternative |
| Already authenticated | — | Redirect to `next` or `/app/overview` before paint |
| `next` not a same-origin relative path | — | Ignore it and go to `/app/overview` |

Never: enumerate accounts, name the failing factor, prefill an email from a query string, keep a token in
web storage, or wrap the form in the application shell. The page is static — it fetches no session, case
or user row to render, and it holds no client-side authorization logic.

**Sign-up — none.** There is no `/signup`, no invite-acceptance page and no password-reset flow.
Identity comes from the IdP; roles come from the allowlisted claim or from an `ADMIN` in
`/app/settings/access`. A request for access is an organisational process, not a screen.

### 5.2 Overview — `/app/overview`

Purpose: operational posture and the next piece of work.

- Posture strip: actions held, cases awaiting decision, recoveries failing verification.
- "Needs attention now" ranked list (risk, age against SLA, owner).
- Action-flow summary for the last 24 h.
- Recent integrity signals with source and freshness.
- Recovery/verification trend.
- System and integration health from `/health`.

Primary action: **Review highest-risk action** → `/app/actions/[actionId]`. No twelve-card KPI grid.

### 5.3 Action Queue — `/app/actions`

Columns: risk/state · proposed action · business object/customer · integrity reason · impact scope ·
policy gate · owner · age/SLA · next step.

Server-side filter, sort and pagination through TanStack Table. Saved views: `Held`, `Evidence
missing`, `Approval due`, `Already executed`, `My queue`. Bulk operations are limited to assignment,
evidence request and export — never bulk approve, block or compensate. Keyboard row navigation,
column visibility, density (48 px default / 40 px compact). Row selection persists across pages only
when explicitly enabled.

### 5.4 Action detail — `/app/actions/[actionId]`

Header: state, action id, proposed change, deadline. Body: before/after `ActionDiff`; `PolicyGateList`
with exact rule and policy version; evidence grouped `supports` / `contradicts` / `missing` / `stale`;
`ImpactScopeSummary`; `RecommendationPanel` labelled **Agent recommendation** with citations; right
rail: ownership, approval requirement, history.

Primary action varies by state: **Open investigation**, **Request evidence**, **Submit for approval**
or **Release action**. "Approve" never appears before required evidence, impact scope and verification
plan are visible in the same flow.

### 5.5 Investigations — `/app/investigations`

Views: active · waiting for evidence · waiting for owner · waiting for approval · reopened after
failed verification · escalated · resolved. Each row exposes hypothesis count, unresolved conflicts,
affected actions, owner and SLA. This replaces the former Inbox.

### 5.6 Investigation workspace — `/app/investigations/[caseId]`

The core surface. Three zones: **case spine** (events, evidence arrivals, hypothesis revisions,
decisions), **evidence workbench** (record comparison, lineage, semantic definition, freshness) and
**decision rail** (recommendation, uncertainty, policy boundary, permitted actions). The decision rail
never scrolls away during approval.

Tabs: Summary · Evidence · Impact · Hypotheses · Collaboration · Decision record. Execution,
verification and timeline render inside the spine/rail rather than as separate pages.

Required interactions: pin evidence into the decision record; compare two records side by side; mark
evidence authoritative only with source and reason; request missing evidence from a named owner; show
how the recommendation changed after each evidence event (*"Why this changed"*); preview the exact
release or compensation payload; preserve reviewer edits and disagreement.

The Decision record tab order is fixed: recommendation → policy decision and why → `DecisionPacket` →
`ApprovalRail` (`QuorumSummary` + approval rows + `ApprovalDecisionSheet` when eligible) → post-approval
step (separate `ExecutionConfirmation` or **Complete block**) → verification. `SUPERSEDED` approvals
remain visible, greyed, with the reason.

No chatbot as the workspace. "Ask about this case" may exist as a contextual tool whose output links
back to evidence objects.

### 5.7 Evidence Explorer — `/app/evidence`

React Flow canvas of source system · dataset/record · semantic contract · policy gate ·
proposed/executed action · target state · verification observation; edges `derived from`, `conflicts
with`, `authorized by`, `triggered`, `compensated by`, `verified by`.

The graph is an investigation tool, not decoration. Selecting a node opens its record, freshness,
ownership and related cases. A navigable node list and relationship table are mandatory equivalents.
v1 renders a per-case graph from `GET /cases/:ref` plus the contract registry; a cross-case graph
requires a projection and is deferred.

### 5.8 Recoveries — `/app/recoveries` and `/app/recoveries/[caseId]`

Queue columns: original harmful action · approved compensating action · affected objects · approver ·
idempotency key · dry-run result · execution state · verification state · refusal reason.

Recovery run steps: scope locked → policy checks complete → approval recorded → compensation executed
→ target state observed → downstream reconciliation complete → case closed. A failed verification does
**not** mark the run complete, even when the write API returned 200. Primary action: **Review recovery
plan**. Execution happens only in a confirmation flow that repeats scope, target environment and
verification plan.

### 5.9 Verification — `/app/verification`

Separate queue: awaiting observation window · target mismatch · downstream mismatch · duplicate action
suspected · ready to close · reopened. Show expected state, observed state, observation time, source and
reconciliation checks. This page is a product differentiator, not an analytics view.

### 5.10 Policies — `/app/policies` and `/app/policies/[policyId]`

List: active version, hash, status, activation ticket, history. Detail: human-readable rules covering
allowed action types, hold conditions, evidence requirements, approval thresholds, impact limits,
compensation eligibility, verification checks and escalation deadlines; the hash; the version history.

Activation is a separate `policy:activate` action requiring version + hash + review ticket, available
only to `ADMIN`, with a confirmation that names the effect on open approvals and sessions. AI may
explain a policy; it cannot modify or publish one. There is no browser editor and no policy simulation
endpoint — simulation runs through the evaluation harness.

### 5.11 Integrations and data contracts — `/app/integrations`

Capability display, not vendor logos: `READ EVIDENCE` · `HOLD ACTION` · `EXECUTE COMPENSATION` ·
`VERIFY STATE` · `NOTIFY OWNER`. Detail shows scopes, contract fields and allowed enum values, last
successful read/write for `ops:read` holders, polling lag and recent failures. The **Data contracts**
tab is the registry: key, entity, declared fields, allowed enum values, version, owner team, last
checked, and the ten most recent snapshot hashes (`GET /contracts`, `GET /contracts/:key`).

### 5.12 Audit — `/app/audit`

Immutable event list with filters by case, actor, action, policy and time; before/after payload diff;
evidence citation links; decision rationale; model/tool/version metadata; export with checksum and
generated-at timestamp. Event detail shows `hash`, `prevHash`, anchor `{seq, rootHash, externalUri,
verifiedAt}` and `verification`.

### 5.13 Analytics — `/app/analytics`

Sections: unsafe actions prevented · false-block rate · time to authoritative evidence · reviewer
reversal rate · compensation success rate · verified-closure rate · repeat integrity patterns ·
business impact with stated methodology. Every metric links to its case population and filter
definition. Evaluation tab (`eval:read`): runs, per-scenario results, tier, baseline comparison against
the other mode on the same commit. This replaces `/kpis` and `/eval`.

### 5.14 Settings — `/app/settings/*`

- **Access** — users, roles, last login, review due, deactivation. `ADMIN` + reviewer/auditor is
  rejected in the form with an explanation, not saved and failed later. Role change and deactivation
  name the effect on sessions.
- **Approvals** — the active approval matrix (thresholds, required roles, window) read from the policy;
  break-glass register with state, case, requester, co-signer and expiry. The matrix is the same object
  `/app/policies` shows to every role; this page adds the register and is limited to `ADMIN` and
  `AUDITOR`.
- **Operations** — dependencies (DB, target, LLM, IdP, Redis) with latency and last probe · outbox
  `pending / DLQ / oldestAgeSeconds` · anchors `lastSeq / ageSeconds / status` · unknown executions ·
  stale cases · job heartbeats. Mutating controls (`drain`, `replay`, `anchor`, `verify`, `reconcile`)
  sit in a panel footer with a reason field, name the affected ids and show the `requestId` afterwards.
  `AUDITOR` sees identical data without controls. A DLQ event is replayed only after its payload is
  inspected; there is no bulk "retry all". At `L4` the chain-break panel renders first.
- **Notifications** — read-only routing table for outbox-backed notifications in v1; no preference
  endpoint exists, and the page must not pretend to save one.
- Organisation, retention and API credentials are described, never editable in v1; credentials are
  never displayed.

## 6. State vocabulary and control-plane bindings

The spec's flow is a **user journey**, not the database state machine. `Case.status` has 16 values and
moves only through `lib/state-machine/case.ts`. The UI renders labels derived from the real enums; it
never invents a state or infers one from a timestamp.

| UI label | Real source | Rule |
|---|---|---|
| Proposed | action `PENDING`, case `NEW` | gate not yet decided |
| Evaluating | no case state | transient request state; never persisted |
| Allowed | `GateDecision.ALLOW` + action `EXECUTED` | execution result shown separately |
| Held | action `HELD`, case `HOLDING` | current containment |
| Investigating | case `INVESTIGATING` | poll while running |
| Evidence needed | case `AWAITING_EVIDENCE` | `slaDueAt` from server |
| Approval required | case `AWAITING_APPROVAL` | quorum from `/approvals` |
| Approved | case `APPROVED` | post-approval step still required |
| Blocked | action `BLOCKED` or `Disposition.BLOCK` | no target write |
| Released | action `RELEASED`, case `EXECUTING` | write in flight |
| Already executed | action `EXECUTED` before the case | entry condition for compensation |
| Recovery proposed | case `APPROVED` + `Disposition.COMPENSATE` | not a separate state |
| Recovery running | case `EXECUTING` | execution kind `RESTORE_LAST_KNOWN_GOOD` |
| Verifying outcome | case `VERIFYING` | verification read pending |
| Verification failed | case `REOPENED` | `VerificationResult.passed = false` |
| Outcome verified | case `CLOSED_RESOLVED` | requires `passed = true` |
| Escalated | case `ESCALATED` | inconclusive or owner action |
| Rejected / Safe refusal / Closed | `REJECTED` / `SAFE_REFUSAL` / `CLOSED_*` | terminal or refusal |
| Outcome unconfirmed | execution `UNKNOWN` | never styled as success or failure |
| AGENT / DETERMINISTIC | `CaseMode` | always visible in the top bar |

Additional rules:

- `MISMATCH` and `COMPENSATING` are labels, not persisted states; map them to `REOPENED`/`VERIFYING`
  and `EXECUTING`.
- `IntegrityStateBadge` takes `{kind: 'case' | 'action' | 'execution', value}` and reads a static
  label map in `lib/ui/status-labels.ts`. It performs no state arithmetic.
- Execution `UNKNOWN` renders `UnknownExecutionBanner`: *"Outcome unconfirmed — do not re-run. Verify
  the business state."* Verify is the only primary action; Execute stays disabled.
- A case whose audit write failed must never render a completed state.

## 7. Design system

### 7.1 Visual character

Near-black Carbon canvas · Graphite cards · Steel 1 px borders instead of shadows · Chalk primary and
Slate secondary type · Signal Red only for critical state, destructive action, focus or the single
primary action · Archivo for the interface · Space Mono for ids, timestamps, evidence labels,
environment markers and step numbers · 4 px radius throughout · no glassmorphism, glow, large blur,
soft shadow or decorative gradient.

Dark is the only theme in v1. There is no light theme, no theme switcher and no user-selectable accent.

### 7.2 Semantic colour extension

The seven brand colours are insufficient for an operational safety product; red cannot mean warning,
failure, active navigation and destructive action at once.

| Token | Value | Role |
|---|---:|---|
| `--color-operational-warning` | `#f2a93b` | deadline risk, degraded evidence, attention required |
| `--color-operational-success` | `#3fcf9b` | verified outcome, healthy integration |
| `--color-operational-info` | `#6ea8fe` | neutral process/investigation state |
| `--color-operational-muted` | `#b0abad` | secondary text needing stronger contrast than Slate |

Signal Red `#e32735` remains the brand and high-risk action colour. These four are semantic, not
decorative, and are the only additional colours permitted.

### 7.3 Canonical tokens

One token file, `src/app/globals.css`. When `next/font` supplies `--font-archivo` and
`--font-space-mono`, those two declarations move to the font loader; every other line is verbatim.

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-archivo);
  --font-mono: var(--font-space-mono);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-signal-red: #e32735;
  --color-carbon: #0b0405;
  --color-graphite: #150e0f;
  --color-steel: #382e30;
  --color-slate: #858182;
  --color-chalk: #ffffff;
  --color-foil: #000000;
  --color-operational-warning: #f2a93b;
  --color-operational-success: #3fcf9b;
  --color-operational-info: #6ea8fe;
  --color-operational-muted: #b0abad;

  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 4px;
  --radius-xl: 4px;
}

:root {
  --background: #0b0405;
  --foreground: #ffffff;
  --card: #150e0f;
  --card-foreground: #ffffff;
  --popover: #150e0f;
  --popover-foreground: #ffffff;
  --primary: #e32735;
  --primary-foreground: #ffffff;
  --secondary: #150e0f;
  --secondary-foreground: #ffffff;
  --muted: #150e0f;
  --muted-foreground: #b0abad;
  --accent: #22191b;
  --accent-foreground: #ffffff;
  --destructive: #e32735;
  --border: #382e30;
  --input: #382e30;
  --ring: #e32735;
  --radius: 4px;
  color-scheme: dark;
}

* {
  border-color: var(--border);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-archivo);
  letter-spacing: -0.02em;
}

code,
kbd,
time,
[data-instrument] {
  font-family: var(--font-space-mono);
  letter-spacing: 0;
}
```

### 7.4 Type scale

| Role | Size/line | Weight | Use |
|---|---|---:|---|
| Display | 56/1.1 | 500 | public hero only |
| Page title | 40/1.2 | 500 | major public headings |
| App heading | 28/1.2 | 500 | authenticated page title |
| Section heading | 24/1.2 | 500 | sections, case title |
| Body | 16/1.5 | 400 | explanatory content |
| UI body | 14/1.5 | 400/500 | controls, tables, forms |
| Instrument | 12/1.5 | 400 | ids, states, timestamps, badges |

### 7.5 Density

Row height 48 px default, 40 px compact · inputs 36 px, 40 px for primary forms · section gap 32–48 px
in the app, 80 px public · card padding 20–24 px in the app, 32 px public · minimum touch target 44 px
where touch is expected · dense desktop rows retain keyboard support.

## 8. Component inventory

### 8.1 Standard components (shadcn/ui on Base UI)

Button · IconButton · Input · Textarea · Select · Combobox · Checkbox · Radio Group · Switch · Dialog ·
Alert Dialog · Sheet · Drawer · Popover · Tooltip · Hover Card · Dropdown Menu · Context Menu ·
Command · Tabs · Accordion · Collapsible · Breadcrumb · Pagination · Table shell · Scroll Area ·
Separator · Badge · Alert · Skeleton · Form patterns and validation messages · Toast/Sonner.

### 8.2 Product components

| Component | Purpose |
|---|---|
| `ApplicationShell` | rail + top bar + content + optional context rail |
| `SignInPanel` | SSO action, dev-only credentials form, one alert region; renders no app data and no sign-up link |
| `NavigationRail` / `TopBar` | permission-filtered navigation and global status |
| `IntegrityStateBadge` | state label with icon, text and semantic tone; no colour-only dot |
| `ActionDiff` | before/after business-state comparison |
| `PolicyGateList` | deterministic checks with exact rule and policy version |
| `EvidenceCard` | source, timestamp, freshness, authority, conflict role |
| `EvidenceConflictMatrix` | side-by-side contradictory claims |
| `ImpactScopeSummary` | accounts, workflows, value, downstream exposure |
| `RecommendationPanel` | recommendation, uncertainty, citations, allowed actions |
| `DecisionPacket` | frozen approval-ready evidence and rationale |
| `ApprovalRail` | approver, threshold, comments, decision history |
| `QuorumSummary` | server `current / required`, missing roles, bound disposition, hashes, expiry |
| `ApprovalDecisionSheet` | decision, disposition, rationale; never contains Execute |
| `SoDExplainer` | the rule that blocks this actor, rendered instead of a silent disabled control |
| `RecoveryPlan` | scope, payload preview, idempotency key, verification plan |
| `ExecutionConfirmation` | exact target effect, restore point age, irreversible-write copy |
| `VerificationChecklist` | expected vs observed business state |
| `CaseTimeline` / `AuditEventRow` | evidence, agent, human and system events; immutable event row |
| `EvidenceGraph` | React Flow canvas plus accessible node list and relationship table |
| `BreakGlassBanner` / `BreakGlassDialog` | case-scoped elevation and its two-admin request flow |
| `DegradationBanner` | level, impact, operations link for `ops:read` |
| `PolicyChip` | active version + truncated hash, `STALE` variant on binding mismatch |
| `UnknownExecutionBanner` | amber "Outcome unconfirmed — do not re-run"; Verify is primary |
| `OpsTable` | dependencies, outbox, anchors, unknown executions, heartbeats; reason-required controls |
| `IdempotentForm` | one key per logical attempt, disabled in flight, shows `replayed` |
| `ErrorEnvelopeBanner` | code, sentence, next action, copyable `requestId` |
| `PermissionDenied` | route, required permission, held roles; fetches no data |
| `EmptyState` | icon, one sentence, one primary action |
| `ModeBadge` | `AGENT` / `DETERMINISTIC` always visible |

Naming bindings: the spec's `AuditEvent` component is exported as `AuditEventRow` to avoid colliding
with the `AuditEvent` model. `ApprovalDrawer` and `QuorumPanel` from the superseded brief are replaced
by `ApprovalRail`, `QuorumSummary` and `ApprovalDecisionSheet`. `CaseTable` is replaced by
`DataTable` + column definitions.

### 8.3 Anatomy rules

- Status badge: icon + label; never a colour-only dot.
- Destructive or irreversible action: explicit verb and object, not "Confirm".
- Generated recommendation is visually distinct from a policy result; policy is deterministic, the
  recommendation is not.
- Evidence citation: source name, record id, observed-at, freshness.
- Tooltip is supplemental; essential information stays visible.
- Empty state explains why it is empty and what action is possible.
- Toast confirms a request; it is never the only record of a consequential action.
- Every control that mutates renders from a permission check for usability only; the handler re-checks.

## 9. Motion policy

Allowed: 120–180 ms hover/focus · 180–240 ms dialog/sheet · one-time emphasis when a held action
enters a queue · event insertion in the timeline · connector animation during a live trace, settling
to static · verification progress while an observation is pending.

Prohibited: infinite moving cards · animated gradients · glow/spotlight in authenticated pages ·
number animation that obscures exact values · auto-advancing carousels · motion on audit evidence ·
decorative particles · parallax in operational workflows.

Respect `prefers-reduced-motion`; a critical state change remains understandable with all animation
removed. Magic UI may animate newly arriving case events; Aceternity may supply one public-page
background treatment. Neither survives without token conversion and accessibility review.

## 10. Interaction and safety patterns

### 10.1 Consequential confirmation

For release, block, compensate, policy activation and credential change: name the exact action and
target · show impact scope · show the governing policy and required approval · show payload/diff · show
the verification plan · require a reason for exceptions · record actor, time and environment.

Typed confirmation is reserved for production actions with unusually large scope: execute at
`riskScore ≥ 70` requires typing the case ref.

### 10.2 Separation of duties and quorum

- Approve and the post-approval step are separate surfaces. The same actor never sees an enabled
  execute or **Complete block**; they see `SoDExplainer` naming the rule.
- Quorum copy is factual and complete: `1 of 2 approvals — missing SENIOR_REVIEWER`, never "not
  allowed". A disabled execute names the code it would return.
- `QuorumSummary` renders only values from `GET /cases/:ref/approvals`; no client arithmetic, no
  optimistic increments.
- A `SUPERSEDED` / `EXPIRED` / `REVOKED` approval stays visible with its reason.
- Break-glass co-sign happens in a different session and is a separate dialog. The elevation is one
  approval; on a high-risk case it fills the senior slot only.

### 10.3 AI-generated content

Label **Agent recommendation**, never "Decision". Show citations inline. State unresolved
uncertainty. Preserve the previous version when evidence changes the recommendation. Separate model
reasoning from the deterministic policy outcome. Provide *"Why this changed"* after a recommendation
update. Unsourced sentences are visibly marked with *"no citation"*.

### 10.4 Errors and retries

- Inline errors for local form issues; a persistent page alert for failed saves or stale case state.
- Recovery and verification failures create durable workflow states, not toasts.
- Optimistic UI is prohibited for approve, execute, verify, publish, release and compensate.
- Every 409/422/503 renders code + sentence + next action + `requestId`:
  `APPROVAL_QUORUM_NOT_MET` → missing roles; `APPROVER_CANNOT_EXECUTE` → another executor;
  `APPROVAL_EXPIRED` / `EVIDENCE_CHANGED` / `POLICY_STALE` → re-approve; `BREAK_GLASS_INCOMPLETE` →
  complete co-sign; `DEGRADATION_BLOCKED` → name the level.
- `RATE_LIMITED` shows the `Retry-After` countdown; `RATE_LIMITER_UNAVAILABLE` fails closed with a 503
  page, never a retry loop.
- No automatic retry of a write. A lost target response becomes `UNKNOWN` and is resolved by Verify.
- One `Idempotency-Key` per case lifecycle; a new key after a reopen. Double-submit with the same key
  shows `replayed`; a new key after a terminal state shows `INVALID_TRANSITION`.
- Back after execution must not re-trigger it: `POST` is not in history; refresh re-fetches state.

### 10.5 Session and drafts

Session expiry during approval → `/login?next=…`; the rationale is restored once from
`sessionStorage`, then deleted. Leaving an unsaved rationale warns before navigation; the draft is
kept for one return only. No session token, evidence excerpt or rationale in `localStorage`.

## 11. Accessibility

WCAG 2.2 AA.

- Full keyboard operation for navigation, queues, dialogs, menus, approval, execution, break-glass and
  verification flows.
- Visible focus ring in Signal Red with a light offset; never removed.
- Skip link; landmarks and heading hierarchy on every page.
- Accessible names for icon-only controls; table header, sort and selection announcements.
- Live regions for incoming evidence, quorum changes, degradation changes and break-glass state
  changes — a banner appearing is not the only signal.
- The graph has a navigable node list and relationship table.
- On `/login`, the alert is announced once when it appears and focus moves to it, not to the page
  top; the reveal toggle is a labelled button, not an icon with a tooltip.
- Red is never the sole signifier; diff indicators use icon + text.
- Slate `#858182` is not used for small essential text on Graphite; use Operational Muted.
- Timers and SLA clocks expose the absolute deadline as text, not only a visual clock.
- Zoom to 200% without losing workflow functionality; all motion has a reduced-motion path.
- Error banners are focusable and readable by screen readers.
- Dialog focus moves in on open and returns to the trigger on close.

## 12. Frontend architecture

```
src/
├─ app/
│  ├─ (public)/{page,trust}/          # public introduction
│  ├─ (auth)/login/page.tsx           # sign-in only; no signup, invite or reset route
│  ├─ app/                            # authenticated shell
│  │  ├─ layout.tsx                   # rail + top bar + permission guard
│  │  ├─ overview/  actions/  investigations/  evidence/
│  │  ├─ recoveries/  verification/  policies/  integrations/
│  │  ├─ audit/  analytics/  settings/
│  │  └─ forbidden/
│  └─ api/v1/...                      # control plane; no UI logic
├─ components/
│  ├─ ui/                             # shadcn on Base UI, the only primitive surface
│  ├─ accent/                         # reviewed Magic/Aceternity adaptations
│  ├─ shell/                          # rail, top bar, page header, banners
│  ├─ actions/  investigations/  evidence/  recoveries/
│  ├─ policies/  audit/  analytics/  settings/
├─ lib/
│  ├─ api/                            # typed fetch, envelope unwrap, error map
│  ├─ auth/  permissions/             # session re-read, can(), route coverage
│  ├─ schemas/                        # Zod contracts shared with route handlers
│  ├─ ui/                             # status labels, formatting, icon map
│  ├─ telemetry/  utils/
```

Supporting choices:

- Server Components by default; `'use client'` only for interactive tables, graphs, complex forms and
  live streams.
- TanStack Query only where server state needs client caching or polling. No `useEffect` data
  fetching.
- TanStack Table for queue behaviour; React Hook Form + Zod for policy, approval and evidence forms.
- Recharts with an accessible table fallback; charts stay subordinate to case evidence.
- Storybook (or equivalent) is the component workbench for states and visual regression.
- Filters, sort, saved view and time range live in the URL. Sensitive payloads, free-text evidence and
  rationales never do.
- Pages render a stable server snapshot, then subscribe where required. Every surface shows
  `last updated` and a stale state; old risk is never silently presented as current.
- Components never import Prisma, adapters or `lib/target`.
- `lib/permissions/` is a client-safe facade over `lib/rbac.ts` (route permissions and `can()`); it is
  not a second permission source and contains no quorum, risk or policy logic.

## 13. Build sequence and acceptance

| Phase | UI scope |
|---|---|
| **0** | Next.js + Tailwind v4 + shadcn on Base UI, canonical tokens, Archivo/Space Mono, shell and route skeletons, Storybook workbench, permission plumbing |
| **8** | Public pages, sign-in (OIDC + dev credentials) with its failure states, Overview, Action Queue and detail, Investigations and workspace, Recoveries and run, Verification, Audit list, Policies read-only, settings shell, `/forbidden` |
| **9** | Evaluation harness and its data contract; the tab itself arrives with Analytics in Phase 10 |
| **10** | KPI sections, evaluation tab and audit chain proof/export |
| **11** | Operations, Access, Approvals, break-glass UI, policy activation, Integrations/contracts |
| **12–13** | Degradation/failure states, accessibility audit, performance, visual regression, reduced-motion review, demo polish |

MVP order if time is constrained: Action Queue → Action detail → Investigation workspace → Recovery run
→ Verification → Audit → minimal Overview. Do not build the marketing page or a broad dashboard first.

Acceptance:

- [ ] The full loop is completable without returning to a generic dashboard.
- [ ] Every recommendation links to evidence; policy outcomes are visually distinct from agent
      recommendations.
- [ ] An approver can see scope, uncertainty and verification before acting.
- [ ] A 200 from the write API cannot close a recovery; only `passed = true` does.
- [ ] A failed verification creates visible, durable work.
- [ ] The same state vocabulary appears in navigation counts, queues, detail, audit and analytics.
- [ ] All critical workflows are keyboard usable at 1024 px; no essential meaning depends on red alone.
- [ ] Accent components pass token and accessibility review; Mantine and daisyUI are absent from the
      tree.
- [ ] Public motion disappears under `prefers-reduced-motion`; authenticated pages contain no glow,
      gradient card or infinite animation.
- [ ] `VIEWER` sees no mutating control; `ADMIN` sees no approve/execute; `AUDITOR` is read-only.
- [ ] Every surface implements loading, empty, error, partial and stale states.
- [ ] `/login` completes the OIDC flow, returns to a same-origin `next`, and discards any other value.
- [ ] A failed sign-in shows one generic sentence for both an unknown email and a wrong password.
- [ ] A production build renders no password field and no sign-up, invite or reset link.
- [ ] Exceeding the `/auth/*` limit shows the `RATE_LIMITED` copy with a disabled submit; a limiter
      outage shows `RATE_LIMITER_UNAVAILABLE` and never an unthrottled fallback.

## 14. What the UI must never do

- Show "success" before a `VerificationResult` with `passed = true`.
- Present `UNKNOWN` as success or failure.
- Offer approve and execute in one click, or to the same person.
- Derive quorum, risk, disposition, policy hash or degradation from client constants.
- Treat a hidden button as authorization, or a disabled button as the only enforcement.
- Echo prompts, evidence excerpts, rationales, secrets, emails or upstream messages into logs, URLs,
  error copy or analytics.
- Auto-retry a write, or resubmit with a new key because the first attempt looked stuck.
- Display a completed state for a case whose audit write failed.
- Use a second component/theming system, a second radius or type scale, emoji iconography, glow,
  glassmorphism or decorative gradients in the authenticated product.
- Present an editable policy or a fake notification preference that has no endpoint behind it.
- Offer self-service sign-up, invitation or password reset, or tell a caller whether an email exists.
- Render a password field in production, or keep one in the bundle and hide it with CSS.
