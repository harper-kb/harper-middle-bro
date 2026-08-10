# PDF Fill Failure Log

Failure modes found in the certificate "PDF fill" path — schedule-of-record
data → packet → sheet → suggestions → verify → one-door issuance → printed /
saved ACORD output. Hunted with `scripts/pdf-fill-hunt.ts` (pipeline probes
over 10 diverse examples: real ISC dec-attached schedules, schedule-less real
paper, multi-policy multi-carrier, garage/ACORD 30, pre-bind, zero-policy,
blank policy number, Included/Excluded mix) and
`scripts/pdf-fill-render-hunt.tsx` (SSR render of the real studio component).

| # | Example | Symptom | Root Cause | Fix | Status |
|---|---------|---------|------------|-----|--------|
| 1 | E1 acct-real-925460 — typing the true `$1,000,000` limit as `1,000,000.00` | False "limit exceeds the policy" reject: the box claims $100,000,000 off a correct entry; conversely `1.5M` / `-500` silently misparse to $15 / $500, print as typed, and only warn | `parseMoney` strips every non-digit and multiplies by 100 — decimal points inflate the claim ×100, and any digit-bearing garbage parses as if it were dollars | Parse a proper dollar shape (`$`, commas, optional `.dd`); anything else is `invalid` → existing "Limit Isn't A Number" reject | Fixed |
| 2 | E1 acct-real-925460 — `gl.eff` edited to `02/31/2027` | The impossible calendar date passes verification and prints on the certificate (it lexically sits inside the policy term) | `isoFromMdy` range-checks month 1–12 / day 1–31 but never validates the day against the month | Round-trip the components through `Date.UTC`; a date that normalizes differently is not a real date → existing "Date Isn't MM/DD/YYYY" reject | Fixed |
| 3 | E1 acct-real-925460 — `gl.eff` 06/01/2027 + `gl.exp` 01/01/2027 | An inverted term (effective after expiration, both inside the policy term) verifies clean and prints | `verifyCoi` checks eff-not-early and exp-not-late against the policy but never eff ≤ exp on the draft itself | New `term-inverted` reject in `verifyCoi`'s term block, mapped to the section's eff field in the review rail | Fixed |
| 4 | E7 synthetic — active account, zero policies selected | **An empty certificate issues through `performCertIssuance`**: no coverage rows, no insurers, holder named → every check passes (policy-in-force is vacuous over zero policies) | Nothing in the verifier or the check registry requires a policy on the certificate; server actions guard it, but the one door itself did not | `verifyEditedSheet` rejects a sheet whose packet carries no sections (`no-policy-selected`, mapped to the header review area) → blocks at `verifier-clean` | Fixed |
| 5 | E9 acct-greenleaf — reviewer unchecks Subr Wvd / clears a limit box, then issues | The frozen fact snapshot still records `gl.subr = "Y"` and the cleared `$ 50,000` — the ledger overstates what the issued paper shows, and the snapshot digest does not move (prepared-artifact staleness is blind to the edit) | `buildFactSnapshot` only treats non-empty **string** overrides as edits; boolean `false` and cleared-to-blank strings fall through to the extracted value | Boolean `false` and blank-string overrides drop the field from the snapshot (the sheet no longer claims it); digest moves accordingly | Fixed |
| 6 | E1/E2 real ISC schedules — description prints `…additional insured per  .`; studio rail reads all-green but issuance blocks | Dec-imported AI endorsement rows carry a blank form/edition. The fill layer still auto-claims the AI flag and prints "per <blank> <blank>." — then the non-overridable `endorsement-backing-verified` check refuses the claim at the door | `buildDraftFromPolicy` claims ai/wos/pnc off `findEndorsement` without requiring the full form identity the issuance check demands | Auto-fill only claims an endorsement that carries form + edition (underreporting beats overstating); identity-less forms leave the box blank and write no description sentence | Fixed |
| 7 | Any account whose sheet runs past one page (description grows with overflow lines / long holder blocks) | Printed/saved PDF clips everything below the first page — the holder block and signature stamp are the bottom of the form | Print CSS pins `.cert-sheet` with `position: fixed; inset: 0`, which never paginates: content beyond one page box is unreachable | `position: absolute; left/top 0; width: 100%` in the print rule (no positioned ancestor sits between `body` and the sheet, so it resolves to the page origin) — the sheet paginates instead of clipping. CSS-only; verified by rule inspection, worth a manual print spot-check | Fixed |
| 8 | E2 acct-real-925420 (also 924821, 925443, 925502) | The GL type cell checks **OCCUR** on claims-made ISC paper — the dec schedules "Claims-Made and Reported Limitation" (HS/SP CMR 00 00) but the printed sheet claims occurrence coverage | `resolveChecks` derives claims-made from the coverage-part label only; real decs state it as a scheduled endorsement the resolver never read (surfaced by `scripts/cert-fill-audit.ts`, 4 Wrong Values) | GL + umbrella `resolveChecks` also read endorsement titles for the claims-made statement — CLAIMS-MADE checks, OCCUR unchecks; fill audit back to 0 wrong values | Fixed |
| 9 | E1 acct-real-925460 — reviewer MANUALLY checks Addl Insd (`gl.addl` override) against the identity-less dec-imported AI endorsement | The review rail reads all-green (0 rejects) while the one door blocks at `endorsement-backing-verified` — the exact rail/door disagreement #6 was meant to end survived through the manual-check path (adversarial supervision re-proved it after #6 landed) | Fix #6 stopped the AUTO-claim, but `verifyCoi`'s flag check only asks `findEndorsement` for any row of the right kind — the door additionally demands full form identity (form number + edition), so a manual claim passed the rail and died at the door | `verifyCoi` mirrors the door's bar for the two flags the door gates (AI / WoS): a claimed flag whose backing endorsement lacks form or edition rejects `flag-<key>`, mapping to the same `gl.addl`/`gl.subr` review cell the batch gate keys on (`src/lib/coi.ts`); permanent probe added to `scripts/pdf-fill-hunt.ts` E1 | Fixed |

## Correct fail-closed behavior confirmed while hunting (not failures)

- E4 acct-meridian: claiming AI off the **scheduled** CG 20 26 with the holder
  not bound on the AI registry blocks at `endorsement-backing-verified`
  ("Bind Requested is not bound"). With a bound holder record the same sheet
  issues.
- E5 acct-northstar: the seeded quote-insured discrepancy ("North Star
  Freight LLC" vs the account's "Northstar Logistics Inc") rejects on the
  untouched sheet — one INSURED box cannot match both papers. A garage-only
  certificate (the policy's own named insured) verifies clean and issues on
  ACORD 30.
- E6 acct-real-925505 (pre-bind, zero policies): blocked at
  `account-in-service`.
- E8 blank policy number: warns (`policy-number-missing-*`, "issue knowingly
  blank") and prints an honest blank — never invented.
- E3/E10 schedule-less paper: identity cells fill, every limit box prints
  blank (never "Excluded" without a dec), typing a dollar into an unscheduled
  section rejects, missing street address suggests nothing.

## Known quirks kept as-is (logged, not fixed)

- Stray override ids (a namespace no section owns, e.g. `umb.limit.x`, or an
  unknown box inside a fed section, e.g. `gl.limit.notARealBox`) are ignored
  by `verifyEditedSheet` but still recorded by `buildFactSnapshot`'s
  reviewer-entry loop — the ledger can record a "fact" the printed paper
  never shows. Unreachable through the studio UI (it only writes rendered
  box ids); reachable only via a crafted server-action payload. Pre-existing
  behavior (not introduced by this diff); the printed sheet and the door
  stay honest either way. Follow-up: have the verifier reject any populated
  override id it does not recognize.
- `parseMoney` accepts leading zeros ("0500" → $500) and bare short decimals
  ("1.5" → $1.50). Both parse exactly what the digits say — faithful, not a
  misparse — and any resulting overstatement still hits `limit-over`.
- The claims-made detector reads ANY endorsement title matching
  /claims-?made/ as claims-made paper — a hypothetical "Deletion of
  Claims-Made Provisions" endorsement would flip the checkbox the wrong way.
  Every real title on the book today is the CMR limitation (verified against
  `policy_endorsements`), and claims-made-when-occurrence understates rather
  than overstates; revisit if a deletion-style title ever lands on a dec.

- ACORD 25 auto section on garage paper (E5/E10): the garage policy feeds the
  Automobile Liability section and a scheduled set prints "Excluded" for
  Combined Single Limit — technically what the dec states (no CSL line), and
  the ACORD 30 form is the right paper for these accounts. Blank-beats-wrong
  holds; the form switcher is the remedy.
- Insurer-letter exhaustion past F, holder bleed, overflow-line tampering,
  Included-unbacked claims: already covered and green in
  `scripts/coi-stress.ts`, `scripts/coi-onedoor-stress.ts`, and
  `scripts/coi-confirm-gate-stress.ts`.
