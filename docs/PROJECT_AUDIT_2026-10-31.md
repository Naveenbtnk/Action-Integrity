# Action Integrity release audit — 31 October 2026

## Verdict

**D0 local demonstration. D1 pilot capability, D2 production capability, and D3 production approval are not established.** This audit checks the repository and local synthetic-data environment. It is not a penetration test, a full code review, or a production rehearsal. `PRODUCTION_READINESS.md` remains the release authority.

## Evidence and changes

| Area | Before | After | Why |
| --- | --- | --- | --- |
| Public and login typography | Several important labels were 10–11 px. | Labels are at least 12 px in the public CSS; the login kicker and mobile product link are 12 px. | Labels remain readable without changing the established Archivo and Space Mono identity. |
| Motion | Login ribbons drifted continuously; the public HUD rotated and blinked several layers. | Login ribbons and HUD ring/dots are static. The explanatory HUD scan remains and respects reduced motion. Buttons transition only color, border, background, and transform for 150 ms. | The interface needs clear status and response, with less ambient motion. |
| Remote database tests | A concurrent ingest test assumed immediate replay; a recovery test polled committed intent for only one second. | The tests accept the documented in-progress response and wait for intent with a 20-second deadline. | Supabase round trips can exceed those test timing assumptions; the at-most-once and audit assertions remain. |
| Transactions | Prisma's default interactive transaction timeout was 5 seconds. | Interactive transactions have a bounded 15-second timeout. | Audited multi-query transactions timed out against the remote database. Monitor this under load; a longer timeout is not a performance fix. |
| Reconciliation | The job attempted every expired approval case in one 30-second transaction. | It processes five oldest cases per run; a focused Supabase test passed and the observed expired-approval backlog fell by five. | Bound the audited transaction while preserving per-case audit events. Backlog drain capacity and the other unbounded categories still need load evidence. |
| Environment gate | Obvious local/test values could satisfy the length checks for production service secrets. | Production rejects placeholder `AUTH_SECRET`, agent, target, and operations service keys. | Copying `.env` from a demo must fail closed. |

Desktop and mobile screenshots of `/` and `/login` were inspected at 1440 px and 390 px. Mobile document overflow was 0 px on both pages. The screenshots are local ignored audit artifacts in `var/`.

`npm run typecheck`, `npm run lint`, 39 unit tests, the full integration suite, the RBAC matrix, and all nine browser tests passed on this workstation. The production dependency audit found zero high or critical advisories. `npm run build` compiled and passed TypeScript, then the production environment gate rejected missing services and demo settings. These checks do not cover the D1/D2 drills and operational evidence below.

## Release blockers

1. `npm run readiness`, `npm run audit:verify`, `npm run test:load`, `npm run test:chaos`, `npm run drill:restore`, and `npm run smoke` are still explicit failing placeholders. The D1/D2 criteria they cover have no release evidence.
2. The production build currently fails the intended environment gate: no OIDC provider, shared Redis, external anchor store, or OTLP collector is configured, and local credential login/disabled telemetry remain set. This gate must not be bypassed.
3. The user has a persistent Supabase database, but a free sleeping web service alone cannot run continuous reconciliation, outbox, anchoring, and alerting duties. The reference deployment needs a dependable worker and scheduler.
4. Agent evaluation, failure/chaos/load and restore drills, audit-chain verification, deployed-origin security checks, and human sign-offs remain unverified. Reconciliation throughput and remaining unbounded categories need load evidence. No real customer data should be loaded.
5. The user reports rotating the disclosed Gemini key. Its age and restrictions were not independently verified; confirm in the provider console before deployment.

## Handoff order

Complete Phase 10 audit verification, Phase 11 infrastructure controls, and Phase 12 drills. Provision production services and a real IdP, then implement the Phase 13 readiness report. Run that gate on a clean release commit, rehearse deployment and rollback, and collect the named D3 sign-offs before real data or a production approval claim. The repository owner can connect GitHub and choose a host after the code and service configuration are reviewable; no remote push was performed during this audit.

Motion guidance: [Emil Kowalski design engineering skill](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng) and [animation review skill](https://github.com/emilkowalski/skills/tree/main/skills/review-animations). Database timeout reference: [Prisma driver documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers).
