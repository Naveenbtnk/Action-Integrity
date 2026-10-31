# TRD — Technical Requirements Document

**Product:** Action Integrity
**Companion docs:** `ARCHITECTURE.md` (module boundaries), `BACKEND_SCHEMA.md` (entities),
`API.md` (contracts), `SECURITY.md` (controls), `OBSERVABILITY.md` (telemetry),
`OPERATIONS.md` (running it), `DECISIONS.md` (rationale)

---

## 1. Stack (locked)

| Layer                | Choice                                                                                                                                  | Why                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Console/API framework | Next.js 16.4 (App Router) + TypeScript `strict`                                                                                         | One codebase for authenticated UI + control-plane API; ADR-026                  |
| Public framework     | Next.js 16.4 App Router                                                                                                                 | Product and trust pages on the same origin; ADR-029                              |
| UI foundation        | React 19.3, Tailwind CSS 4                                                                                                              | Server Components by default; one token layer                                   |
| Component layer      | shadcn/ui generated on the **Base UI** primitive base                                                                                   | Owned, accessible component source; one component and theming system (ADR-025)  |
| Operational surfaces | TanStack Table, React Flow                                                                                                              | Server-driven queues and an evidence graph with a list alternative              |
| Forms                | React Hook Form + Zod resolver                                                                                                          | Policy, approval, evidence and settings forms validated at the boundary         |
| Accents              | Magic UI and Aceternity UI, source-copied into `components/accent/*`                                                                    | A few restrained transitions and one public-page treatment, token-converted     |
| Icons                | Lucide, restricted product mapping                                                                                                      | Consistent iconography; no emoji                                                |
| Component workbench  | Storybook (or equivalent)                                                                                                               | States and visual regression for every owned component                          |
| Data fetching        | Server Components + a typed `fetch` wrapper; TanStack Query only where client polling is required                                       | Keep server state on the server                                                 |
| Database             | PostgreSQL 16 (Neon in cloud, Docker locally)                                                                                           | JSONB for evidence payloads, real constraints, transactional control plane      |
| ORM                  | Prisma 7 + `prisma migrate`                                                                                                             | Patched typed client with driver adapter, migration history and seeded fixtures |
| Validation           | Zod 4 for every boundary (HTTP, tools, LLM output)                                                                                      | Patched schema source for API + agent contracts                                 |
| Auth                 | Auth.js v5: OIDC in production, credentials for local/preview, JWT session                                                              | Individual accountability; MFA at the IdP (ADR-022)                             |
| LLM                  | Google Gemini 2.5 Flash via `@google/genai`, behind `LlmClient` interface                                                               | Structured JSON output + function calling; swappable                            |
| Rate limiting        | Redis (or platform WAF) behind `lib/rate-limit`; in-memory only in local                                                                | Shared across instances and fail closed (ADR-024)                               |
| Logging              | Pino JSON, redaction configured centrally                                                                                               | Structured, low overhead, no PII (ADR-020)                                      |
| Tracing / metrics    | OpenTelemetry SDK, OTLP/HTTP exporter; Prometheus text endpoint optional                                                                | Vendor-neutral correlation and SLOs (ADR-020)                                   |
| Anchor store         | S3-compatible object storage with Object Lock; local files in dev                                                                       | Third-party provable audit (ADR-021)                                            |
| Charts               | Recharts (dashboard only)                                                                                                               | Minimal, no chart junk                                                          |
| Tests                | Vitest (unit/integration/failure/chaos), Playwright (e2e), autocannon or k6 (load)                                                      | Tiers T1–T7 in `EVALUATION.md`                                                  |
| CI                   | GitHub Actions: typecheck → lint → unit → integration → failure → rbac/envelope → migration diff → secrets → build → deterministic eval | Merge blocked on any failure                                                    |

**Version pinning:** exact versions in `package.json`; no `^` ranges for `next`, `prisma`,
`@google/genai`, `next-auth`, `pino`, `@opentelemetry/*`, `@base-ui/react`, `@tanstack/react-table`,
`reactflow`.

New dependencies require a line in `DECISIONS.md`; this table is the approved set. Mantine and
daisyUI are prohibited: they would introduce a second component, theming or semantic-class system.

## 2. Runtime topology

```
Browser ──▶ Next.js public, console and API (one origin)
              ├─ Server Components / Route Handlers ──▶ Postgres (Neon, pooled)
              ├─ Control plane (deterministic, in-process lib)
              ├─ Investigator (Gemini, server-only)
              ├─ Rate limiter ──▶ Redis
              ├─ Adapters ──▶ Synthetic sources (same app, /api/v1/sources/*)
              │           └─▶ Target system (same app, /api/v1/target/*)
              └─ OTLP ──▶ collector / vendor backend

Worker (same image, separate process or cron)
              ├─ Outbox publisher
              ├─ Reconcile (approvals, evidence SLA, PENDING→UNKNOWN)
              ├─ Audit anchor uploader
              └─ KPI snapshot / cleanup
```

The synthetic enterprise systems run inside the same Next.js process in v1 but sit behind an
adapter interface and use their own route namespace, service credentials and tables. Swapping an
adapter for a real SaaS system must not change any control-plane code. This is the "adapter seam".

The worker is stateless and relies on Postgres advisory locks for leadership; a single instance is
sufficient for a pilot, and the outbox/reconcile jobs are safe to run concurrently.

## 3. The determinism boundary (non-negotiable)

| Concern                                                                            | Owner                          | Rule                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| Contract checks, freshness, schema hash                                            | `lib/integrity/*`              | Pure functions. No LLM.                                                               |
| Exposure computation                                                               | `lib/exposure/*`               | SQL + pure logic. No LLM.                                                             |
| Gate decision (`ALLOW`/`HOLD`/`BLOCK`)                                             | `lib/gate/*`                   | Deterministic. Runs before any write.                                                 |
| Risk score, required approvals, allowed dispositions                               | `lib/policy/*`                 | Active policy document, hash-pinned. No LLM.                                          |
| Approval quorum, expiry, binding, SoD                                              | `lib/approval/*`               | Deterministic counting and hash comparison. No LLM.                                   |
| Target-system write                                                                | `lib/executor/*` → `/target/*` | Only module that initiates a write; `lib/target/auth` verifies inbound calls. No LLM. |
| Verification query and execution resolution                                        | `lib/verifier/*`               | Reads target state, compares to expected. No LLM.                                     |
| Audit append, chain verification, anchoring                                        | `lib/audit/*`                  | Deterministic hash chain. No LLM.                                                     |
| Write admission (degradation)                                                      | `lib/degradation/*`            | Probes + policy. No LLM.                                                              |
| Evidence reconciliation, hypotheses, citations, owner discovery, evidence requests | `lib/agent/*`                  | Only place an LLM may run. Read-only tools.                                           |

**Hard rule:** the agent receives no write tool, no credential, and no threshold. It returns a
recommendation object; `PolicyEngine` decides what is permitted; humans provide quorum; `Executor`
performs it; `Verifier` proves it.

## 4. Data stores

- **One Postgres schema, prefixed table families:** control plane (`Case`, `OutboundAction`, …),
  reliability tables (`OutboxEvent`, `IdempotencyRecord`, `JobHeartbeat`), `src_*` read-only mirrors
  for the five synthetic sources, and `tgt_*` owned exclusively by the synthetic target service.
  Isolation is enforced by module boundaries (source adapters read only their own prefix; `tgt_*` is
  written only by `lib/target/service.ts`); a cross-family join outside `lib/adapters` is a review
  blocker. Rationale recorded in `DECISIONS.md` (ADR-006).
- **The target is reached over HTTP, not by direct query.** `lib/adapters/target/http-client.ts` calls
  `/api/v1/target/*` with `x-target-key`; that route namespace owns `tgt_*`. This gives the write
  credential a real enforcement point and makes the adapter seam genuine. Source systems are read-only
  and are read in-process.
- **JSONB** for `SourceSnapshot.payload`, `OutboundAction.payload`, `restorePoint.state`,
  `OutboxEvent.payload`, and `PolicyVersion.document`.
- **Append-only tables:** `AuditEvent`, `InvestigationReport`, `VerificationResult`,
  `EscalationEvent`, `AuditAnchor`, `tgt_audit` — enforced by DB triggers + a Prisma client extension
  that rejects update/delete.
- **Redis** holds rate-limit counters only. Losing Redis loses counters, not business state; the
  limiter fails closed until it returns.
- **Object storage** holds audit anchors only. The database is the source of truth; the bucket is the
  external proof.

## 5. Environments and configuration

| Variable                                                                                                | Required | Scope      | Notes                                                                         |
| ------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                          | yes      | server     | Pooled Postgres connection                                                    |
| `DIRECT_DATABASE_URL`                                                                                   | yes      | migrations | Non-pooled URL for `prisma migrate deploy`                                    |
| `AUTH_SECRET`                                                                                           | yes      | server     | Auth.js signing; rotate 180 d                                                 |
| `AUTH_URL`                                                                                              | prod     | server     | Public origin for OIDC callbacks                                              |
| `AUTH_CREDENTIALS_ENABLED`                                                                              | no       | server     | Default `false` in production; `true` only local/preview                      |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`                                                 | prod     | server     | Human identity (ADR-022)                                                      |
| `OIDC_ROLE_CLAIM`                                                                                       | no       | server     | Default `roles`; values mapped through an allowlist                           |
| `SESSION_COOKIE_NAME`                                                                                   | no       | server     | Default `aic_session`                                                         |
| `GEMINI_API_KEY`                                                                                        | yes      | server     | Never exposed to client                                                       |
| `GEMINI_MODEL`                                                                                          | yes      | server     | e.g. `gemini-3.5-flash-lite`; verify access with `npm run gemini:check`      |
| `AGENT_SERVICE_KEY`                                                                                     | yes      | server     | Automation submits actions with this key                                      |
| `AGENT_SERVICE_KEY_PREVIOUS`                                                                            | no       | server     | 24 h rotation overlap                                                         |
| `TARGET_SERVICE_KEY`                                                                                    | yes      | server     | Read by `lib/executor` (outbound) and `lib/target/auth` (inbound check)       |
| `TARGET_SERVICE_KEY_PREVIOUS`                                                                           | no       | server     | 24 h rotation overlap                                                         |
| `OPS_SERVICE_KEY`                                                                                       | yes      | server     | Cron/worker: reconcile, outbox, anchor, KPI snapshot                          |
| `OPS_SERVICE_KEY_PREVIOUS`                                                                              | no       | server     | 24 h rotation overlap                                                         |
| `REDIS_URL`                                                                                             | prod     | server     | Shared rate-limit store; absent ⇒ local in-memory + warning                   |
| `AIC_BASE_URL`                                                                                          | yes      | server     | Absolute base for the target adapter's `/api/v1/target/*` calls               |
| `INVESTIGATION_MODE`                                                                                    | yes      | server     | `agent` \| `deterministic`                                                    |
| `POLICY_DIR`                                                                                            | no       | server     | Default `config/policy`; each `<version>.json` is immutable                   |
| `POLICY_VERSION`                                                                                        | no       | CLI        | Selects the file for `npm run policy:hash`; runtime uses the active database row |
| `APPROVAL_WINDOW_HOURS`                                                                                 | no       | server     | Default 12                                                                    |
| `HOLD_SLA_HOURS`                                                                                        | no       | server     | Default 4; reconcile escalates beyond it                                      |
| `RATE_LIMIT_INGEST_PER_MIN`                                                                             | no       | server     | Default 120                                                                   |
| `EXECUTION_TIMEOUT_MS`                                                                                  | no       | server     | Default 120000; stale `PENDING` ⇒ `UNKNOWN`                                   |
| `TARGET_TIMEOUT_MS`                                                                                     | no       | server     | Default 10000; adapter request timeout                                        |
| `OUTBOX_MAX_ATTEMPTS`                                                                                   | no       | server     | Default 8                                                                     |
| `OUTBOX_BATCH_SIZE`                                                                                     | no       | server     | Default 50                                                                    |
| `ALLOWED_ORIGINS`                                                                                       | no       | server     | Comma-separated; default empty ⇒ same-origin only                             |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                           | no       | server     | Absent ⇒ no-op tracer                                                         |
| `OTEL_SERVICE_NAME`                                                                                     | no       | server     | Default `aic-web` / `aic-worker`                                              |
| `LOG_LEVEL` / `LOG_PRETTY`                                                                              | no       | server     | Default `info`; pretty only in development                                    |
| `METRICS_ENDPOINT_ENABLED`                                                                              | no       | server     | Default `0`; `/metrics` requires the ops key                                  |
| `ANCHOR_STORE_ENDPOINT` / `ANCHOR_STORE_BUCKET` / `ANCHOR_STORE_ACCESS_KEY` / `ANCHOR_STORE_SECRET_KEY` | prod     | server     | Object-lock bucket; local writes `var/anchors/`                               |
| `ANCHOR_INTERVAL_MINUTES`                                                                               | no       | server     | Default 60                                                                    |
| `SEED_PROFILE`                                                                                          | no       | server     | `demo` (default) \| `test`                                                    |
| `SEED`                                                                                                  | no       | script     | Fixed PRNG seed, default `20261026`; changing it changes every fixture id     |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`                                                              | no       | script     | Required by `seed` when `NODE_ENV=production`                                 |
| `ALLOW_DB_RESET`                                                                                        | no       | script     | Second gate for `prisma migrate reset` / `seed:reset` (local or `_test` only) |
| `ALLOW_DEMO_RESET` / `DEMO_DB_HOSTS`                                                                    | no       | script     | Guards for `npm run demo:reset`; see Phase 13                                 |
| `EVAL_MAX_CONCURRENCY`                                                                                  | no       | server     | Default 2                                                                     |

Startup validation uses a Zod schema in `lib/env.ts`; the process **fails fast** on any missing or
malformed value. No silent defaults for secrets. Production additionally refuses:
`AUTH_CREDENTIALS_ENABLED=true`, `ALLOW_DB_RESET`, `ALLOW_DEMO_RESET`, `LOG_PRETTY=1`, or a missing
`REDIS_URL`/`OIDC_*`/`ANCHOR_STORE_*` set.

## 6. Third-party services

| Service         | Purpose                      | Failure behavior                                                          |
| --------------- | ---------------------------- | ------------------------------------------------------------------------- |
| Gemini API      | Investigation reasoning only | One retry; deterministic fallback; case flagged; action stays held (`L1`) |
| OIDC IdP        | Human identity               | New logins fail; existing sessions continue until expiry (`L5`)           |
| Redis           | Rate-limit counters          | Fail closed 503 `RATE_LIMITER_UNAVAILABLE`                                |
| Object store    | Audit anchors                | Retries, then `AuditAnchorStale`; writes continue, proof lags (`R-05`)    |
| Neon / Postgres | Everything                   | Fail closed: no DB ⇒ no gate decision ⇒ no write (`L3`)                   |
| OTLP collector  | Telemetry                    | Drops telemetry; product unaffected                                       |
| Vercel          | Hosting                      | Static build failure blocks deploy; no partial deploy                     |

## 7. Tech constraints

- Node 24 LTS. No new runtime dependency without a line in `DECISIONS.md`.
- No `any` in exported types. `noUncheckedIndexedAccess` on.
- All LLM output validated with Zod before persistence. Invalid ⇒ one repair retry ⇒ fallback.
- Every route handler returns the standard envelope defined in `API.md` and passes, in order:
  `requirePermission` → `assertWritesAllowed` (mutations) → `withIdempotency` (mutations) → handler →
  audit append. A route that skips a step fails `tests/api/envelope.test.ts`.
- All dates stored UTC (`timestamptz`), rendered in the viewer's locale. Expiry decisions use database
  `now()`.
- No client-side access to `tgt` or source schemas; all reads go through route handlers with explicit
  field projection.
- Money/values stored as integer minor units or `numeric`, never floats.
- No `console.log`; use the central logger. No prompt, rationale or excerpt in any log/span.
- One visual system: feature code imports primitives only from `components/ui/*`; direct
  `@base-ui/react` imports live only inside `components/ui/*`; `components/accent/*` consumes the same
  tokens. No page mixes component systems, and no component introduces a second radius, type scale,
  shadow or colour vocabulary.
- Tokens come from `UI_UX_BRIEF.md` §7.3. Components use semantic Tailwind tokens, never hex literals.

## 8. Non-functional requirements

| Requirement            | Target                                    | Verified by                                |
| ---------------------- | ----------------------------------------- | ------------------------------------------ |
| Gate availability      | 99.9% (ingest returns a decision)         | T4, SLO dashboard                          |
| Gate latency           | p95 ≤ 400 ms, p99 ≤ 1 s                   | T4 load                                    |
| Investigation latency  | p95 ≤ 10 s, p99 ≤ 25 s                    | T1 agent, tracing                          |
| Case time to decision  | p95 ≤ 30 min business hours               | KPI query                                  |
| Execution latency      | p95 ≤ 60 s to terminal status             | tracing                                    |
| Outbox freshness       | p95 ≤ 5 s                                 | T5 chaos, SLO                              |
| Audit anchor freshness | ≤ 2 h                                     | anchor job, alert                          |
| RPO / RTO              | ≤ 5 min / ≤ 60 min                        | T6 DR drill                                |
| Concurrent reviewers   | 25 without lock contention                | load test                                  |
| Ingest volume          | 20 rps sustained, 100 rps burst for 1 min | T4                                         |
| Data retention         | audit forever; logs 30/90 d; traces 7 d   | config review                              |
| Accessibility          | WCAG 2.2 AA on the console                | Playwright axe scan + manual keyboard pass |

## 9. Repository layout

```
action-integrity/
├─ README.md
├─ docs/                         # product, architecture, security, and operations
├─ config/                       # versioned policy and metric configuration
├─ prisma/                       # schema, migrations, and synthetic seed
├─ scripts/                      # checks and local maintenance
├─ src/app/                      # public pages, console, and API routes
├─ src/components/               # shared UI and feature components
├─ src/lib/                      # control plane, adapters, and persistence
├─ src/test/                     # unit, integration, scenario, and browser tests
├─ .storybook/                   # component workbench
└─ .github/workflows/ci.yml
```

Naming: `kebab-case` files, `PascalCase` components, `camelCase` functions, `SCREAMING_SNAKE`
constants, DB tables `snake_case` singular, enums `SCREAMING_SNAKE` values.

## 10. Verification commands

This is the target release gate, not a list of completed checks. Several commands are not yet
implemented; see [deployment status](DEPLOYMENT_STATUS.md) for what has been verified.

| Command                                                                  | Purpose                        |
| ------------------------------------------------------------------------ | ------------------------------ |
| `npm run typecheck` / `lint`                                             | static gates                   |
| `npm run test:unit` / `test:integration`                                 | T1 support                     |
| `npm run test:scenarios -- --mode=deterministic`                         | T1 functional                  |
| `npm run test:adversarial`                                               | T2                             |
| `npm run test:rbac` / `test:envelope`                                    | T3                             |
| `npm run test:failure`                                                   | F-01…F-26                      |
| `npm run test:load` / `test:chaos`                                       | T4/T5                          |
| `npm run drill:restore` / `drill:target-down` / `drill:audit-break`      | T6 and drills                  |
| `npm run audit:verify -- --full`                                         | chain integrity                |
| `npm run check:boundaries` / `check:secrets-scope` / `check:policy-hash` | architectural and secret gates |
| `npm run smoke -- --base-url=<url>`                                      | deployed-environment check     |
| `npm run readiness -- --level D2 --commit <sha>`                         | go/no-go evidence report       |
