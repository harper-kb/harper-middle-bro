# Harper Middle Bro — Session Handoff

Succinct state-of-the-world for the next working session. Trust this over re-derivation; verify with `npx tsc --noEmit` + a dev-server smoke pass before big changes.

## Prime Directive
Insurance brokerage. **Accuracy beats everything.** Never invent contacts, limits, NAIC codes, prices, or form wording. Deterministic fills from the schedule of record; blank/omitted beats wrong. Suggestions must show their basis; unverifiable → say so ("UNVERIFIED — do not use" pattern in docs/acord-forms-research.md).

## Stack & Conventions
- Next.js 16.3 (Turbopack) — **read AGENTS.md + node_modules/next/dist/docs/ before assuming APIs.**
- SQLite via better-sqlite3 at `data/underwriter-desk.db`; **reseeds from code on boot** (accounts/policies upsert, schedules delete+reinsert from `FORM_SETS`). Clean slate: delete `data/underwriter-desk.db*`, restart dev server.
- Dev server :3000. Sandboxed `npm run dev` crash-loops on EMFILE (file watchers) — run it unsandboxed.
- Design system in `src/app/globals.css`: vars `--ink --muted --paper --pierre --sand --gold --coral --rule`; classes `.surface-card .eyebrow .chip .btn-primary .btn-ghost .field`; serif `font-display`. **Title Case for all UI labels/buttons/headings** (user rule). House palette — no purple/AI-slop.
- Demo data is fictional but domain-realistic (ISO form conventions: CG/CA/CU/WC/BP).

## Key Modules
| Area | Files |
|---|---|
| Types/DB | `src/lib/types.ts`, `src/lib/db.ts` (all queries; `listQuoteSamples`), seeds `seed.ts`, `tickets-seed.ts` |
| Policy schedules | `src/lib/forms.ts` (`FORM_SETS`, `PolicyLimit {slot, mode: amount/included/excluded}`), `policy-intelligence.ts` (server-only, SQLite sync), `policy-store.ts` |
| Certificates | `src/lib/acord25.ts` (`SECTION_DEFS` registry + `CERT_FORMS`: ACORD 25 **2025/12**, ACORD 30 2016/03), `src/lib/certificate.ts` (packet), `src/lib/coi.ts` (verifier), `src/lib/cert-review.ts` (area confirm state), `src/components/CertificateStudio.tsx` (editable sheet, area chips, signature) |
| NAIC | `src/lib/naic.ts` — verified codes only (Kinsale 38920, Evanston 35378 = Markel E&S never Essex, Technology Ins 42376, Spinnaker 24376 for Coterie-the-MGA, United Financial Casualty 11770 for Progressive commercial auto…). Unverified → blank. |
| Price guidance | `src/lib/price-guidance.ts` (min 3 real quotes or refuse) + `src/components/PriceGuidanceNote.tsx`; samples from `listQuoteSamples()` in db.ts |
| Contacts | `src/lib/verified-contacts.ts` (types + mailbox rules, client-safe) + `verified-contacts.server.ts` (loader). Named contacts are private: they live in gitignored `data/verified-contacts.local.json`; the committed `.data.json` ships empty. `/contacts` |
| Carriers | `src/lib/carriers.ts`, `market-path.ts` (direct/mga/wholesale/direct_bill), `carrier-theme.ts`, `CarrierLogo.tsx` + vendored `public/logos/` (official assets; monogram fallback for ISC/Thimble/RPS/Amwins) |
| Nav/Queue | `src/components/Nav.tsx` (Ascend-style sidebar, `body:has(.desk-sidebar)` offset — pages unchanged), `/queue` triage board (`lib/queue.ts`, `QueueControls.tsx`; URL params `q owner type status age sort dir`) |
| Trace | `src/lib/trace-view.ts`, `TraceExplorer.tsx`, `PathMap.tsx` — manager review: network map / thread / AI reasoning, collapsible |
| Contact gates | `src/lib/validate-contact.ts` (types + pure email logic), `validate-contact.server.ts` (Census/Smarty/Google address adapters via `ADDRESS_VALIDATOR` env, DNS MX email check, `assertDeliverableEmail`/`assertVerifiedAddress`), routes `/api/validate/{address,email}`, `ContactValidation.tsx` (debounced hooks + chips). Hard stops in CertificateStudio (holder address), NewTicketForm, EditUwForm, ProfileForm, TicketComms + SandboxCompose (recipient), and re-checked in actions.ts. Outage = "Validation Unavailable — Retry", still blocks; NO silent bypass. Seed `.example` UW desks fail MX by design → demo sends blocked until a real desk email is set. Sweep: `node scripts/contact-sweep.mjs`. |
| Research | `docs/acord-forms-research.md` — ACORD 30 + 28 specs, NAIC table, §5 verbatim 2025/12 diff. Cite it; don't re-research. |

## Certificate Flow (the crown jewel)
Account page (`/accounts/[id]`): **What The Paper Says** panel (PolicyPaperPanel, same resolver as sheet) → **Certificate Studio**: carrier-grouped PolicyPicker → faithful editable ACORD sheet → **area-level confirm** (Review n → Confirm Section → green; edit reopens area) → zero verifier rejects → **Apply Signature** (single DocuSign-style stamp, `AUTHORIZED_REPRESENTATIVE` in `brand.ts`, currently "Dakotah Rice") → Print/Save PDF (`.cert-sheet` print CSS; `.no-print` for chips). DATE + signature date always computed at render time. Included/Excluded: backed sections print dec statements; unbacked sections all-blank. Producer block = `PRODUCER` const in brand.ts (Harper Global, 425 Market St Suite 1300 SF, 470-839-4314).

## COI Stress Findings (Landed)
Description of Operations overflow now exists and is verifier-aware: extra policies beyond the printed sections render as deterministic CSV lines (`Policy #, Eff, Exp, Coverage, Occurrence, Aggregate`; `—` when dec silent) via `OverflowLine` in acord25.ts + `certDescription()`; tampered/fabricated lines reject, deletions only warn. Insurer letters capped at A–F — a 7th carrier gets a blank letter + reject "More Insurers Than The Form Carries — split the certificate or attach an ACORD 101". Stress fixture: `acct-meridian` (Meridian Reach Marketing, 6 policies/4 carriers, temporal edges). Repro harness: `npx tsx scripts/coi-stress.ts` (66 checks). Reusable agent: `.cursor/agents/coi-stress-tester.md` — run after any cert-lib change. Known limits: `.cert-sheet` print CSS is single-page (~30 overflow lines would clip; ACORD 101 is the real answer). Holder name/address are auto-growing textareas (`holderBoxRows()` helper, ~50 chars/line) — no print truncation. Account policies query orders `carrier, id` for determinism.

## Brand
Product is **"Harper Middle Bro"** (`PRODUCT_NAME`/`SHORT_NAME` in brand.ts — playful on purpose, typography stays premium serif). Wordmark: "Harper" in `--harper-orange: #ff6d63` (VERIFIED from harperinsure.com wordmark SVG letterforms — it's a warm coral, that IS the brand color), "Middle Bro" in `--ink`. Icon: orange serif "H" at `src/app/icon.svg`. Legal `PRODUCER`/`COMPANY_NAME` (ACORD producer block) is separate — never overload it with the product name. Pricing taxonomy: `PremiumBearing` is now 3-tier usually/sometimes/rarely in catalog.ts; 30-Day NOC = Usually Premium (~$100 operator heuristic); PriceGuidanceNote frames desk history as "Indication Only — Not A Quote" with basis line; Coterie has `instantQuoteApi` stub flag.

## Example Accounts
- `acct-greenleaf` single Spinnaker/Coterie BOP (Included/Excluded mix, blanket AI+WOS) · `acct-apex` Kinsale GL+Umbrella (letter A, scheduled-only AI) · `acct-ridgeline` kitchen sink A–D (Kinsale/UFC/Technology/Evanston) · `acct-northstar` ACORD 25/30 switcher (garage) · `acct-craft` liquor row (blanket AI) · `acct-pixel` E&O+Cyber rows · `acct-summit` ISC GL with blanket AI (CG 20 33) + blanket WOS (CG 24 04) · **pre-bind demos:** `acct-beacon`, `acct-bright`.

## Desk Overhaul Phase 2 (Landed This Session)
- **Account lifecycle**: `Account.status` (`pre_bind`/`active`/`cancelled`) + `paymentReceivedAt` (types/db/seed; `ensureColumn` migrations). Accounts list has status pills + filter chips; account header pill + "Mark Payment Received — Activate Service" (`markAccountPaymentReceivedAction` → `markAccountPaymentReceived`). Studio on pre-bind = **Prepare Only** (confirm everything; Sign/Print blocked with reason chip). Boot upsert deliberately does NOT overwrite status/payment — runtime flips survive reseed.
- **Blanket fast path**: `EndorsementForm.scope: "blanket" | "scheduled"` in forms.ts (synced to `policy_endorsements.scope`); helpers `findBlanketForm`/`hasBlanketAi`/`hasBlanketWos`; pure evaluator in `src/lib/fast-path.ts` (`evaluateBlanketFastPath`, `NAMED_ON_POLICY_PATTERN`). createTicketAction branch: blanket + wording suffices → `applyBlanketFastPath` (db.ts) sets `ready_to_issue` + `tickets.fast_path_basis` + a "certificate" trace decision — **no market email**. "Holder Must Be Named On The Policy" checkbox (NewTicketForm) or must-be-named wording forces the market path even with blanket on file; the draft explains why (draft.ts note). Basis string format is a verbatim contract — don't reformat. `deriveTicketStatus` keeps `ready_to_issue` sticky, so fast-path tickets can't be demoted.
- **Certificates entry point**: Nav → Records → Certificates; `/certificates` picker (active + pre-bind, policy counts, Blanket AI/WOS chips) → `/accounts/[id]#certificates`.
- **Trace zoom**: `/trace` defaults to a desk-wide overview (carrier lanes, outcome dots, DB-backed stats incl. fast-path count) → ticket map → decision spine → step; breadcrumb + Esc zooms out. `buildTraceOverview()` in trace-view.ts.
- **Ticket pipeline + Desk Brain**: `TicketPipeline.tsx` stage strip on ticket page (fast-path skip rendered as "Skipped — Blanket Fast Path" + basis chip; only recorded timestamps shown). `src/lib/desk-brain.ts` + `DeskBrain.tsx` on ticket + account pages: 11 deterministic intents (limits, blanket status, endorsements, premium, price history w/ 3-quote minimum, threads, holder, status, SR, fast path, account status) answered from a serializable bundle with citations; everything else refuses verbatim: "I Only Answer From This Account's Record." Self-checks: `scripts/desk-brain-check.ts` (16), `scripts/pipeline-render-check.tsx` (5).
- **Layout samples (review gate — real pages unchanged)**: `DeskStage.tsx` shell (trace look) + `/samples/{queue,threads,comms,ai-desk}` on real data; each real page carries a "Preview New Layout" chip. **User picks winners before any real route converts.**
- **Cert fill auditor**: `.cursor/agents/cert-fill-auditor.md` + `scripts/cert-fill-audit.ts` → `docs/cert-fill-report.md`. Baseline: 1,800 fields / 17 accounts, 0 missed, 0 wrong (negative control proves detectors live). Data findings: Apex + Northstar have conflicting named-insured spellings across policies; 10 quieter policies lack limit schedules (fill-rate ceiling).
- Live-DB note: `acct-beacon`/`acct-bright` were flipped to pre_bind via SQL (boot upsert won't do it on existing rows). Fresh DBs seed them pre_bind automatically.

## In Flight / Landing
- **Document import pipeline** (Ascend-style): modal on account page, deterministic extraction (`doc-extract.ts`), click-to-populate "found in the document" links, save→schedule of record, endorsement diff + trace logging, fixtures in data/files. May still be running — check before touching account page/import files.
- **Queued refinement**: carrier field as rich registry typeahead (legal name, office address, frequently-used ranking from DB policy counts; no invented bank/remittance data).
- **Validation gates** (address + email hard stops) — LANDED, see Contact gates row above. Seed ticket holder addresses updated to Census-verified street grids (files + live DB rows).

## Open Decisions / Small Items
1. Signature spelling: production form says "Dakotah Rice"; user has typed "Dakota" — one constant in brand.ts; awaiting explicit call.
2. ACORD footer: official prints edition+copyright on one line; ours stacks two (optional fix, shared with ACORD 30).
3. USLI verified contacts (~150 in Supabase) not yet synced into `data/verified-contacts.local.json` (private overlay — never commit named contacts).
4. Live Supabase refresh for contacts (currently dated snapshot); Gmail enrichment blocked on auth.
5. `.example` seed UW desks still shown in account "Edit Underwriter Contacts" section — reconcile with verified contacts someday.
6. Aviation certs (ACORD 20/21, tail numbers) = stated ultimate goal, future.

## Working Agreements
- Do NOT commit unless asked (repo intentionally has no commits yet).
- Multiple agents: fence files explicitly; check `git status` / running agents before editing shared surfaces (CertificateStudio, account page, Nav/queue are hot).
- Verify pattern: tsc + lints + curl route 200s + grep expected strings + sqlite cross-check numbers.
- User's style: wants Ascend-grade polish, hates favicon-blur and hallucination, prefers deterministic "boom it fills" flows, reviews by screenshots.
