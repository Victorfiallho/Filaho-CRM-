# Fialho Home Improvement (repo: Filaho-CRM-)

Multi-company CRM (Vite + React 19 + TypeScript, Supabase backend). All source lives in `web/`.
Renamed from "Fialho CRM" to "Fialho Home Improvement" 2026-08-20 — repo/package name still say
CRM, that's cosmetic and not worth a rename.

## Delivery pipeline — follow this for every task

This project uses an on-demand build → validate → test → deploy loop. When asked to implement
a feature or fix, always finish the task by running the full pipeline below, in order, from `web/`:

1. **Implement** the change in `web/src`. Add/update a `*.test.ts` under `src/domain` or `src/lib`
   when you touch pure logic there (the existing suite covers dedupe, csv, ics, format, geo, etc. —
   match that style).
2. **Build**: `npm run build` (runs `tsc -b && vite build`). Must exit 0 — this is the strictest
   gate (TS project references + `noUnusedLocals`/`noUnusedParameters` are on).
3. **Lint**: `npm run lint` (oxlint). Pre-existing warnings (`react/only-export-components` on the
   `state/*Context.tsx` files, from exporting both a Provider and a hook per file) are expected and
   fine to leave. New **errors** must be fixed before continuing.
4. **Test**: `npm run test` (`vitest run`). All tests must pass. Baseline as of 2026-08-20: 14 test
   files, 113 tests, all green.
5. **Deliver** — only if steps 2–4 are all green:
   - Commit and push to `origin/main` (this repo: `github.com/Victorfiallho/Filaho-CRM-`).
   - Production deploys **automatically** from that push: the Vercel project **`web`** is
     GitHub-integrated and builds every push to `main` (Root Directory = `web`). Production URL:
     https://web-one-psi-82.vercel.app. After pushing, confirm the deployment reached `READY`
     (Vercel MCP `list_deployments` / `get_deployment`, or the dashboard); if it's `ERROR`, read
     the build logs and fix it — don't leave production on a stale build.
   - Don't also run `npx vercel --prod` from `web/`: with Root Directory set to `web`, the CLI
     resolves `web/web` and fails. If a manual deploy is ever needed, redeploy the commit from the
     Vercel dashboard/MCP, or run the CLI from the repo root.
   - Never deploy when build, lint (errors), or tests are red. Report the failure and fix it instead.

## Vercel project state (context, not something to fix blindly)

`web` is the canonical project. Until 2026-11-23 it was deployed only via the Vercel CLI; it then
got connected to GitHub with Root Directory unset, so push builds ran at the repo root and failed with
`vite: command not found` (production silently stayed on the last good build). Fixed by setting Root
Directory to `web`. If that error ever comes back, check the Root Directory first.

Older notes mention two other projects, `filaho-crm` / `filaho-crm-zg4c`, with the same misconfigured
push builds. Don't deploy through them; deploy through `web` only.

## Gotcha: missing static assets don't 404

`web/vercel.json` has a catch-all SPA rewrite (`"/(.*)" → "/index.html"`) so client-side routing
works on refresh. Side effect: a request for a static file that doesn't exist (a deleted/renamed
logo, a typo'd path) doesn't get a real 404 — it silently gets `index.html` back with a 200 and
`Content-Type: text/html`. An `<img>` pointed at that path just shows as a broken image, with
nothing obviously wrong in a quick network-tab glance (status 200). If a logo/asset looks broken
after a deploy, check the actual response body/content-type for that URL before assuming it's a
browser cache issue — `curl -sI <url>` and look for `Content-Disposition: inline; filename="index.html"`.

## Environment

- Node 24.x, npm.
- Supabase env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) come from `web/.env` locally
  (gitignored) and from the Vercel project's Environment Variables in deployments — never commit them.
- Server-only secrets for `web/api/*` functions (never `VITE_`-prefixed, so they never ship to the
  client bundle): `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`/`TWILIO_*` (existing),
  and `GROQ_API_KEY` (console.groq.com, free tier — backs `web/api/summarize-job.js`'s "Resumo com
  IA" button and `web/api/chat-agent.js`'s global assistant widget, chosen to avoid API cost. Tried
  Gemini first; abandoned after Google AI Studio started issuing "AQ."-prefixed keys that 401 with
  ACCESS_TOKEN_TYPE_UNSUPPORTED — a known, unresolved bug on Google's side as of 2026-08-31, not
  this codebase). Same secrets are needed as GitHub Actions secrets for the `scripts/*.mjs` crons
  that use them.
- Booking page / consent (migration `2026-10-13_11`): `UNSUBSCRIBE_SECRET` (HMAC key for `/u/<token>`
  email unsubscribe links — any long random string; changing it invalidates links already sent) and
  `SMS_INBOUND_SECRET` (shared secret for `POST /api/sms-inbound?key=...`, until an SMS provider's own
  signature check replaces it). Both endpoints refuse every request while their secret is unset.
  Optional `PUBLIC_BASE_URL` pins the origin used in canonical URLs and `consent_records.page_url`.
  Every marketing send must go through `checkCanSendMarketing()` in `web/api/_lib/consentStore.js`.
  Don't put non-route `.js` files (tests included) directly in `web/api/` — Vercel turns each one into a
  function; shared code and tests live in `web/api/_lib/`.
- Local-only: `npm run dev` (plain Vite) doesn't serve `web/api/*` — those are Vercel functions, so
  a local `fetch("/api/...")` 404s unless you also run `vercel dev --listen 3000` in a second
  terminal (`vite.config.ts`'s `server.proxy` forwards `/api` there). `vercel dev` itself has an
  unrelated bug where it can't parse this project's `index.html` (Vite v8 incompatibility) — don't
  browse the app on its port, only use it as the `/api` proxy target.
