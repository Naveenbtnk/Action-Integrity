# Action Integrity

**A governed control layer that stops unreliable data from producing harmful business actions — and
proves the business state was restored when prevention was too late.**

Built for the iOPEX _Data-to-Action Integrity_ evaluation.

---

## What it does

```
unreliable evidence → exposed action → hold → agent investigation → quorum approval
                    → deterministic block, release or compensation → verified business state
                    → append-only audit → external anchor
```

One action class, one target system, one closed loop:

- **Detect** semantically valid drift that schema checks miss.
- **Contain** the outbound action before it reaches the target system.
- **Investigate** contradictory evidence with a cited, read-only agent.
- **Decide** through deterministic, hash-pinned policy and accountable human quorum.
- **Act** through one idempotent, allowlisted compensation mechanism — never retried blindly.
- **Verify** the target business state, not the API response.
- **Prove** the decision with an immutable, externally anchored audit chain.

Deterministic code owns gates, thresholds, approvals, writes and verification. The model only reasons.

## Production posture

This edition is **production-capable (D2)** when the Phase 13 readiness gate passes on the release
commit. It is **not production-approved (D3)**: that requires a real IdP, a penetration test, a
data-processing agreement, an on-call rota and named sign-offs. See
`docs/PRODUCTION_READINESS.md`. The README never claims SOC 2, HIPAA, zero downtime, exactly-once
target writes, or full autonomy.

## Documentation map

| Doc                            | Contents                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `AGENTS.md`                    | Operating contract for AI coding agents (read first)                          |
| `docs/PRD.md`                  | Problem, scope, scenarios, success criteria                                   |
| `docs/TRD.md`                  | Stack, env, layout, non-functional requirements                               |
| `docs/ARCHITECTURE.md`         | Module contracts, state machine, concurrency, invariants                      |
| `docs/BACKEND_SCHEMA.md`       | Every table, enum and constraint                                              |
| `docs/DATABASE.md`             | Migrations, seed, transactions, retention, safety                             |
| `docs/API.md`                  | Endpoints, envelope, errors, rate limits                                      |
| `docs/APP_FLOW.md`             | Pages, journeys, states, overlays, edge cases, accessibility                  |
| `docs/UI_UX_BRIEF.md`          | Frontend specification: IA, routes, tokens, components, motion, accessibility |
| `docs/RBAC.md`                 | Roles, permissions, quorum, separation of duties, break-glass                 |
| `docs/FAILURE_MODES.md`        | Retry classes, degradation ladder, 26 failure modes                           |
| `docs/OBSERVABILITY.md`        | Logs, traces, metrics, SLOs, alerts, anchoring                                |
| `docs/OPERATIONS.md`           | Environments, release, incidents, 14 runbooks, DR                             |
| `docs/PRODUCTION_READINESS.md` | Go/no-go criteria, evidence, sign-offs, residual gaps                         |
| `docs/EVALUATION.md`           | Functional + adversarial suites, tiers, metrics, baseline                     |
| `docs/SECURITY.md`             | Threat model, controls, agent security, known gaps                            |
| `docs/CODE_STYLE.md`           | Conventions and testing rules                                                 |
| `docs/DECISIONS.md`            | ADRs 001–026 and rejected ideas                                               |
| `docs/IMPLEMENTATION_PLAN.md`  | Phases with done criteria                                                     |
| `docs/DEMO_SCRIPT.md`          | Timed walkthrough with a fallback line per beat (Phase 13)                    |
| `docs/prompts/`                | One copy-paste prompt per phase                                               |
| `docs/prompts/audits/`         | Read-only audits run in Phase 12                                              |

## Quickstart

> Phases 0–3 are implemented: the application shell, health contract, full database schema,
> migration guards, synthetic seed, five read-only sources, the idempotent target API and deterministic integrity detection are available. Business workflows and deployment readiness
> arrive in later phases and must be implemented in `docs/prompts/` order.

```bash
# prerequisites: Node 24 and Docker
cp .env.example .env          # fill DATABASE_URL, AUTH_SECRET, GEMINI_API_KEY,
                              # AGENT_SERVICE_KEY, TARGET_SERVICE_KEY, OPS_SERVICE_KEY, AIC_BASE_URL
docker compose up -d db redis  # host ports 15432 and 16379
npm install
npx prisma migrate deploy
npm run seed                  # prints local credentials once
npm run dev                   # http://localhost:3000
```

The health endpoint reports `503` when PostgreSQL is unavailable. Business workflows are not exposed
until later phases.

Local credentials and the rate limiter are wired in later phases. Production requires OIDC, shared
rate limiting and telemetry.

Seeded users (development only):

| Email                 | Role            | Use                                                                            |
| --------------------- | --------------- | ------------------------------------------------------------------------------ |
| `viewer@aic.local`    | VIEWER          | read-only walkthrough                                                          |
| `analyst@aic.local`   | ANALYST         | investigate, request and add evidence                                          |
| `reviewer@aic.local`  | REVIEWER        | approve, execute, verify, reopen                                               |
| `reviewer2@aic.local` | REVIEWER        | second reviewer — completes the block or write after another reviewer approved |
| `senior@aic.local`    | SENIOR_REVIEWER | high-risk approval, second approver                                            |
| `admin@aic.local`     | ADMIN           | users, policy activation, eval, operations — cannot approve                    |
| `auditor@aic.local`   | AUDITOR         | read everything, verify the chain                                              |

Passwords are printed by `npm run seed` and are never committed. Rotate or remove them before any
deployment that is not a local demo.

## Demo

```bash
npm run demo:reset                 # deterministic seed + fixture set
npm run demo:scenario -- A         # prevention: block, zero writes, verified
npm run demo:scenario -- B         # compensation with quorum, executed by a non-approver
npm run demo:scenario -- C         # conflicting evidence: no auto winner, escalation
npm run demo:scenario -- D         # verification failure: reopened, not recovered
npm run demo:scenario -- E         # safe refusal: no execution
```

The timed narrative is in `docs/DEMO_SCRIPT.md` (created in Phase 13).

## Evaluation

```bash
npm run test:scenarios -- --mode=deterministic   # baseline
npm run test:scenarios -- --mode=agent           # treatment
npm run test:adversarial                         # injection, forged citations, stale approvals
npm run test:rbac                                # role matrix, quorum, SoD, break-glass
npm run test:failure                             # dependency and concurrency failures
npm run test:load -- --rps=20 --minutes=30
npm run test:chaos -- --cases=200
npm run drill:restore
npm run readiness -- --level D2 --commit <sha>
```

Results and the comparison table appear in the Evaluation tab of `/app/analytics` (ADMIN/AUDITOR). The
functional fixtures are frozen at `v1`; changing them requires a new suite version and an ADR entry.

## Repository layout

```
docs/           product, technical, standards, operations and phase prompts
config/         policy/<version>.json (immutable), metrics.json (labelled assumptions)
prisma/         schema, migrations, deterministic seed
scenarios/      13-scenario suite (12 business + X) + adversarial tier
ops/            dashboards, alert rules
scripts/        demo, smoke, drills, readiness checks
src/app/        routes: (public), (auth), app/ control room and api/v1 handlers
src/lib/        integrity, exposure, gate, policy, approval, executor, verifier, agent, adapters,
                target, eval, audit, outbox, idempotency, reconcile, degradation, observability,
                state-machine, rbac, plus api/auth/permissions/schemas/ui support
src/components/ ui (shadcn on Base UI), accent, shell and feature components
src/test/       unit, integration, scenario, failure, chaos, rbac, api, security, audit, outbox
```

## Known gaps

Honest list — detail in `docs/SECURITY.md` §11 and `docs/PRODUCTION_READINESS.md` §7:

- Single organisation; no row-level tenancy.
- External anchor store is required in production; the demo writes local anchor files.
- No penetration test yet; synthetic data only until it is complete.
- No automated joiner/mover/leaver; quarterly access review is manual.
- No PII redaction or retention job; do not load real customer data.
- MFA depends on the IdP configuration, not the application.
- Single region; recovery relies on PITR with a 60-minute RTO.
- Break-glass trusts two administrators not to collude; every use is audited and reviewed.

## License

Private evaluation build. Not for redistribution.
