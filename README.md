# Harper Middle Bro

Commercial lines service-desk **sandbox** — account → underwriter linking, one-click underwriter request emails, agent thread tracking, ACORD certificate generation off the schedule of record, and auto-approval when quoted premium impact is **≤ $500**.

Not wired to production Gmail, prometheus, or HTA. Mock mail only.

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

## Surfaces

| Route | Purpose |
|-------|---------|
| `/` | **Sandbox** — search account, UW card, request chips, paste/dictate, preview, send |
| `/threads` | Thread desk — Today / ≤$500 / carrier / type filters |
| `/threads/[id]` | Conversation + simulate UW quotes + human proceed |
| `/oversight` | Board — open threads, offered premium, auto-approved vs held |
| `/accounts` | Account CRM list |
| `/accounts/[id]` | Policies, UW cards, edit UW contacts, past threads |
| `/contacts` | Underwriter + carrier contacts book |
| `/queue` | Ticket queue (evolved unit-of-work view) |
| `/ai-desk` | Paced Additional Insured desk |
| `/comms` | All market-facing emails + signals |
| `/me` | Profile, signature, auto-send streaks |
| `/sign-in` · `/sign-up` | Clerk auth pages |

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

## Editing underwriter contacts

Seed UW emails are **placeholders**. Edit on account pages or browse everyone in **Contacts**. Carrier intel lives in `src/lib/carriers.ts`.

## Seed book

Fictional accounts mapped to Harper commercial-lines carriers and coverages (GL, WC, PL, BOP, Auto, Cyber, Umbrella, etc.). Markets include Hiscox, Coterie, Kinsale, AmTrust, NEXT, ISC, RT Specialty, and more.

**Reset:** Oversight → **Reset demo data**.

## Mock vs future

| Now (v1) | Later (v2) |
|----------|------------|
| Mock messages in SQLite | Gmail API on `service@` |
| Placeholder UW contacts | Import from AMS / prometheus |
| Flat $500 threshold | Per-carrier thresholds |
| Local ticket + thread link | SR# / HTA link |

## Stack

Next.js (App Router) · TypeScript · Tailwind · better-sqlite3 · local only, no auth
