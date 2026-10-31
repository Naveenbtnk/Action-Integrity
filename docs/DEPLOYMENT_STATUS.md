# Deployment status (31 October 2026)

**Current verdict: local demonstration (D0) only.** The Supabase database is connected and the Gemini investigator can produce a validated, cited report from synthetic evidence. These checks do not establish D1 pilot capability, D2 production capability, or D3 production approval under [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Verified on this workspace

- `npm run typecheck`, `npm run lint`, `npm run test:unit` (39 tests), and `npm run check:secrets-scope` passed. A production dependency audit reported zero high or critical advisories on this workstation.
- `npm run test:integration` passed the adapter, failure, RBAC route, ingest, investigation, policy, approval, break-glass, execution/verification, and reconciliation checks against the development Supabase database. Reconciliation now processes five expired approval cases per run after an accumulated backlog exceeded a 30-second transaction; remaining category throughput requires load evidence.
- `npm run gemini:check` returned a Zod-valid report with citations to both synthetic records using the configured model. This checks connectivity and response shape, not the quality of a full case investigation or the evaluation fixture set.
- `npm run test:e2e` passed all nine operator-console browser tests against the development Supabase database. `npm run test:rbac` passed. The integration audit exposed remote-database timing assumptions in two tests; the runner now forces deterministic mode and waits for committed intent with a bounded deadline. Prisma interactive transactions have a 15-second timeout for the remote connection. The focused Phase 5 and Phase 7 tests passed after those changes. The browser approval and block flow took over a minute in development; production latency has not been established.
- The public and login pages were captured at 1440 px and 390 px widths; both mobile pages had zero horizontal overflow. Tiny public labels were enlarged, and unnecessary continuous motion was removed. This visual check does not replace a full accessibility or cross-browser review.
- `npm run build` compiled and passed TypeScript, then deliberately failed during page-data collection because the production environment gate rejected absent OIDC, Redis, and external anchor settings, plus placeholder service secrets, local credential login, and disabled telemetry. The gate was left intact.

## Blocking work before a real deployment

1. Configure an OIDC provider, production `AUTH_URL`, and disable the local credentials provider. Create and test the role claims.
2. Provision shared Redis, external audit anchor storage, and OTLP telemetry. Supply these credentials through the host's secret store, not `.env` in Git.
3. Confirm the Gemini key's rotation date and account restrictions in the provider console before public deployment; these have not been independently verified.
4. Implement and pass the missing `readiness`, `audit:verify`, `test:load`, `test:chaos`, and `smoke` checks. Run the agent evaluation against the deterministic baseline, including quality and fallback cases.
5. Complete the restore, security, on-call, and human sign-off evidence required by the release gate. Publish only after the environment-specific go/no-go review.

Do not use the current workspace to process real customer data or claim production approval. The local Supabase connection is persistent storage; it does not supply the remaining security and operational controls.

Render's [Free web service](https://render.com/docs/free#spinning-down-on-idle) spins down after 15 minutes without traffic and can restart at any time. That is suitable for a synthetic demonstration, but it cannot provide this project's continuously running reconciliation, outbox, anchoring, and alerting duties by itself. A D2 deployment needs dependable scheduling and the external services above.
