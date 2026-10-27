# Phase 8 — Operator control room

**Read first:** `docs/APP_FLOW.md` (all), `docs/UI_UX_BRIEF.md` (all), `docs/API.md` §6.2–§6.5,
`docs/RBAC.md` §3–§7.
**Goal:** two different people can drive the loop in a browser — approve, then execute — every actor
can see why they cannot do something, and the shell matches the steel-blueprint IA.
**Depends on:** Phase 7 green (execute must work before the UI can call it).

## Scope guard

No new backend behaviour. If a screen needs a field the API does not return, extend the existing
projection server-side; do not add business logic to components and do not compute quorum, risk,
policy or degradation in the browser. No client-side calls to `/sources/*`, `/target/*` or
`/internal/*`. The additive read shapes this phase consumes are `GET /actions/:id`,
`GET /cases?disposition=` and `GET /admin/break-glass`; if one is missing, stop and report it rather
than filtering a list in the client.

## Build

0. Install the approved UI stack: `shadcn/ui` generated on the **Base UI** base, `@tanstack/react-table`,
   `reactflow`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`. Do not install Mantine or
   daisyUI. Do not install a chart library in this phase. Storybook (or the project workbench) is
   scaffolded with default, hover, focus, disabled, loading and error states.
1. `src/app/globals.css`: the canonical token block from `UI_UX_BRIEF.md` §7.3, dark only; Archivo and
   Space Mono via `next/font`; 4 px radii; no shadows, glow or gradients. Map tokens through
   `@theme inline`; no hex literals in components.
2. Public pages: `/` (hero, restrained Detect → Hold → Investigate → Decide → Recover → Verify loop,
   before/after entitlement scenario, *"Open sandbox"*), `/trust` (operating model and the known gaps
   from `SECURITY.md` §11). At most one adapted Aceternity treatment and one Magic UI animation, both
   under `components/accent/*`, both reduced-motion safe.
3. `src/app/(auth)/login/page.tsx` + `src/components/auth/SignInPanel.tsx` per `UI_UX_BRIEF.md`
   §5.1: two-pane layout above 1024 px, one `h1`, `Continue with SSO` as the only production action.
   The email/password block renders only when `AUTH_CREDENTIALS_ENABLED=true` and
   `NODE_ENV !== "production"` — absent from the production render, not CSS-hidden — and holds the
   seeded one-click fills. One `role="alert"` region carries generic failure copy, `RATE_LIMITED` with
   the `Retry-After` window, `503 RATE_LIMITER_UNAVAILABLE` with the `requestId`, `?reason=session_stale`,
   `USER_INACTIVE`, an OIDC role outside the allowlist, and provider-unreachable. `next` is honoured
   only when it is a same-origin relative path; an authenticated visitor to `/login` is redirected
   before paint. No sign-up, invite or reset route or link exists anywhere in the app.
4. `src/app/api/auth/[...nextauth]/route.ts` + `src/lib/auth/`: Auth.js v5; the session carries user id
   and `sessionEpoch` as UI hints only. Every privileged request re-reads `User` server-side; stale
   epoch ⇒ 401 `SESSION_STALE`; inactive ⇒ 403 `USER_INACTIVE`.
5. `src/app/app/layout.tsx`: `ApplicationShell` with a 248/72 px rail grouped Monitor · Investigate ·
   Resolve · Control · Improve · Administration, filtered by `can(permission)` — hidden, not disabled.
   Top bar: environment, global search, `ModeBadge`, `PolicyChip`, degradation chip, user menu with
   every held role. `Ctrl/Cmd + K` command menu. Global banners: degradation, `L4` chain break,
   `BreakGlassBanner`, policy-superseded. `ADMIN` banner: *"Platform administrators do not decide
   business actions."*
6. `/app/overview`: posture strip (held, awaiting decision, verification failures), ranked *"Needs
   attention now"*, 24 h action flow, recent integrity signals with freshness, and health. The
   recovery/verification trend panel is added with `/app/analytics` in Phase 10; do not fake it from
   client counts. One primary action: **Review highest-risk action**.
7. `/app/actions`: `DataTable` on TanStack Table, server-side filter/sort/pagination; saved views
   `Held`, `Evidence missing`, `Approval due`, `Already executed`, `My queue`; bulk actions limited to
   assignment, evidence request and export; keyboard row navigation; 48/40 px density.
8. `/app/actions/[actionId]`: header, `ActionDiff`, `PolicyGateList` with policy version,
   `EvidenceConflictMatrix`, `ImpactScopeSummary`, `RecommendationPanel` labelled **Agent
   recommendation** with citations, context rail (owner, approval requirement, history). Primary action
   varies by state; never "Approve" before evidence, impact and verification are visible.
9. `/app/investigations`: six queue views (active, evidence, owner, approval, reopened, escalated) with
   hypothesis count, unresolved conflicts, affected actions, owner and SLA.
10. `/app/investigations/[caseId]`: three-zone workspace (case spine, evidence workbench, decision
    rail) with tabs Summary · Evidence · Impact · Hypotheses · Collaboration · Decision record.
    - Summary: integrity event, exposed action, gate reasons, restore point, hold age.
    - Evidence: `EvidenceCard` grouped by stance; missing list; request form; add-evidence dialog;
      side-by-side comparison; pin to decision record; `"Why this changed"` after a report update.
    - Hypotheses: statements, confidence, citations, `AGENT` label, `no citation` marker, fallback tag,
      **Run investigation** with polling while `INVESTIGATING` and *"Baseline mode"* when deterministic.
    - Decision record: `DecisionPacket` → `ApprovalRail` (`QuorumSummary`, approval rows with
      `VALID`/`SUPERSEDED`/`EXPIRED`/`REVOKED` and reason, `ApprovalDecisionSheet`, `SoDExplainer`) →
      post-approval step (separate `ExecutionConfirmation` or **Complete block**) → verification.
    - `DecisionPacket` for `SAFE_REFUSAL` with the downloadable JSON + Markdown evidence packet; no
      approve or execute affordance.
    - `UnknownExecutionBanner` with Verify as the only primary action; **Complete block** is never
      labelled Execute; execute at `riskScore ≥ 70` requires typing the case ref.
11. `/app/recoveries` and `/app/recoveries/[caseId]`: `RecoveryPlan`, idempotency key, dry-run result,
    `ExecutionConfirmation`, and the seven-step run indicator (scope locked → policy checks → approval
    → compensation executed → target observed → downstream reconciled → case closed). A failed
    verification never marks the run complete.
12. `/app/verification`: closure queue (awaiting observation, target mismatch, downstream mismatch,
    duplicate suspected, ready to close, reopened) with `VerificationChecklist`, expected/observed,
    observation time, source and reconciliation checks.
13. `/app/policies` and `/app/policies/[policyId]` (read-only in this phase): active version, hash,
    status, history, human-readable rule summary. No editor, no simulation, no activation control yet.
14. `/app/settings` shell and `/forbidden`: route, required permission, held roles, `requestId`; fetches
    no resource data.
15. Client plumbing: typed `apiFetch<T>` unwrapping the envelope and exposing `error.code`;
    `IdempotentForm` generating one key per logical attempt and showing `meta.replayed`; polling hook
    that stops on terminal states; `ErrorEnvelopeBanner` mapping 409/422/503 to the next action in
    `APP_FLOW.md` §17; no optimistic updates for approve, execute, verify, release or block.
16. `IntegrityStateBadge` reads `lib/ui/status-labels.ts` and takes `{kind, value}`; it renders the
    real `CaseStatus` / `OutboundActionStatus` / `ExecutionStatus`, never the conceptual labels as
    stored states.
17. Accessibility and states per `APP_FLOW.md` §15/§19 and `UI_UX_BRIEF.md` §11: focus trap, skip
    link, live regions for quorum/degradation/break-glass, text deadlines, 200% zoom, 1024 px layout.
18. Playwright e2e:
    - **two-session journey**: `reviewer` approves A; `reviewer2` completes the block; verify closes;
    - **quorum**: `reviewer` approves K; execute disabled with `1 of 2 — missing SENIOR_REVIEWER`;
      `senior` approves; `reviewer2` executes;
    - **SoD**: approver sees `SoDExplainer` and no execute control;
    - **roles**: `VIEWER` has no mutating controls; `ADMIN` sees no approve/execute;
    - **failure UI**: `UNKNOWN` is amber and never "success"; `POLICY_STALE` shows re-approve.

## Acceptance criteria

- [ ] Scenario A completes in the browser with two different users and no manual API calls.
- [ ] `/login` completes the OIDC flow on a production build with no password field, no sign-up, invite
      or reset link, and no app data in the page source.
- [ ] An unknown email and a wrong password produce the same sentence; an off-origin `next` lands on
      `/app/overview`; exceeding the `/auth/*` limit shows the retry window.
- [ ] The authenticated shell, route names and navigation groups match `UI_UX_BRIEF.md` §3–§4.
- [ ] Approve and Execute are separate surfaces; Execute is disabled with a text reason until
      `APPROVED`, then disabled for approvers with `SoDExplainer`.
- [ ] Quorum values come from `GET /cases/:ref/approvals`; changing the DOM or replaying an old
      response cannot enable execute (server returns 409).
- [ ] A one-approval high-risk case shows `1 of 2`, the missing role, and the expiry clock.
- [ ] `SAFE_REFUSAL` renders no approve/execute affordance.
- [ ] `UNKNOWN` renders amber with *"Outcome unconfirmed — do not re-run"*; Verify is primary.
- [ ] Verification failure shows expected vs observed with mismatch rows marked.
- [ ] `ADMIN` sees no business actions; `VIEWER` sees no mutations; `AUDITOR` sees read-only pages.
- [ ] Session expiry mid-approval returns to the case with the rationale restored exactly once.
- [ ] Switching tabs does not refetch the whole case (network panel check).
- [ ] Keyboard-only approval works with visible focus; live regions announce quorum changes.
- [ ] Loading, empty, error and partial states exist for every surface in `APP_FLOW.md` §15.
- [ ] No component imports Prisma, the adapters, or `/internal/*`.
- [ ] Mantine and daisyUI are absent from `package.json` and the lockfile.
- [ ] Public-page motion disappears under `prefers-reduced-motion`; authenticated pages contain no
      glow, gradient card or infinite animation.

## Verification

```bash
npm run typecheck && npm run lint && npm run build
npm run test:e2e -- case-loop quorum sod roles
npm run test:rbac -- ui-routes
```

## Commit

`feat(console): evidence-led control room with two-person approval, quorum and UNKNOWN states`

## Stop

Report per `AGENTS.md` §6. Do not build the Evaluation tab (Phase 9), KPI analytics or the global audit
ledger (Phase 10), or the operations/access/approvals settings pages (Phase 11).
