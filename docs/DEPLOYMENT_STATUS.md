# Deployment status (31 October 2026)

**Current verdict: local demonstration only.** The Supabase database is connected and the Gemini investigator can produce a validated, cited report from synthetic evidence. These checks do not establish D1 pilot capability or D2 production capability under [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Verified on this workspace

- `npm run typecheck`, `npm run lint`, `npm run test:unit` (37 tests), and `npm run check:secrets-scope` passed after the Gemini integration.
- `npm run gemini:check` returned a Zod-valid report with citations to both synthetic records using the configured model. This checks connectivity and response shape, not the quality of a full case investigation or the evaluation fixture set.
- `npm run test:e2e` passed all eight operator-console browser tests against the development Supabase database. `npm run test:rbac -- ui-routes` passed. A remote-database transaction timeout discovered by the browser test was fixed in the block transition; the test then completed the approval, block and verification loop.
- `npm run build` compiled and passed TypeScript, then deliberately failed during page-data collection because the production environment gate rejected absent OIDC, Redis, and external anchor settings, plus local credential login and disabled telemetry. The gate was left intact.

## Blocking work before a real deployment

1. Configure an OIDC provider, production `AUTH_URL`, and disable the local credentials provider. Create and test the role claims.
2. Provision shared Redis, external audit anchor storage, and OTLP telemetry. Supply these credentials through the host's secret store, not `.env` in Git.
3. Replace the Gemini key disclosed in chat with a private key before any public deployment. The current key is suitable only for local validation.
4. Implement and pass the placeholder `readiness`, `audit:verify`, `test:load`, `test:chaos`, and `smoke` commands. Run the agent evaluation against the deterministic baseline, including quality and fallback cases.
5. Complete the restore, security, on-call, and human sign-off evidence required by the release gate. Publish only after the environment-specific go/no-go review.

Do not use the current workspace to process real customer data or claim production approval. The local Supabase connection is persistent storage; it does not supply the remaining security and operational controls.
