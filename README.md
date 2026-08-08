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

SQLite DB is created at `data/underwriter-desk.db` on first load (gitignored) and seeded automatically. Set `DESK_DATA_DIR` to keep it somewhere else — that is how the hosted instance points at its volume.

## Shared deployment (the portal)

The desk can run as one hosted instance so invited teammates sign in at a URL instead of running it locally. Everything it persists — the SQLite database, filed document bytes, and the private contact overlays — lives under a single directory, so hosting is one container plus one mounted volume.

`DESK_DATA_DIR` points at that volume (`/data` in the image). Unset, it falls back to `./data`, so local development is untouched.

**One instance, always.** The record is SQLite on the volume, and a volume attaches to exactly one machine. Scaling up means a second volume, which means a second empty desk serving half your traffic — so never scale this app past one machine. Deploys therefore stop the machine and start the replacement: a few seconds of downtime, and the data survives. Booting on an existing volume is idempotent — the seed pass adopts what is already there instead of re-inserting it.

### Deploy on Fly.io

```bash
fly launch --no-deploy --copy-config --name harper-middle-bro
fly volumes create desk_data --region sjc --size 1
fly secrets set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... CLERK_SECRET_KEY=sk_test_...
fly deploy
```

`fly.toml` mounts the volume at `/data`, keeps exactly one always-warm machine, retains volume snapshots for 14 days, and health-checks `/api/health`.

### Deploy on Render

Render Dashboard → **New** → **Blueprint** → pick this repo. `render.yaml` describes the same image with a 1 GB disk at `/data`; fill in the two Clerk keys when prompted. A persistent disk requires a paid instance type.

### Auth: only invited people get in

The hosted instance uses the same standalone Clerk app, with sign-up locked down. One command does the restriction, the allowlist, and the invitation emails, then reads Clerk back to prove it took:

```bash
export CLERK_SECRET_KEY=sk_test_...          # Clerk Dashboard → API keys
npx tsx scripts/clerk-lockdown.ts \
  --allow @harperinsure.com \
  --invite first@harperinsure.com --invite second@harperinsure.com
# prints a plan and changes nothing; add --apply to execute
```

It restricts sign-up to the allowlist, adds each identifier, and sends one invitation per address. Re-running is safe — entries that already exist are reported, not duplicated. Any step that fails is reported per line and the command exits non-zero, so a half-applied gate cannot look like a clean one.

Without `--apply` it only prints the plan, and without a key it prints the plan offline — so you can check the address list before a credential exists anywhere.

The Dashboard equivalent, if you would rather click: **Restrictions** → sign-up mode **Restricted**, enable **Allowlist** and add `@harperinsure.com`, then **Users** → **Invite** per teammate. Note that the Dashboard's Restricted toggle has no Backend API field, so the script uses the allowlist restriction instead — the same outcome by a different lever. Enabling an allowlist with no entries blocks every sign-up, so add entries in the same pass.

Both keys are read at runtime, so rotating the Clerk app is a secret change plus a restart — not a rebuild. Development keys (`pk_test`/`sk_test`) work on a `.fly.dev` or `.onrender.com` host and are capped at 100 users, which is what makes this possible without owning a domain. Production keys (`pk_live`) require a domain you control, so those come with a custom domain later.

### The private contact overlay

`data/verified-contacts.local.json` is gitignored and never enters the image. Without it the Contacts page is empty, which is correct. To load it on the hosted instance, copy it onto the volume rather than into the repo:

```bash
fly ssh sftp shell -a harper-middle-bro
# at the sftp prompt:
#   cd /data
#   put /absolute/path/to/verified-contacts.local.json verified-contacts.local.json
fly apps restart -a harper-middle-bro
```

The SFTP session connects as root, so the uploaded file lands root-owned; the restart is what makes it readable, because the entrypoint takes ownership of the data directory before dropping privileges.

### Health

`GET /api/health` is public and returns 200 only when the data volume is mounted and writable; it returns 503 otherwise, so a machine with a broken volume is pulled from rotation instead of serving a desk that cannot save anything.

## Fresh clone notes (collaborators)

- `npm install` then `npm run dev` is the whole setup — the SQLite database creates and seeds itself on first boot. No migrations to run.
- `.env.local` is gitignored, so a fresh clone has no Clerk keys. On first `npm run dev`, Clerk enters keyless development mode and provisions a dev instance automatically — sign-up works out of the box. To share one Clerk app across the team instead, pass the `.env.local` file directly (never commit it).
- `data/verified-contacts.local.json` (the real underwriter contact list) is private and gitignored. Without it the Contacts page shows an empty list, which is expected. If you need it, request the file directly — it must never be committed.

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

Next.js (App Router) · TypeScript · Tailwind · better-sqlite3 · Clerk (standalone dev app) · runs locally or as one container on one volume
