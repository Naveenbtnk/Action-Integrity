# CODE_STYLE.md

Conventions for this repository. New code follows existing patterns first; this file resolves
ambiguity rather than inventing preferences. Where this file and `RBAC.md`, `API.md` or
`ARCHITECTURE.md` disagree, those files win and this one is corrected.

---

## 1. Language and tooling

TypeScript 5.x with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`exactOptionalPropertyTypes`. ESLint (`next/core-web-vitals`, `@typescript-eslint`, `import/order`,
`no-console`, import-boundary rules), Prettier (100 cols, single quotes, trailing commas `all`).
Pre-commit runs `lint-staged`: eslint `--fix`, prettier `--write`, `tsc --noEmit` on changed packages.

- No `any`. `unknown` plus a Zod parse at every boundary (request body, query, env, LLM output,
  upstream response).
- No non-null assertion `!` on values that cross a boundary; narrow explicitly.
- Dates are `Date` in code and ISO-8601 UTC on the wire. Money is minor units as a string; never a
  float. Ids are strings.
- `import type` for type-only imports. No circular imports between `lib` domains.

## 2. Naming

| Kind | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `action-gate.ts` |
| React components | `PascalCase` file | `DataTable.tsx` |
| Functions / variables | `camelCase`, verb-first | `computeExposure()` |
| Types / interfaces / enums | `PascalCase` | `PolicyDecision` |
| Enum members | `SCREAMING_SNAKE` | `HOLD_FOR_EVIDENCE` |
| Constants | `SCREAMING_SNAKE` | `MAX_INVESTIGATION_RETRIES` |
| Booleans | `is/has/can/should` prefix | `isApprovalRequired` |
| Permissions | `domain:action` | `case:approve_high` |
| Error codes | `SCREAMING_SNAKE` | `APPROVAL_QUORUM_NOT_MET` |
| Metrics | `aic_<noun>_<unit>` | `aic_gate_decisions_total` |
| Spans | `domain.verb` | `execution.execute` |
| Prisma models | `PascalCase`; tables `snake_case` singular via `@@map` | `Case` → `case` |
| DB columns | `camelCase` in Prisma, `snake_case` in SQL | `riskScore` → `risk_score` |
| API routes | plural nouns, kebab where needed | `/api/v1/cases/:ref` |
| Test names | assertion sentence | `it('refuses execution by an approver')` |

Never abbreviate domain terms: `entitlement`, not `ent`; `investigation`, not `inv`. Exceptions:
`ref`, `id`, `kpi`, `sla`, `rbac`.

## 3. Module boundaries

```
app/            routing + composition only. No business logic, no Prisma.
components/     presentational. No Prisma, no calls to /sources, /target or /internal.
lib/<domain>/   pure logic + persistence. One exported entry point per folder (index.ts).
lib/adapters/   the only place that talks to source/target systems (source reads in-process,
                target over HTTP).
lib/target/     the synthetic target: owns tgt_* and authenticates /target/*.
lib/agent/      the only place that calls an LLM.
lib/rbac.ts     permissions and route coverage. No route logic and no quorum/SoD decisions
                (those live in lib/approval).
lib/observability/  logger, tracer, metrics, redaction. Imported by everything, imports no domain.
```

Rules:

- `app/api/**/route.ts` = authenticate → authorize → rate limit → validate → check degradation →
  idempotency → call **one** `lib` function → respond. Target ≤ 40 lines; anything longer belongs in
  `lib`.
- A `lib` module must not import from `components` or `app`.
- `lib/gate`, `lib/policy`, `lib/executor`, `lib/verifier`, `lib/integrity` and `lib/exposure` must
  never import `lib/agent` or an LLM SDK. Enforced by ESLint `no-restricted-imports`, not by review.
- Only `lib/state-machine/case.ts` writes `Case.status`. Only `lib/executor/*` initiates a target
  write, and only through `lib/adapters/target`. Only `lib/target/service.ts` touches `tgt_*`.
- `lib/observability` may be imported anywhere; it must not import a domain module.

## 4. Route pipeline

Every handler is wrapped by `withRoute` and follows the same order. Early exits are the point.

```ts
export const POST = withRoute(async (req, ctx) => {
  const session = await requireSession(req);                    // 401 SESSION_STALE
  requirePermission(session, 'case:execute');                   // 403 FORBIDDEN
  await enforceRateLimit('execute', session);                   // 429 / 503 fail-closed
  const { ref } = parseParams(ctx.params, CaseRef);             // 400 VALIDATION_ERROR
  const body = parseBody(await req.json(), ExecuteInput);       // 400 VALIDATION_ERROR
  assertWritesAllowed();                                        // 503 DEGRADATION_BLOCKED
  return withIdempotency(req, session, async () => {            // 400 / 409 / replay
    return executeCase({ ref, actor: session, body });          // one lib call
  });
});
```

- Authorization is checked before the body is parsed, so an unauthenticated caller learns nothing
  about validation.
- The route never decides quorum, risk, disposition, degradation or idempotency semantics. It calls
  the single function that owns each.
- `withRoute` converts `AppError` to the envelope, unknown errors to `INTERNAL_ERROR` with a
  `requestId`, logs the real error once server-side, and echoes `x-request-id`.
- Mutations set `meta.replayed`; decision-bearing responses set `meta.policyVersion` and
  `meta.policyHash`.

## 5. Functions and types

- Return typed results, not thrown strings. Domain failures use `AppError` subclasses in
  `lib/errors.ts` with `code`, `httpStatus`, `message`, `details`.
- Export explicit return types on all public functions (`lib/**/index.ts`).
- Prefer `readonly` arrays for collections that must not mutate.
- Pure functions stay pure: no DB access inside `lib/integrity/*-check.ts`; the caller loads
  snapshots and passes them in. This is what makes unit tests fast.
- A function that performs a write takes an explicit `actor` and the `policyHash`/`evidenceHash` it
  is acting under; it does not re-read "the latest" implicitly when the caller already bound them.

## 6. Error handling

```ts
// lib/errors.ts
export class AppError extends Error { constructor(readonly code: Code, readonly httpStatus: number,
  message: string, readonly details?: Record<string, unknown>) { super(message) } }
export class InvalidTransitionError extends AppError { … }      // 409
export class QuorumNotMetError extends AppError { … }           // 409 APPROVAL_QUORUM_NOT_MET
export class SeparationOfDutiesError extends AppError { … }     // 409 APPROVER_CANNOT_EXECUTE
export class EvidenceIncompleteError extends AppError { … }     // 422
export class DegradationBlockedError extends AppError { … }     // 503
export class UpstreamError extends AppError { … }               // 502
```

- One code per condition; the catalogue in `API.md` §8 and `RBAC.md` §7 is closed. Adding a code means
  updating both files and the client's next-action mapping in the same PR.
- Business conflicts are 409 and carry the facts needed to act (`requiredApprovals`, `missingRoles`,
  `currentEvidenceHash`, `activePolicyHash`). Authorization failures are 403 and carry no resource
  data.
- Never swallow an error to keep a flow moving. If a step cannot be completed, the case must reflect
  that state. `try/catch` must map, log with context, or rethrow; an empty catch is a review blocker.
- Retries go through `lib/retry.ts`, which knows the operation's class (`SAFE_READ`,
  `IDEMPOTENT_WRITE`, `UNSAFE_WRITE`, `LLM_CALL`, `AUTH`). `UNSAFE_WRITE` is never retried; a lost
  target response becomes `UNKNOWN` (ADR-023). No ad-hoc `for` loop retries, no `setTimeout` retry.

## 7. Database access

- One `PrismaClient` (`lib/db.ts`). No client construction elsewhere.
- Select explicit fields. `findMany()` with no `select` on a large table is rejected in review.
- Multi-step writes use `db.$transaction`. The audit row, approval invalidation and outbox event are
  inside the same transaction as the business change.
- Never hold a database transaction open across an HTTP call to the target or the LLM. The execution
  shape is: commit intent → one target call → commit result (`ARCHITECTURE.md` §3).
- Lock what you read-then-write: the `Case` row with `SELECT … FOR UPDATE` for transitions, the
  approval set for quorum, and `FOR UPDATE SKIP LOCKED` for outbox claiming. Application-level
  "check then write" without a lock is a defect.
- Raw SQL only for partial indexes, append-only triggers, chain verification and `SKIP LOCKED`
  claiming; always parameterized via `$queryRaw` tagged templates.
- Migrations are additive or expand→migrate→contract; `CREATE INDEX CONCURRENTLY` on populated
  tables; never edit an applied migration. Destructive changes need an ADR (`DATABASE.md` §2).
- `AuditEvent`, `InvestigationReport`, `VerificationResult`, `EscalationEvent`, `AuditAnchor` and
  `tgt_audit` are append-only. No update or delete helper exists for them; a test asserts the DB
  trigger.

## 8. Idempotency, outbox and approvals

- Every mutating route requires `Idempotency-Key` and goes through `withIdempotency`. Never write a
  record before the key is reserved.
- Durable side effects (notification, KPI snapshot, export) are enqueued as `OutboxEvent` in the
  business transaction. Never call an external system from inside the transaction.
- Approvals are read and written only through `lib/approval`. A quorum is computed from `VALID`
  approvals bound to the current `evidenceHash`, `policyHash`, `reportId` and `disposition`; the UI
  receives the computed values and never derives them.
- Superseding approvals and writing `APPROVAL_SUPERSEDED` happen in one transaction with the change
  that caused it (new evidence, new report, policy activation).
- Every privileged denial writes exactly one `AUTHZ_DENIED` audit event and increments
  `aic_authz_denied_total{permission}`. Read denials are logged only.

## 9. Observability

- `console.log` is banned in `src/` (ESLint error). Use `lib/observability/logger.ts`.
- Every log line carries `requestId`, `traceId` (when tracing), `actorType`, `actorId`, and
  `caseRef`/`actionRef` when applicable. No line carries a prompt, evidence excerpt, rationale,
  cookie, key or full email address.
- Log levels: `error` = action failed and someone must look; `warn` = degraded or retried; `info` =
  state transition, approval, execution, verification; `debug` = development only.
- Business events are audited, not merely logged. A log line is never the record of a decision.
- Spans follow `OBSERVABILITY.md` §4; create a span around any call that crosses a process boundary
  or a retry loop, and record the outcome (`ok`, `error`, `unknown`).
- Metric names and labels are fixed in `OBSERVABILITY.md` §5. No labels with user id, case ref or
  email — unbounded cardinality is a defect.
- Never log the same error at every layer. The route boundary logs once; inner layers attach context
  and rethrow.

## 10. React and UI

- Server Components by default. `'use client'` only for interactivity (tables, graphs, forms, polling,
  dialogs).
- No `useEffect` for data fetching; use server components, or TanStack Query where client caching or
  polling is required. Polling is allowed only while a case is `INVESTIGATING`/`EXECUTING` and stops on
  terminal state.
- Queues use TanStack Table; forms use React Hook Form with a Zod resolver; evidence relationships use
  React Flow with a list/table equivalent. Do not hand-roll a data grid, combobox or dialog.
- Components take typed `props`; no `React.FC`, no default exports except route files and pages.
- All async UI states implemented: loading, empty, error, partial and stale (`APP_FLOW.md` §15).
- Design tokens only, from `UI_UX_BRIEF.md` §7.3. No hex literals in components. No second radius,
  type scale, shadow or colour vocabulary.
- `components/ui/*` is the only primitive import surface. Direct `@base-ui/react` imports live only in
  `components/ui/*`; `components/accent/*` consumes the same tokens. Mantine and daisyUI are prohibited.
- Every interactive element is a real `<button>`/`<a>` with an accessible name. A disabled control
  states its reason in text, not only in a tooltip.
- The UI may hide a control, but may never be the enforcement. A control is rendered from
  `can(permission)` for usability; the handler re-checks. `lib/permissions/` is a client-safe facade
  over `lib/rbac.ts` and contains no quorum, risk or policy logic.
- Never store a session token, evidence excerpt or rationale in `localStorage`. The one permitted
  `sessionStorage` use is the unsaved-rationale restore described in `APP_FLOW.md` §17.
- Do not render `UNKNOWN` as success or failure, and do not show a success state before a
  `VerificationResult` with `passed = true`. No optimistic UI for approve, execute, verify, release,
  block or policy activation.
- Filters, sort, saved view and time range live in the URL. Sensitive payloads, free-text evidence and
  rationales never do.
- Motion follows `UI_UX_BRIEF.md` §9 and respects `prefers-reduced-motion`. No glow, gradient card or
  infinite animation in authenticated pages.

## 11. Comments

Write a comment only when the *why* is non-obvious: a hidden constraint, a workaround, an invariant
that looks like a bug. Never narrate what the code does. Never reference the task or ticket.

```ts
// Good: the target returns 200 before committing; verify before closing.
// Bad: increment retry count
```

Every file in `lib/gate`, `lib/policy`, `lib/executor`, `lib/verifier`, `lib/approval`,
`lib/state-machine` and `lib/audit` carries a one-line header stating the invariant it enforces
(e.g. `// Invariant: no HOLD without a persisted ActionHold.`) because these are the rules an AI
agent is most likely to break.

## 12. Testing

| Layer | Tool | Rule |
|---|---|---|
| Pure logic | Vitest | one file per module, table-driven, no DB |
| Route handlers | Vitest + real test DB | status, envelope, permission, idempotency replay, audit row |
| State machine | Vitest | every legal transition and every illegal one |
| RBAC matrix | Vitest | every role × route matches `RBAC.md`; an unlisted route fails startup |
| Quorum / SoD | Vitest | 0/1/2 approvals, duplicate, missing senior, expiry, stale evidence/policy, approver executing |
| Break-glass | Vitest | lifecycle, self co-sign, TTL, one-case scope, audit |
| Failure injection | Vitest | target timeout/lost response, DB failure, LLM 429, outbox DLQ, anchor outage, chain break |
| Adversarial | Vitest | X2–X8 from `EVALUATION.md` §6 |
| Scenarios | Vitest against `_test` DB | the 13 fixtures, both modes |
| Load / chaos / DR | drill scripts | recorded as `ScenarioRun` with `kind` |
| E2E | Playwright | two distinct users: approve as one, execute as the other, verify |

Rules: real Postgres everywhere; mock only the LLM client and the network boundary of adapters. No
snapshot tests of rendered UI. A test may not mock `requirePermission`, `assertQuorum` or the verifier.
Fixtures use personas from `EVALUATION.md` §4 and never reuse one identity for two approvals.
The test DB URL must end in `_test`; `seed:reset` refuses otherwise.

## 13. Git and commits

Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Subject ≤ 72 chars,
imperative. One phase per PR. PR body states: what changed, which phase prompt it implements, which
acceptance criteria pass, which drills ran, and what was not verified.

- Agents commit and tag locally only. **Never push** to a remote; the repository owner pushes.
- Never commit `.env*`, secrets, service keys, logs, seeded real data, or edits to applied
  migrations.
- Do not reformat untouched files, rename unrelated symbols, or "clean up" inside a fix.

## 14. Before finishing any task

1. `npm run typecheck` — zero errors.
2. `npm run lint` — zero errors (including `no-console` and import boundaries).
3. `npm run test:unit` — green.
4. `npm run test:rbac` — green for any change touching auth, approvals, routes or the UI.
5. `npm run test:failure` — green for any change touching executor, verifier, outbox, agent or DB.
6. `npm run test:adversarial` — green for any change touching the agent, evidence or approvals.
7. `npm run test:scenarios -- --mode=deterministic` — green if the pipeline is affected.
8. `npm run test:e2e` — green for any change to the approval, execution or verification UI.
9. `npm run readiness -- --level <phase level>` — run when the phase prompt names it.
10. No debug `console.log`, no `.only`, no skipped test without a linked issue. Diff reviewed for
    unrelated changes; revert any.

## 15. Definition of done

A change is done when: the smallest code that satisfies the phase prompt is in place; the invariant it
touches has a test; the error paths fail closed and are in the catalogue; the operation is observable
(span + metric + audit where applicable); the docs it contradicts are updated; the verification
commands above pass; and the report states what was **not** verified. "It works on my machine" is not
a result, and a passing API response is not a verified business state.
