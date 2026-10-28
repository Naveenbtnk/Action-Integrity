# Astro public site

`apps/public` owns the public product and trust pages. The Next.js root app owns `/login`, `/app/*`,
`/api/*`, authentication and all business data. The two projects share the steel-blueprint color,
font and spacing rules from `UI_UX_BRIEF.md`; the Astro site ships static HTML and CSS only.

## Local development

1. Start the Next.js application from the repository root with `npm run dev`.
2. In `apps/public`, run `npm ci` and `npm run dev`.
3. Set `PUBLIC_CONSOLE_URL=http://localhost:3000/login` in `apps/public/.env` when needed.
4. Open the Astro site at `http://localhost:4321`.

## Deployment

Create two Vercel projects from this repository:

| Project | Root directory | Framework | Domain | Required configuration |
|---|---|---|---|---|
| Public | `apps/public` | Astro (static) | public origin, e.g. `www.example.com` | `PUBLIC_CONSOLE_URL=https://app.example.com/login`, `PUBLIC_SITE_URL=https://www.example.com` |
| Console | repository root | Next.js | console origin, e.g. `app.example.com` | Existing Next.js production environment from `OPERATIONS.md` |

The public build is `npm run build` and output is `dist`. Static Astro deployment does not need a
server adapter. Point the public CTA to the exact console login URL. Keep the console behind its own
OIDC, RBAC and API controls; public HTML has no service keys or session access. The public site is
not a production approval claim. Update the trust page when a readiness report and named sign-offs
actually exist.

## Checks

From `apps/public`: `npm run check`, `npm run build`, then inspect `/` and `/trust/` in the preview.
Check keyboard focus, reduced motion, mobile layout, and that the CTA reaches the console origin.
