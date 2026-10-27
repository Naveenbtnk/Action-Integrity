# Read-only audit 2 — Security, privilege and data exposure

**Mode:** READ ONLY. No code, config or dependency changes. No "quick fixes". Stop after the report
and wait for explicit approval.

## Setup

Read `docs/SECURITY.md`, `docs/RBAC.md` (normative), `docs/API.md` §3–§5, `docs/BACKEND_SCHEMA.md`,
`docs/FAILURE_MODES.md`, `AGENTS.md` §2, then inspect every route handler, `lib/rbac.ts`,
`lib/approval/*`, `lib/break-glass/*`, `lib/degradation/*`, `lib/env.ts`, `lib/executor/*`,
`lib/agent/*`, `middleware.ts`, `next.config.ts`, the Prisma schema and the seed.

## Scope

1. **Authentication** — session issuance and validation, cookie flags, expiry and rolling behaviour,
   deactivated-user handling, role re-read versus token trust, session epoch invalidation, password
   hashing and logging.
2. **Authorization** — every route matched to `ROUTE_PERMISSIONS`; six roles and the union rule;
   `ADMIN` holds no business permission and `ADMIN` + reviewer/senior/auditor is impossible in the
   schema and the seed; service principals `agent`, `target`, `ops` are scoped and cannot cross
   (agent cannot reach the target; target cannot open cases; ops cannot approve); whether UI hiding
   is being mistaken for authorization. Enumerate the full role × route matrix and mark any route
   with no entry.
3. **Accountable approval** — quorum counts distinct humans and demands `SENIOR_REVIEWER` on high
   risk; approvals are bound to `(boundEvidenceHash, boundPolicyHash, boundReportId,
   boundDisposition)`; expiry is enforced server-side; new evidence, a new report or a policy
   activation supersedes `VALID` approvals and returns the case to `AWAITING_APPROVAL`; a rejected
   approval revokes the rest; `APPROVER_CANNOT_EXECUTE`; the override author cannot approve or
   execute; duplicate approver and conflicting approval are 409. Any path that reaches `APPROVED`
   without quorum, or executes an approval whose bound hash no longer matches, is CRITICAL.
4. **Break-glass** — requester and co-signer are two different admins; scope is one case; TTL is
   bounded; only the requester executes inside the window; self co-sign, cross-case reuse, policy or
   user changes and silent expiry are all findings; every transition is audited and `USED` pages.
5. **Policy pinning** — exactly one `ACTIVE` `PolicyVersion`; activation verifies version and hash
   against the file and records a review ticket; no active policy fails closed as
   `POLICY_UNAVAILABLE`; no route, env var or request can override thresholds, quorum or the
   disposition set at runtime; a decision whose `policyHash` no longer matches is `POLICY_STALE`.
6. **Service credentials** — `AGENT_SERVICE_KEY`, `TARGET_SERVICE_KEY` and `OPS_SERVICE_KEY` usage
   sites, timing-safe comparison, scope separation, rotation, and whether any key can reach the
   client bundle, logs or error responses.
7. **Injection and input handling** — Zod coverage at every boundary including LLM output and
   adapter responses; unknown-field rejection; length limits; raw SQL usage; any place user input
   reaches a query, a shell, a file path or a template.
8. **Agent-specific risk** — tool allowlist, absence of any write tool, evidence framing,
   instruction-in-evidence handling, citation validation, prompt builder secret stripping, cost and
   loop guards, whether agent output can influence a threshold, an approval or a final write.
9. **Data exposure** — cross-account or cross-role reads, IDOR on case/action/evidence refs, response
   projections returning more fields than documented, seeded-PII handling, log contents (tokens,
   payloads, prompts, rationales), client-side data leakage, `dangerouslySetInnerHTML`, source maps
   in production.
10. **Abuse and availability** — rate-limit coverage and fail-closed behaviour when Redis is absent;
    bypasses (key rotation, header spoofing); idempotency abuse; unbounded queries or pagination;
    LLM cost amplification; authorization on reconcile, outbox replay, degradation and anchor
    endpoints.
11. **Transport and headers** — CSP, HSTS, frame options, CORS/`ALLOWED_ORIGINS`, error leakage of
    stack traces, SQL, file paths or upstream messages.
12. **Audit integrity** — append-only enforcement in both Prisma and raw SQL (including
    `EscalationEvent`, `AuditAnchor` and `tgt_audit`), hash-chain coverage of every consequential
    action, whether an actor can act without producing an `AuditEvent`, whether a detected chain
    break actually blocks writes (`L4`), whether anchors are written and verifiable, and whether any
    test-only bypass is reachable in production.

## Required format per finding

```
[SEVERITY] CRITICAL | HIGH | MEDIUM | LOW
[STATUS]   CONFIRMED | UNVERIFIED
[CLASS]    MISSING | BROKEN | MISCONFIGURED | UNVERIFIED
[LOCATION] file:line or route
[EVIDENCE] quoted code, request/response, or the absence that proves the gap
[ATTACK OR FAILURE PATH] who does what, in order
[IMPACT] data / business state / account takeover / audit integrity
[PRECONDITION] what the attacker or operator needs
[DETECTION] what would reveal it
[PREVENTION] the specific control and its enforcement point
[RECOVERY] containment and evidence preservation
```

A control is only "present" if you can name the enforcement point. A library being installed is not
evidence. If you cannot verify a claim from the code, mark it `UNVERIFIED`.

## Report sections

1. CRITICAL — exploitable or trust-destroying now
2. HIGH
3. MEDIUM / LOW
4. ROLE × ROUTE AUTHORIZATION MATRIX — with the gaps marked
5. QUORUM, BINDING AND BREAK-GLASS EVIDENCE — every path to `APPROVED` and every elevation, with the
   enforcement point for each binding and expiry rule
6. POLICY AND DEGRADATION STATE — active version, hash, activation audit, and what each degradation
   level actually blocks
7. AGENT CAPABILITY MATRIX — tools, inputs, outputs, and what each can influence
8. SECRETS AND DATA-FLOW MAP — where each key and each class of customer data travels
9. CONTROL CLAIMS VS EVIDENCE — every claim in `SECURITY.md` marked VERIFIED / PARTIAL / UNVERIFIED
10. TOP 10 FIX PRIORITIES
11. HONEST GAP LIST for `SECURITY.md` §11 — wording ready to paste, excluding anything already true

Save as `docs/audits/<YYYY-MM-DD>-security.md`. Stop after writing the report.
