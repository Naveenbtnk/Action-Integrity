# DECISIONS — Architecture Decision Records

Chronological. Each ADR states the decision, why, what it costs, and what would reverse it.
Never delete an ADR; mark it `SUPERSEDED` and link the replacement.

---

### ADR-001 — Narrow to a single action class and a single target system

**Status:** Accepted (2026-10-26)
**Decision:** v1 covers entitlement revocation/grant and account-service-status changes against one
synthetic target system. Nothing else.
**Why:** The project's differentiation is the closed loop, not breadth. Breadth would force generic
rollback, which is explicitly out of scope and not provable in one build.
**Cost:** Limited commercial surface; a pilot needs an adapter build-out.
**Reversal:** Add a second action class only after the first loop is measured.

### ADR-002 — Single Next.js application instead of separate services

**Status:** Accepted
**Why:** One deploy, one auth model, one type system, no service mesh. The control plane is
I/O-light; there is no scale reason to split.
**Cost:** Serverless cold starts; the in-process rate limiter was a documented gap, now addressed by
ADR-024 (external fail-closed limiter).
**Reversal:** Split the control plane into a long-running service if background evaluation becomes
the dominant workload.

### ADR-003 — Determinism boundary: the model never writes

**Status:** Accepted — **constitutional**
**Decision:** LLM output is a recommendation object. Gates, thresholds, writes and verification are
code. The investigator has no write tool and no credentials.
**Why:** It is the only way to claim "governed" credibly, and it makes the system testable — the
same evidence must produce the same control decision.
**Cost:** Less flexible remediation; some cases the model could handle are escalated.
**Reversal:** None acceptable. Weakening this ends the project's premise.

### ADR-004 — Gemini behind an `LlmClient` interface

**Status:** Accepted
**Why:** One narrow interface (`generateJson(schema, prompt) → validated object`) means the
evaluation can run against a stub, the provider can change without touching `lib/agent`, and CI never
needs an API key.
**Cost:** Slight indirection.
**Reversal:** Only if a provider's feature (e.g. native grounding) is required.

### ADR-005 — Synthetic enterprise systems behind adapters

**Status:** Accepted
**Decision:** Five read-only source adapters read `src_*` in-process. The target system is reached
over HTTP (`/api/v1/target/*`, `x-target-key`) by an adapter in `lib/adapters/target`, so the write
credential has a real enforcement point. `lib/target/service.ts` owns `tgt_*`.
**Why:** Real credentials are unavailable and would make the demo non-reproducible. Adapting over a
narrow interface makes the swap a one-file change, and the HTTP boundary keeps the target's
permissions, idempotency and audit independent of the control plane.
**Cost:** One extra hop per target write and a base URL to configure. The demo proves the mechanism,
not an integration.
**Reversal:** Replace one adapter with a real sandbox tenant for a pilot.

### ADR-006 — Prefixed tables instead of Postgres schemas

**Status:** Accepted
**Decision:** `src_*` and `tgt_*` table prefixes in one schema. `src_*` is read only by source
adapters and the seed; `tgt_*` is written only by `lib/target/service.ts`.
**Why:** Prisma's multi-schema support is still a preview feature; a preview feature in the data
layer is an unnecessary risk for a demo. The boundary that matters is module ownership, which is
enforceable by review and a source-scan test.
**Cost:** Weaker database-level separation; a careless developer can join across families.
**Reversal:** Move to real schemas when Prisma multi-schema is GA and a second target exists.

### ADR-007 — One compensation mechanism: `RESTORE_LAST_KNOWN_GOOD`

**Status:** Accepted
**Decision:** Compensation restores a target object to a restore point captured immediately before
the original write. No other compensation type exists. No restore point ⇒ refuse.
**Why:** It is deterministic, idempotent, bounded, and verifiable. Inventing per-action compensation
logic would be universal rollback in disguise.
**Cost:** Actions that were never captured cannot be compensated.
**Reversal:** A second mechanism requires a new ADR and an explicit risk review.

### ADR-008 — Role-based authorization, no row-level ownership

**Status:** Accepted for v1, **must be revisited before multi-tenant use**
**Why:** Incident response requires organisation-wide visibility; per-user ownership would hide the
cases that matter. The MVP is single-organisation.
**Cost:** Not tenant-safe. Recorded as a known gap in `SECURITY.md` §11.
**Reversal:** Add `organisationId` to case tables plus query scoping before any multi-customer pilot.

### ADR-009 — Evaluation suite is a first-class deliverable

**Status:** Accepted; amended 2026-10-26 by ADR-016/017/019 (production tiers)
**Decision:** 13 frozen fixtures (A–L plus the injection fixture X), two modes sharing one pipeline,
metrics computed from rows. Production edition adds adversarial (T2), authorization (T3), load (T4),
chaos (T5), DR (T6) and canary (T7) tiers; T1 remains the release-blocking functional suite.
**Why:** The project's success criteria require measurable performance against a deterministic
baseline. Without it, the pitch is unverifiable. Production controls are only credible if they are
also attacked in a test.
**Cost:** Build time; fixtures must be maintained; the higher tiers cost compute and (for T2/T7)
tokens.
**Reversal:** None. Removing the suite removes the ability to claim the result.

### ADR-010 — Append-only, hash-chained audit ledger

**Status:** Accepted
**Decision:** `AuditEvent` rows are immutable at both the Prisma and Postgres layers, and each row
links to the previous hash.
**Why:** The product sells defensible accountability. A mutable log invalidates every claim.
**Cost:** No corrections; a mistaken event must be superseded by a new one.
**Reversal:** None.

### ADR-011 — Auth.js credentials provider, seeded users, no OAuth

**Status:** **SUPERSEDED by ADR-022** (OIDC in production; credentials remain local/preview only)
**Why (at the time):** Demo users only; OAuth adds provider configuration without proving anything
about the product. Credentials keep the demo self-contained.
**Cost:** No SSO/MFA — a real pilot prerequisite.
**Reversal:** Add an OIDC provider before a pilot; role claims must still be re-read from the DB.

### ADR-012 — Deterministic baseline shares the entire pipeline

**Status:** Accepted
**Decision:** Only the `InvestigationReport` producer differs between modes.
**Why:** Any other difference would confound the comparison and make the delta meaningless.
**Cost:** Baseline must implement the same interface, including citations (trivially derived).
**Reversal:** None.

### ADR-013 — All target writes flow through the executor, including `ALLOW`

**Status:** Accepted
**Decision:** On an `ALLOW` gate decision the control plane performs the write itself after capturing
a restore point; the calling automation never touches the target system.
**Why:** A gate the caller can bypass is advisory, not enforcement. Routing every write through one
module keeps credential scope, restore-point capture, idempotency and audit in a single place.
**Cost:** The control plane sits in the latency path of every allowed action.
**Schema consequence:** Gate-level `ALLOW` has no case. Its `ActionExecution` and
`VerificationResult` have nullable `caseId`, remain linked to the outbound action and execution,
and carry a pre-write restore point. An ambiguous result remains `UNKNOWN` until a safe read
resolves it; the reconciler never repeats the write.
**Reversal:** Only if latency becomes unacceptable; then the executor becomes a sidecar with the same
guarantees, not a bypass.

### ADR-014 — `INVESTIGATION_MODE` is environment-scoped, not per-case

**Status:** Accepted
**Decision:** Mode is set by env for the whole deployment, and recorded on every case and report.
**Why:** Mixed modes within one run make evaluation and audit ambiguous.
**Cost:** Cannot A/B within a single demo session without redeploying (mitigated: eval runs set mode
per run explicitly).
**Reversal:** Allow per-run override only in the eval harness, never in the console.

### ADR-015 — Dispositions describe what happens to the action, not the business outcome

**Status:** Accepted
**Decision:** `BLOCK` means "the submitted action is rejected and the target must remain unchanged";
`RELEASE_AFTER_CORRECTION` means "the held action is valid and executes as submitted". A prevention
success is therefore a verified `BLOCK`, not a release. Policy normalizes a recommendation to the
action's state (a block on an executed action becomes compensation).
**Why:** "Release" was being read two ways — release the hold, or let the action run. That ambiguity
made Scenario A (entitlement must stay `ACTIVE`) impossible to satisfy and would have let a reviewer
"approve" the very write the product exists to stop.
**Cost:** Two disposition fields in fixtures (`reportDisposition`, `policyDisposition`) and an extra
case transition (`APPROVED → VERIFYING` for a block).
**Reversal:** None while the product's claim is "prevent or repair the business action".

### ADR-016 — Permission-based RBAC with separation of duties

**Status:** Accepted (2026-10-26) — supersedes the earlier three-role hierarchy
**Decision:** Six human roles (`VIEWER`, `ANALYST`, `REVIEWER`, `SENIOR_REVIEWER`, `ADMIN`,
`AUDITOR`) and three service principals, mapped to explicit permissions. Authorization is checked at
the route boundary by permission, deny by default. `ADMIN` cannot approve or execute business
actions and cannot also hold a reviewer or auditor role. Every write execution requires an executor
who is not an approver.
**Why:** A three-role hierarchy made `ADMIN` a super-user who could approve and execute the same
action: the exact conflict of interest the product claims to prevent. Permissions also let the
console be precise about who can do what without inventing role inheritance.
**Cost:** More roles, seven seeded users, three humans needed for a high-risk demo (two approvers and
a distinct executor), and a break-glass path for staffing gaps.
**Reversal:** None for a product whose value is accountability. A demo that cannot field a reviewer
and a senior may use break-glass, which still requires two distinct humans.

### ADR-017 — Quorum approvals bound to evidence and policy

**Status:** Accepted
**Decision:** An approval is tied to `(evidenceHash, policyHash, reportId, disposition)` and expires
after 12 hours. High risk (`risk ≥ 70` or `exposure ≥ 250`) requires two distinct approvals, one from
a `SENIOR_REVIEWER`. Evidence, a new report, or a policy activation supersedes valid approvals and
moves `APPROVED → AWAITING_APPROVAL`. The unique key becomes `(caseId, reopenCount, reviewerId)`.
**Why:** One approval by one person is a single point of compromise, and an approval given against an
earlier evidence set is not consent to the current one. Binding makes "approved" a statement about a
specific decision, not a property of the case.
**Cost:** More latency and UI state; approvals are invalidated more often, which reviewers will find
annoying and correct.
**Reversal:** Never for high risk. Low/medium risk already requires one approval; reducing that to
zero removes the human-accountability story.

### ADR-018 — Policy versions are hash-pinned and activated explicitly

**Status:** Accepted
**Decision:** `config/policy/<version>.json` is a versioned document. Exactly one `PolicyVersion` is
`ACTIVE`. Activation requires the version, its computed hash and a review-ticket id. Every
`PolicyDecision` stores `policyVersion`, `policyHash`, `evidenceHash` and `inputsHash`, and the
executor re-checks the active hash before writing.
**Why:** A policy file is a security control. Silent edits, a bad deploy, or two versions live at once
would change decisions without a trace. Pinning makes every decision reproducible and every approval
provably about the rules that were in force.
**Cost:** An explicit activation step and invalidation of approvals on change.
**Reversal:** None. A policy change is a change-control event, not a config tweak.

### ADR-019 — Transactional outbox for post-commit side effects

**Status:** Accepted
**Decision:** Notifications, anchor triggers and KPI-snapshot triggers are `OutboxEvent` rows written
inside the business transaction. A publisher drains them with `FOR UPDATE SKIP LOCKED`, bounded
retries (8) and exponential backoff with jitter, then DLQ. Replay is explicit and audited.
**Why:** Fire-and-forget after commit loses work on a crash; a distributed transaction with the
target is not available and would be worse. The outbox is the standard minimal mechanism with no new
broker.
**Cost:** Eventual delivery, an extra table and worker, and consumers that must be idempotent.
**Reversal:** Only if a durable broker with exactly-once semantics is introduced; the outbox remains
the source of truth for what must be delivered.

### ADR-020 — OpenTelemetry and Pino as the observability stack

**Status:** Accepted
**Decision:** Pino JSON logs and the OTel SDK (OTLP/HTTP) behind `lib/observability`. No vendor SDK
in domain code. Metric names, span attributes and log fields are fixed in `OBSERVABILITY.md`.
**Why:** The control plane's value depends on being able to reconstruct one case end to end and to
alert on invariant breaches. A vendor-neutral interface keeps the demo runnable with no collector
and allows a pilot to point at its own backend.
**Cost:** Two dependencies (approved here), configuration, and discipline about cardinality and PII.
**Reversal:** Replace the exporter, not the instrumentation points.

### ADR-021 — Audit chain anchored to external append-only storage

**Status:** Accepted
**Decision:** Every hour a Merkle root over new `AuditEvent` hashes is written to an object-lock
bucket (S3 Object Lock or equivalent) and recorded in `AuditAnchor`. Local development writes files to
`var/anchors/`. Verification compares the chain to the external objects.
**Why:** A hash chain inside the same database proves only that a tamperer forgot to rewrite the
chain. An external, immutable copy is evidence a third party can check. This closes the "detectable
but not provable" gap.
**Cost:** Bucket configuration, storage cost, up to 2 hours of anchoring lag, and a credential to
protect.
**Reversal:** Change the anchor store, not the algorithm; old anchors remain valid evidence.

### ADR-022 — OIDC for humans; credentials are development-only

**Status:** Accepted — supersedes ADR-011
**Decision:** Production uses an OIDC provider (authorization code + PKCE) with role claims mapped
through an allowlist. The credentials provider is local/preview only and refuses to start in
production. Role, `sessionEpoch` and active state are re-read from the database on every privileged
request. MFA is enforced at the IdP.
**Why:** A shared password cannot provide individual accountability, and MFA belongs at the identity
provider. OIDC also makes deactivation and role change take effect without a password reset.
**Cost:** An IdP dependency (`L5` degradation), configuration, and a claim-mapping failure mode.
**Reversal:** None for production. The credential provider exists for offline demo reliability, not
as a fallback.

### ADR-023 — At-most-once target writes with explicit `UNKNOWN`

**Status:** Accepted
**Decision:** The executor never retries a target write. It commits intent (`PENDING`) and an outbox
event, calls the target exactly once, then records the outcome. A timeout, network error or lost
response becomes `UNKNOWN`. A verification read resolves it: observed == expected ⇒ `SUCCEEDED`;
otherwise `FAILED`. The system never claims exactly-once delivery to the target.
**Why:** A lost response makes "did it apply?" unknowable without target cooperation. Retrying can
double-apply a state change; assuming success can close a case that was never repaired. `UNKNOWN`
plus a read is the only honest option, and it is verifiable.
**Cost:** Some cases stay open until verified; operators must not retry manually.
**Reversal:** Only if the target exposes an idempotent commit with a status query; then a bounded
retry becomes safe and this ADR is amended.

### ADR-024 — Shared, fail-closed rate limiter

**Status:** Accepted
**Decision:** Rate limiting uses a shared store (Redis or platform WAF) in production, fails closed
with 503 `RATE_LIMITER_UNAVAILABLE`, applies per-IP and per-email counters on authentication, and
exports the route table so a new route without a limit fails startup.
**Why:** Per-instance memory in serverless does not limit anything; failing open during a limiter
outage turns a dependency problem into an unthrottled attack surface. Auth needs both IP and email
counters to resist distributed and targeted attempts.
**Cost:** A Redis/WAF dependency; a limiter outage blocks writes, which is the intended failure mode.
**Reversal:** A platform WAF with the same semantics may replace Redis; the fail-closed rule stays.

### ADR-025 — One owned frontend system: shadcn/ui on Base UI, with specialist libraries

**Status:** Accepted
**Decision:** The production frontend uses shadcn/ui generated on the Base UI primitive base as its
only component layer. TanStack Table owns queue behaviour, React Flow owns the evidence graph, React
Hook Form + Zod own forms, and Storybook is the component workbench. Magic UI and Aceternity UI are
source-copied accents in `components/accent/*`, not dependencies with their own styling. Mantine and
daisyUI are prohibited. Dark-only "steel blueprint at midnight" tokens, Archivo/Space Mono and 4 px
radii are canonical in `UI_UX_BRIEF.md` §7.
**Why:** The control room needs dense, keyboard-complete, auditable interactions and a single status
semantics. Two component or theming systems would drift, double the accessibility surface and make a
disabled control look like the only enforcement. A headless table and graph let the project own markup,
tokens and focus behaviour instead of fighting a pre-themed grid or canvas.
**Cost:** Source ownership (upgrades are manual), two specialist dependencies, and accent components
must be re-tokenised and reviewed. Accessibility remains a project responsibility, not a library
guarantee.
**Reversal:** Replacing the component base requires re-generating `components/ui/*` and a new ADR; the
route, permission and state contracts in `APP_FLOW.md` are unaffected.

### ADR-026 — Begin on patched framework, ORM and validation majors

**Status:** Accepted
**Decision:** Phase 0 pins Next.js 16.4.3, React 19.3.1, Prisma 7.10.1 and Zod 4.6.7 on Node 24.
Prisma uses its required PostgreSQL driver adapter and generated-client output. Builds use webpack
until the observed Windows Turbopack worker panic is resolved upstream.
**Why:** The originally specified Next.js 15, Prisma 6 and Zod 3 lineages failed the repository's
zero-high-vulnerability release gate during the 2026-10-27 foundation audit. Starting from known
vulnerable majors would contradict `SECURITY.md`. The migration behavior was checked against the
[Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16),
[Prisma 7 upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7),
and [Zod 4 migration guide](https://zod.dev/v4/changelog).
**Cost:** Node 24 is required; Prisma needs an explicit driver adapter; migration work is pulled into
the foundation; the build temporarily opts out of Turbopack.
**Reversal:** Move within patched supported versions after type, test, build and vulnerability gates
pass. Reverting to an advisory-affected major is prohibited.

### ADR-027 — Astro for the static public site; Next.js for the control room

**Status:** Accepted
**Decision:** The public product and trust pages are a separate static Astro site under
`apps/public`. The authenticated control room, API, identity, audit and all business actions stay in
the Next.js application. The sites deploy as separate projects, with the Astro site on the public
origin and Next.js on the console origin. A configured `PUBLIC_CONSOLE_URL` links public pages to
the console sign-in route. They share the canonical design tokens and copy rules, not a runtime or
session cookie.
**Why:** The user requested Astro for the public experience. Static pages benefit from Astro's
HTML-first build, while the existing React and server-side control plane remain together. Astro's
React integration enables React inside an Astro project; it does not integrate Astro pages into a
Next.js route tree. Sources: [Astro React integration](https://docs.astro.build/en/guides/integrations-guide/react/)
and [Astro Vercel deployment](https://docs.astro.build/en/guides/integrations-guide/vercel/).
**Cost:** Two builds and two deployment origins, plus explicit token and content synchronization.
The public site must never handle authentication, evidence or business mutations.
**Reversal:** The public pages can move back to Next.js without changing control-plane APIs or data.

---

### ADR-028 — Preserve immutable policy history and gate the Phase 6 policy

**Status:** Accepted
**Decision:** Keep the Phase 0 `2026.10.1` policy document and hash immutable. Introduce the
normative Phase 6 rules as canonical JSON version `2026.10.2`, seeded as `DRAFT`. An administrator
activates it with its registered hash and review ticket; the transaction retires the previous
version, invalidates open-case approvals, and records audit and outbox events. Policy evaluation
fails closed while a placeholder or unverified policy is active. The health endpoint reports the
active database version and its verification state.
**Why:** The database forbids changes to a policy document or hash. Replacing `2026.10.1` in place
would erase the meaning of earlier decisions and violate that control.
**Cost:** A new deployment needs an explicit policy activation before policy evaluation is usable.
**Reversal:** A later reviewed version can be activated; historical versions stay immutable.

---

## Superseded / rejected ideas

| Idea                                               | Why rejected                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| LangGraph / agent framework                        | The loop is a linear state machine with four LLM calls; a framework adds a dependency and hides the control boundary we must be able to show |
| Vector DB for evidence retrieval                   | Evidence sets are small and keyed by account/contract; SQL is exact and auditable                                                            |
| LLM-generated SQL for investigation                | Injection surface and unverifiable; tools are fixed queries                                                                                  |
| Auto-approve low-risk cases in v1                  | Removes the human-accountability story from the demo; revisit after metrics exist                                                            |
| Streaming token output in the UI                   | The operator needs the structured recommendation, not prose latency theatre                                                                  |
| Postgres row-level security                        | No tenancy model yet (ADR-008); RLS without tenancy is security theatre                                                                      |
| Exactly-once target writes                         | The target does not participate in our transaction; a lost response makes it unknowable (ADR-023)                                            |
| Auto-approval for "low" risk                       | A model-derived risk score cannot consent on a human's behalf; low risk still needs one approver                                             |
| Single approval for high blast radius              | One compromised account could release an irreversible action (ADR-017)                                                                       |
| Mutable approvals corrected in place               | Destroys the record of what was approved; supersede instead                                                                                  |
| Audit as a best-effort log stream                  | The product's accountability claim requires transactional append + external anchor (ADR-010/021)                                             |
| In-process rate limiting in production             | Serverless instances do not share memory; failing open is a bypass (ADR-024)                                                                 |
| A uniform role hierarchy with `ADMIN` on top       | Makes the platform administrator a business approver and executor (ADR-016)                                                                  |
| Retrying a failed target write after a timeout     | Double-applies state changes; `UNKNOWN` + verification instead (ADR-023)                                                                     |
| Storing the LLM prompt or completion for debugging | PII and secret exfiltration risk; store hashes, versions and token counts only                                                               |
| Mantine or daisyUI alongside shadcn/ui             | Introduces a second component, theming and semantic-class system; visual and interaction drift (ADR-025)                                     |
| A packaged data grid for the action queue          | Pre-themed markup fights the token system and hides keyboard behaviour; TanStack Table is headless (ADR-025)                                 |
| A graph library that owns node styling             | The evidence graph must express product semantics and a list alternative; React Flow with owned nodes (ADR-025)                              |
