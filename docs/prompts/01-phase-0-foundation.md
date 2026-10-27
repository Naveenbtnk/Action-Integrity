# Phase 0 — Foundation, envelope and observability scaffold

**Read first:** `AGENTS.md`, `docs/TRD.md` §1–§5, `docs/CODE_STYLE.md` §1–§4,
`docs/UI_UX_BRIEF.md` §1, §3.3, §4, §7, §12, `docs/OBSERVABILITY.md` §1–§3, `docs/SECURITY.md` §2.
**Goal:** a deployable skeleton where a bad change cannot merge and every request is traceable.
**Depends on:** nothing.

## Scope guard

Do not create business tables, adapters, gates, approvals or business screens. This phase is
infrastructure plus the application shell. A placeholder page, the public frame, the navigation
skeleton and the component workbench are in scope; a queue, case workspace or dashboard is not. If
you feel the urge to model a case, stop — that is Phase 1. Auth is scaffolded only to the extent
needed for `/health` to be public and everything else to fail closed.

## Build

1. `npx create-next-app@16.4.3 . --ts --tailwind --app --eslint --src-dir --import-alias "@/*"`.
2. Pin the ADR-026 majors and exact versions for `next`, `react`, `prisma`, `@prisma/client`, `next-auth`, `@google/genai`,
   `zod`, `pino`, `@opentelemetry/sdk-node`, `ioredis`. No `^` ranges for these.
3. Initialize shadcn/ui with the **Base UI** primitive base and `components.json` aliases
   (`@/components/ui`, `@/components/accent`, `@/lib/utils`). Add only the primitives the shell needs.
   Do not add Mantine or daisyUI. Add Storybook (or an equivalent workbench) as a dev dependency with
   one example component story.
4. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
   `exactOptionalPropertyTypes`, path alias `@/*`.
5. Prettier: 100 cols, single quotes, trailing commas `all`. ESLint: `next/core-web-vitals`,
   `@typescript-eslint`, `import/order`, `no-console` (error for `src/**`), and
   `no-restricted-imports` rules that will later enforce the module boundaries in `CODE_STYLE.md` §3.
   `husky` + `lint-staged`: eslint `--fix`, prettier `--write`, `tsc --noEmit`.
6. `src/lib/env.ts`: Zod schema for every variable in `docs/TRD.md` §5 with the documented
   required/optional split. Export a frozen `env`. Throw at import time naming the missing key,
   never its value. Refuse to boot when `NODE_ENV=production` and any of
   `AUTH_CREDENTIALS_ENABLED=true`, a missing `REDIS_URL`, a missing `OIDC_ISSUER`, or
   `OTEL_SDK_DISABLED=1` remain set (production refuses local shortcuts).
7. `src/lib/errors.ts`: `AppError` with `code`, `httpStatus`, `message`, `details`; subclasses
   `ValidationError` 400, `UnauthenticatedError` 401, `SessionStaleError` 401, `ForbiddenError` 403,
   `NotFoundError` 404, `ConflictError` 409, `InvalidTransitionError` 409, `QuorumNotMetError` 409,
   `SeparationOfDutiesError` 409, `EvidenceIncompleteError` 422, `RateLimitedError` 429,
   `UpstreamError` 502, `DependencyUnavailableError` 503, `DegradationBlockedError` 503,
   `ImmutableRecordError` 500.
8. `src/lib/http.ts`: `withRoute(handler)` that attaches `requestId` and `traceId`, echoes
   `x-request-id`, converts `AppError` to the envelope in `docs/API.md` §2, maps unknown errors to
   `INTERNAL_ERROR`, logs the real error once with context, and never returns a stack trace, SQL
   fragment, upstream message or email. Mutating responses expose `meta.replayed`.
9. `src/lib/db.ts`: Prisma singleton with an immutability-extension stub (implemented in Phase 1).
10. `src/lib/observability/`:
    - `logger.ts` — Pino JSON, redaction list from `OBSERVABILITY.md` §2 (`password`, `cookie`,
      `authorization`, `x-agent-key`, `x-target-key`, `x-ops-key`, `rationale`, `prompt`, `excerpt`);
    - `tracing.ts` — OTel NodeSDK bootstrap, service name `aic-api`, no-op when
      `OTEL_SDK_DISABLED=1`; `withSpan(name, attrs, fn)` helper;
    - `metrics.ts` — meter provider and the registry that later phases add to; no metric yet beyond
      `aic_http_requests_total` and `aic_http_request_duration_seconds` (bounded labels only).
11. `src/app/api/v1/health/route.ts`: public. Returns
    `{ status, db, mode, degradation, policyVersion, policyHash, commit, checkedAt }` per `API.md`
    §6.1. `db` runs `SELECT 1`; `degradation` reads `DegradationState` if the table exists, else
    `L0_NORMAL`; `policyHash` is the SHA-256 of `config/policy/2026.10.1.json`.
12. `src/app/globals.css`: the canonical token block from `docs/UI_UX_BRIEF.md` §7.3 — dark theme
    only, 4 px radii, Archivo for UI and Space Mono for instruments via `next/font`, no shadows, glow
    or gradients. `src/app/layout.tsx` applies both font variables. Add the application shell skeleton
    (`src/app/app/layout.tsx` with rail, top bar and empty content), a `/forbidden` placeholder, and a
    `src/app/(auth)/login/page.tsx` skeleton holding the `SignInPanel` shell (heading, disabled
    `Continue with SSO`, no credentials block, no sign-up link). All are permission-aware but without
    business data; `/signup`, `/invite` and `/reset` must not resolve.
13. `.env.example` with names only; `.gitignore` covers `.env*` except `.env.example`;
    `docker-compose.yml` with Postgres 16 (`action_integrity`) and Redis 7, healthchecks, volumes.
14. `.github/workflows/ci.yml`: `npm ci` → `typecheck` → `lint` → `test:unit` → `build`, with
    Postgres and Redis services.
15. `package.json` scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test:unit`,
    `test:integration`, `test:db`, `test:rbac`, `test:envelope`, `test:failure`,
    `test:adversarial`, `test:scenarios`, `test:load`, `test:chaos`, `test:e2e`, `test:all`,
    `seed`, `seed:reset`, `seed:scenario`,
    `demo:reset`, `demo:scenario`, `reconcile:executions`, `audit:verify`, `readiness`,
    `drill:restore`, `smoke`, `check:secrets-scope`. Stub unimplemented scripts with a clear
    `process.exit(1)` message naming the phase that implements them (no `console.log`).
16. `config/policy/2026.10.1.json` with placeholder thresholds and `config/metrics.json` with the
    labelled assumptions from `docs/EVALUATION.md` §8; a `scripts/policy-hash.ts` that prints the
    canonical hash.

## Acceptance criteria

- [ ] `npm run dev` serves a placeholder with the dark theme, Archivo/Space Mono and 4 px radii
      applied; there is no light theme and no theme switcher.
- [ ] shadcn/ui is configured on the Base UI base; no Mantine or daisyUI dependency exists.
- [ ] The application shell renders a permission-filtered rail and top bar with no business data.
- [ ] `/login` renders the `SignInPanel` skeleton outside the shell; `/signup`, `/invite` and `/reset`
      return 404 and no page links to them.
- [ ] `GET /api/v1/health` returns the documented shape; `db: "ok"`, `degradation: "L0_NORMAL"`.
- [ ] Removing `DATABASE_URL` fails startup with a message naming that key, not its value.
- [ ] `NODE_ENV=production` with `AUTH_CREDENTIALS_ENABLED=true` refuses to boot.
- [ ] `npm run typecheck` and `npm run lint` are clean; a `console.log` in `src/` fails lint.
- [ ] A route handler without `withRoute` fails the envelope test.
- [ ] Any request that throws returns `INTERNAL_ERROR` with a `requestId`, and the logs contain the
      real error **once** with the same `requestId`.
- [ ] CI is green on an empty unit suite.
- [ ] No secret value appears in any committed file.

## Verification

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
curl -s localhost:3000/api/v1/health | jq
npm run test:unit -- envelope
```

## Commit

`chore: bootstrap next.js foundation with env validation, envelope, tracing and CI`

## Stop

Report per `AGENTS.md` §6. Do not create the database schema and do not add business routes.
