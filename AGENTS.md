<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Single Next.js 16 (App Router, Turbopack) app — "Harper Middle Bro", a commercial-lines service-desk sandbox. Stack: TypeScript, Tailwind v4, `better-sqlite3`, Clerk auth. Local/mock only; no external prod services.

Standard commands (see `package.json` / `README.md` / `docs/HANDOFF.md`):
- Dev server: `npm run dev` (binds `0.0.0.0:3000`). SQLite DB auto-creates and seeds at `data/underwriter-desk.db` on the first page render — no migrations. Delete `data/underwriter-desk.db*` and restart for a clean slate.
- Typecheck: `npx tsc --noEmit` (clean).
- Self-check harnesses: `bash scripts/run-checks.sh` (runs each `scripts/*-check.ts(x)` via `npx tsx`; all pass).
- Lint: `npm run lint` — has ~11 pre-existing errors in committed code (not an environment problem); typecheck is the reliable gate.

Non-obvious caveats:
- Clerk keys must live in `.env.local` (gitignored, so absent on a fresh VM). The app's keyless dev mode does NOT fully work here: the middleware in `src/proxy.ts` never loads the keyless keys, so signed-out requests to protected routes 500 with `@clerk/backend: Missing publishableKey` (the `/sign-in` and `/sign-up` public routes still render). Bootstrap keys once per VM:
  1. `npm run dev`, then hit a page once (e.g. `curl -s http://127.0.0.1:3000/sign-in`) to make Clerk provision `.clerk/.tmp/keyless.json`.
  2. Copy its `publishableKey`/`secretKey` into `.env.local` as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, then restart `npm run dev`. Protected routes then redirect to sign-in instead of 500ing.
- Creating a test user for browser testing: the keyless Clerk instance has Cloudflare Turnstile bot protection that blocks automated sign-up. Create a pre-verified user server-side via the Clerk Backend API instead: `POST https://api.clerk.com/v1/users` with `Authorization: Bearer <CLERK_SECRET_KEY>` and body `{"email_address":["you@example.com"],"password":"<15+ chars>","skip_password_checks":true}`. Then sign in through the browser (sign-in has no CAPTCHA).
- Contact validation gates need outbound network: underwriter/holder email uses a DNS MX lookup (seed `.example` desks fail by design, so change a desk to a real-MX domain before a Sandbox "Send"), and address validation uses the keyless US Census geocoder (`ADDRESS_VALIDATOR=census` default). Outages block (no silent pass-through).
