# Gemini investigator setup

Gemini is used only for the read-only investigation report. It cannot set policy, approve a case, call the target writer, or close a case. The deterministic gate, policy, approval, executor, and verifier remain authoritative.

## Local synthetic demo

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Store it only as `GEMINI_API_KEY` in the Git-ignored `.env`. Revoke any key disclosed in a chat, screenshot, log, or repository. Do not use a disclosed key for a public deployment.
2. Set `GEMINI_MODEL=gemini-3.5-flash-lite` and `INVESTIGATION_MODE=agent` in `.env`. Model availability changes; this identifier was checked against the project's API key on 31 October 2026.
3. Run `npm run gemini:check`. The command sends **synthetic evidence only**, requires a Zod-valid report with real citations, and prints no key, prompt, or response text.
4. Restart `npm run dev`. Investigate a seeded case from the console. Its report records model ID, prompt version, token usage, citations, and whether deterministic fallback was used.

If the model call fails, the investigator persists a deterministic fallback report. Fallback remains a held recommendation and cannot authorize a write. The model receives at most 20 bounded evidence blocks; prompts and evidence excerpts must not be logged.

The provider accepts a JSON Schema subset. `geminiJsonSchema` sends a minimal shape to Gemini; `InvestigationReportSchema` validates the complete response locally, and `validateReport` removes unknown citations and caps confidence when claims lack valid refs. See [Google's structured-output guidance](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

## Deployment boundary

An API key and a passing `gemini:check` are **not** a production readiness verdict. Production agent mode requires a private key, configured OIDC identity, shared rate limiting, external audit anchors, operational jobs, evaluation, load and failure evidence, and the release gate in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). The current repository still has placeholder readiness, audit verification, load, and chaos commands; do not describe it as production-capable until those gates are implemented and pass.
