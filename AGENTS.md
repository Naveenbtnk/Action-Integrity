# AGENTS.md — Operating contract for AI coding agents

This repository builds **Action Integrity**: a governed control layer that stops unreliable data
from producing harmful business actions, verifies recovery when prevention is too late, and proves
both with a quorum-bound, externally anchored audit trail.

Read this file fully before your first edit. It is the contract; the `docs/` set is the source of
truth for product and technical decisions.

---

## 1. Read order (before writing any code)

1. `docs/ARCHITECTURE.md` — module boundaries, the determinism boundary, state machine.
2. `docs/SECURITY.md` — rules you must never break.
3. `docs/RBAC.md` — roles, quorum, separation of duties, break-glass.
4. `docs/FAILURE_MODES.md` — retry classes, degradation ladder, failure catalogue.
5. `docs/CODE_STYLE.md` — conventions.
6. The one phase prompt you are executing from `docs/prompts/`.
7. Only then the specific source files that phase touches.

Read `docs/OBSERVABILITY.md` before adding a route, executor call or worker; read
`docs/OPERATIONS.md` before touching a migration, deploy or runbook; read
`docs/PRODUCTION_READINESS.md` before claiming anything is production-ready.

Do not read the whole repository. Do not re-read files you already have in context.

## 2. The seven invariants (a change that violates one is rejected, not discussed)

1. **The model never writes.** `lib/gate`, `lib/policy`, `lib/approval`, `lib/executor`,
   `lib/verifier`, `lib/integrity`, `lib/exposure` contain no LLM call. The investigator has no write
   tool and no credential that can reach the target system.
2. **One writer, no blind retry.** Only `lib/executor/*` may initiate a target write — including the
   write for an `ALLOW` decision — and it reaches the target only through `lib/adapters/target`. A
   target write is attempted exactly once; an unknown outcome becomes `UNKNOWN`, never a retry.
   Inside the synthetic target, `lib/target/service.ts` is the only module that touches `tgt_*` rows.
3. **One transition owner, quorum before action.** `Case.status` changes only through
   `lib/state-machine/case.ts`; every transition writes an `AuditEvent` in the same transaction. A
   write disposition reaches `APPROVED` only with quorum and role coverage, and approvals bound to
   the current evidence, policy, report and disposition.
4. **Evidence before closure, and no self-approval.** A case reaches `CLOSED_RESOLVED` only with the
   required approvals and a `VerificationResult` with `passed = true`. An API 200 is never success.
   The executor is never an approver of that case lifecycle.
5. **Fail closed.** Missing evidence, unavailable dependency, unknown execution outcome or a broken
   audit chain ⇒ hold, escalate, `UNKNOWN`, or refusal. Never guess, never auto-approve, never
   proceed without a record.
6. **Audit before effect.** No consequential write commits without its audit event in the same
   transaction. `AuditEvent`, `VerificationResult`, `InvestigationReport`, `EscalationEvent` and
   `AuditAnchor` are immutable. A detected chain break freezes writes.
7. **Outbox for side effects.** Anything that must happen after commit (notification, anchor, KPI
   snapshot) is an `OutboxEvent` written in the business transaction. No fire-and-forget after
   commit, no second source of truth.

## 3. Never do

- Disable, stub, or "temporarily" bypass auth, RBAC, quorum, separation of duties, the gate, the
  verifier, or the audit chain.
- Add a mutating tool to the investigator, or let it choose thresholds or approvals.
- Retry a target write, or treat an API 200 as success without a verification read.
- Let an approval survive a change to its evidence, policy, report or disposition.
- Make `AuditEvent`, `InvestigationReport`, `VerificationResult`, `EscalationEvent` or `AuditAnchor`
  mutable, or disable the immutability triggers.
- Hardcode a secret, key, or connection string.
- Edit an applied migration, or write a destructive migration without an approved expand/contract
  plan.
- Write to `tgt_*` outside `lib/target/service.ts`, or write to `src_*` outside the seed/integrity
  path.
- Log prompts, evidence excerpts, rationales, passwords, tokens, keys or full record payloads.
- Add a route without a permission entry and a rate-limit entry; both startup assertions must pass.
- Introduce a framework, ORM, auth library, observability SDK or agent framework not in `TRD.md`
  without an ADR.
- Rewrite unrelated files, reformat untouched code, or "clean up" while fixing something.
- Push to a remote. Commit and tag locally; the repository owner pushes.
- Report success without running the verification command named in the phase prompt.
- Claim "production-ready" without naming the verdict (production-capable vs production-approved) and
  linking a readiness report.

## 4. Workflow for every task

```
1. Restate the requirement in one sentence and name the files you expect to change.
2. Check the phase prompt's scope guard. If the request exceeds it, say so before coding.
3. Make the smallest change that satisfies the acceptance criteria.
4. Add or update tests when behaviour changed (unit for logic, integration for routes,
   failure test for a dependency path, rbac test for a permission, scenario if the pipeline is
   affected).
5. Emit the telemetry the path requires (span, metric, log fields, audit event).
6. Run, in order: typecheck → lint → the phase's verification command.
7. Report exactly: files changed, what changed, verification output, what you did not verify.
```

If a requirement conflicts with an invariant or with `SECURITY.md`, **stop and ask**. Do not work
around it.

## 5. Ambiguity policy

- Prefer existing patterns over new ones.
- If the docs disagree with the code, the docs win until amended — but say so explicitly rather than
  silently choosing.
- If something cannot be determined from the repository, write `UNKNOWN` and ask one precise
  question. Never invent schema fields, enum values, endpoints, metrics or error codes.

## 6. Output format for a completed task

```
CHANGED
- path/to/file.ts — one line on why

VERIFIED
- command → result

NOT VERIFIED
- item → reason

RISKS
- only if real
```

Keep it under 15 lines. No summaries of the whole project.

## 7. Where things live

| Need | File |
|---|---|
| Product scope, scenarios, acceptance | `docs/PRD.md` |
| Stack, env vars, layout, NFRs | `docs/TRD.md` |
| Module contracts, state machine | `docs/ARCHITECTURE.md` |
| Tables, enums, constraints | `docs/BACKEND_SCHEMA.md` |
| Migrations, seed, transactions, retention | `docs/DATABASE.md` |
| Endpoints, envelope, errors | `docs/API.md` |
| Roles, permissions, quorum, SoD, break-glass | `docs/RBAC.md` |
| Retry policy, degradation, failure catalogue | `docs/FAILURE_MODES.md` |
| Logs, traces, metrics, SLOs, alerts | `docs/OBSERVABILITY.md` |
| Environments, release, incidents, runbooks | `docs/OPERATIONS.md` |
| Go/no-go criteria and evidence | `docs/PRODUCTION_READINESS.md` |
| Scenarios, metrics, baseline, tiers | `docs/EVALUATION.md` |
| Security rules, threat model and gaps | `docs/SECURITY.md` |
| Style and testing rules | `docs/CODE_STYLE.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| Build sequence and done criteria | `docs/IMPLEMENTATION_PLAN.md` |
| The prompt for the phase you are in | `docs/prompts/` |

## 8. Phase discipline

Work one phase prompt at a time. Do not start Phase *n+1* until Phase *n*'s **Done criteria** pass.
Do not bundle phases to "save time" — the dependency chain is real, and each phase's verification is
what lets the next one be trusted.

When a phase is complete, produce the output block from §6 and stop. Do not begin the next phase
unless explicitly asked.

## 9. Claims discipline

- The model never writes, and the system never claims exactly-once target writes. The honest claim is
  at-most-once with `UNKNOWN` reconciliation and verification.
- "Production-capable" requires `npm run readiness` evidence on the release commit. "Production-
  approved" requires named sign-offs and the organisational items in `PRODUCTION_READINESS.md` §5.
- Never claim SOC 2, HIPAA, GDPR certification, zero downtime or full autonomy.
- Every gap in `SECURITY.md` §11 and `PRODUCTION_READINESS.md` §7 stays visible in the README and the
  demo. Removing a gap from the docs without closing it is a defect.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
