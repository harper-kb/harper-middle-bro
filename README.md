# Step Bro

Commercial lines **service operating CRM** (repository: `harper-middle-bro`) — task-grain desk, account workspace, underwriter communications, ACORD certificate generation off the schedule of record, and auto-approval when quoted premium impact is **≤ $500**.

Not wired to production Gmail, prometheus, or HTA. Mock mail only until live adapters are provisioned.

## Quick start

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

1. **Sign Up / Sign In** (Clerk — this app has its own Clerk product; keys in `.env.local`)
2. **Sandbox** (`/`) → type a company, pick request type, paste/dictate details, send
3. Open the thread → **Simulate UW quote $250** (auto-proceeds) or **$1,200** (needs human)

Claim the keyless Clerk app later with `npx clerk auth login` (or the in-app “Configure your application” prompt) so it appears in your Clerk Dashboard.

SQLite DB is created at `data/underwriter-desk.db` on first load (gitignored) and seeded automatically.

## Fresh clone notes (collaborators)

- `npm install` then `npm run dev` is the whole setup — the SQLite database creates and seeds itself on first boot. No migrations to run.
- **Can't get past auth?** Put `NEXT_PUBLIC_DESK_LOCAL_AUTH=1` in `.env.local` and restart. The desk opens as a single local operator with Clerk out of the request path — no keys, no instance, no sign-up. Development only; a production build ignores the flag. Two escape hatches if you'd rather fix Clerk itself: `npx tsx scripts/clerk-keys-check.ts` reports which key is dead, and visiting `/clerk-reset` clears cached keyless credentials and cookies so a fresh instance is provisioned.
- `.env.local` is gitignored, so a fresh clone has no Clerk keys. On first `npm run dev`, Clerk enters keyless development mode and provisions a dev instance automatically — sign-up works out of the box. To share one Clerk app across the team instead, pass the `.env.local` file directly (never commit it).
- `data/verified-contacts.local.json` (the real underwriter contact list) is private and gitignored. Without it, verified-contact loaders return empty — expected. Request the file directly if needed; never commit it.

## Surfaces

| Route | Purpose |
|-------|---------|
| `/` | **Sandbox** — search account, UW card, request chips, paste/dictate, preview, send |
| `/threads` | Thread desk — Today / ≤$500 / carrier / type filters |
| `/threads/[id]` | Conversation + simulate UW quotes + human proceed |
| `/oversight` | Board — open threads, offered premium, auto-approved vs held |
| `/accounts` | Account CRM list |
| `/accounts/[id]` | Policies, UW cards, past threads, certificates |
| `/queue` | Ticket queue (evolved unit-of-work view) |
| `/ai-desk` | Paced Additional Insured desk |
| `/comms` | Market-facing emails, signals, and intake triage |
| `/me` | Profile, signature, auto-send streaks |
| `/sign-in` · `/sign-up` | Clerk auth pages |

The former `/pending` intake board has been removed; intake triage lives under **Comms** going forward.

## Auth (Clerk)

This repo is a **standalone Clerk application** (not Harper production auth). Development keys live in `.env.local` (gitignored). First Clerk login creates/links an `operators` row so signatures and streaks stick to the user.

## Keyboard (Sandbox)

- `/` — focus account search
- `1`–`9` — select request type chips
- `⌘↵` / `Ctrl↵` — send

## Email templates

Pick **Standard**, **Brief**, **Formal**, or **Bullets** in Sandbox. Preview regenerates from the selected request type + account/policy. Signature comes from the signed-in operator.

## Auto-approve rule

When you simulate an underwriter quote:

- **≤ $500** → agent replies "Proceed…" and status becomes `auto_approved`
- **> $500** → agent holds for a human; use **Human: proceed anyway** on the thread

Threshold: `AUTO_APPROVE_THRESHOLD_CENTS` in `src/lib/types.ts` (default `50000`).

## Seed book

Fictional accounts mapped to Harper commercial-lines carriers and coverages (GL, WC, PL, BOP, Auto, Cyber, Umbrella, etc.). Markets include Hiscox, Coterie, Kinsale, AmTrust, NEXT, ISC, RT Specialty, and more.

**Reset:** Oversight → **Reset demo data**.

## Mock vs future

Server-only adapters will read live BigBrother workbench data and mutate through Harper Agent Tools doors. Until credentials reconcile, affected lanes run in a clearly labeled sample mode — never unlabeled fake numbers.
