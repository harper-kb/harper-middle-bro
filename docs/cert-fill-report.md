# Certificate Fill Audit — 2026-08-10

Auditor: cert-fill-auditor · Pipeline under test: the one-door assembler `buildFactSnapshot` (`cert-snapshot.ts`) → `buildCertificatePacket` → `resolveCertSheet` (ACORD 25 2025/12; ACORD 30 2016/03 for garage accounts), plus the `cert-checks.ts` presend registry and the `carrier-knowledge.ts` enforcement gates · Schedule of record: `data/underwriter-desk.db` read directly via SQL. Expected values are recomputed from raw rows independently of the resolver.

## Headline

Of **3528 fillable fields** across **42 accounts** (44 sheets), **945 filled correctly**, **2571 correctly blank**, **12 missed**, **0 wrong**.

- **Fictional Seed Accounts** (17): 578 filled correct, 1040 correctly blank, 0 missed, 0 wrong — Fill Rate 100.0%, Accuracy 100.0%.
- **Real ISC Accounts** (`acct-real-*`, 25 with policies): 367 filled correct, 1531 correctly blank, 12 missed, 0 wrong — Fill Rate 96.8%, Accuracy 99.4%. 10 carry dec-verified schedules (writer + limits attached off the dec); the rest are unattached and audit as honest blanks.

- **Platform Fill Rate:** 98.7% (Filled Correct ÷ fields the schedule can back)
- **Platform Accuracy:** 99.7% (Filled Correct + Correctly Blank ÷ all fillable fields)
- **Static/Producer fields:** 528 verified against `brand.ts` (producer block, signature, render-time date)
- Correctly Blank includes 16 boxes printing the dec statement "Excluded" where the schedule is silent inside a backed section — the platform's blank-equivalent (claims nothing), per the accuracy contract in `src/lib/acord25.ts`.

## Scoreboard Per Account

| Sheet | Total Fields | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Static | Fill Rate | Accuracy |
|---|---|---|---|---|---|---|---|---|
| acct-apex | 91 | 37 | 42 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-beacon | 92 | 15 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-bright | 88 | 14 | 62 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-cedar | 95 | 22 | 61 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-craft | 94 | 26 | 56 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-greenleaf | 90 | 26 | 52 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-harbor | 101 | 34 | 55 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-ironclad | 91 | 21 | 58 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-lakeside | 88 | 14 | 62 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-meridian | 134 | 91 | 31 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-metro | 88 | 14 | 62 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-metro · ACORD 30 | 99 | 14 | 73 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-northstar | 100 | 40 | 48 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-northstar · ACORD 30 | 105 | 46 | 47 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-oakridge | 88 | 14 | 62 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-pixel | 102 | 24 | 66 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-916015 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-922732 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-924286 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-924594 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-924634 | 92 | 13 | 67 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-924654 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-924821 | 89 | 20 | 55 | 2 | 0 | 12 | 90.9% | 97.4% |
| acct-real-925420 | 89 | 20 | 55 | 2 | 0 | 12 | 90.9% | 97.4% |
| acct-real-925434 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925438 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925443 | 88 | 20 | 56 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925448 | 89 | 20 | 55 | 2 | 0 | 12 | 90.9% | 97.4% |
| acct-real-925454 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925460 | 89 | 20 | 55 | 2 | 0 | 12 | 90.9% | 97.4% |
| acct-real-925472 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925495 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925501 | 88 | 20 | 56 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925502 | 88 | 20 | 56 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925533 | 88 | 20 | 56 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925543 | 89 | 20 | 55 | 2 | 0 | 12 | 90.9% | 97.4% |
| acct-real-925551 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925579 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925588 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-real-925647 | 89 | 20 | 55 | 2 | 0 | 12 | 90.9% | 97.4% |
| acct-real-925681 | 88 | 11 | 65 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-redwood | 91 | 21 | 58 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-ridgeline | 118 | 81 | 25 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-summit | 91 | 24 | 55 | 0 | 0 | 12 | 100.0% | 100.0% |
| **Platform** | **4056** | **945** | **2571** | **12** | **0** | **528** | **98.7%** | **99.7%** |

## Dec-Verified Sample Scorecard (Real Book + Hard Seeds)

The operator sample: every real account whose dec-page schedule is attached and writer-verified (`policies.issuing_carrier` set), plus two hard seeds — `acct-meridian` (6 policies / 4 carriers, overflow) and `acct-northstar` (garage, ACORD 25 + 30).

| Sheet | Account | Total | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Fill Rate | Accuracy |
|---|---|---|---|---|---|---|---|---|
| acct-meridian | Meridian Reach Marketing LLC | 134 | 91 | 31 | 0 | 0 | 100.0% | 100.0% |
| acct-northstar | Northstar Logistics Inc | 100 | 40 | 48 | 0 | 0 | 100.0% | 100.0% |
| acct-northstar · ACORD 30 | Northstar Logistics Inc | 105 | 46 | 47 | 0 | 0 | 100.0% | 100.0% |
| acct-real-924821 | Rg Drywall LLC | 89 | 20 | 55 | 2 | 0 | 90.9% | 97.4% |
| acct-real-925420 | De Premier Construction LLC | 89 | 20 | 55 | 2 | 0 | 90.9% | 97.4% |
| acct-real-925443 | Biscardi And Bouffard Group, LLC DBA B&B Wash, B&B Clearflow | 88 | 20 | 56 | 0 | 0 | 100.0% | 100.0% |
| acct-real-925448 | Joaquin Chaidez | 89 | 20 | 55 | 2 | 0 | 90.9% | 97.4% |
| acct-real-925460 | Justin Bowling DBA Justin Michael Construction | 89 | 20 | 55 | 2 | 0 | 90.9% | 97.4% |
| acct-real-925501 | Cornerstone Contracting Group | 88 | 20 | 56 | 0 | 0 | 100.0% | 100.0% |
| acct-real-925502 | Clean Touch Roofing | 88 | 20 | 56 | 0 | 0 | 100.0% | 100.0% |
| acct-real-925533 | Fire & Water Restorers Inc | 88 | 20 | 56 | 0 | 0 | 100.0% | 100.0% |
| acct-real-925543 | Franklin And Son LLC | 89 | 20 | 55 | 2 | 0 | 90.9% | 97.4% |
| acct-real-925647 | Sydnie Moon DBA LM Company | 89 | 20 | 55 | 2 | 0 | 90.9% | 97.4% |
| **Sample** | | **1225** | **377** | **680** | **12** | **0** | **96.9%** | **98.9%** |

## Missed Fills And Wrong Values

### Missed Fills

| Sheet | Section | Field | Expected (Source) | Got |
|---|---|---|---|---|
| acct-real-924821 | Commercial General Liability | `gl.addlInsd` | checked (policy_endorsements[pol-real-15443] kind=ai) | unchecked |
| acct-real-924821 | Description | `desc.grant.ai` | [ai grant sentence — endorsement is on the schedule] (policy_endorsements[pol-real-15443] kind=ai — title only, form/edition BLANK on record) | [absent] |
| acct-real-925420 | Commercial General Liability | `gl.addlInsd` | checked (policy_endorsements[pol-real-15461] kind=ai) | unchecked |
| acct-real-925420 | Description | `desc.grant.ai` | [ai grant sentence — endorsement is on the schedule] (policy_endorsements[pol-real-15461] kind=ai — title only, form/edition BLANK on record) | [absent] |
| acct-real-925448 | Commercial General Liability | `gl.addlInsd` | checked (policy_endorsements[pol-real-15554] kind=ai) | unchecked |
| acct-real-925448 | Description | `desc.grant.ai` | [ai grant sentence — endorsement is on the schedule] (policy_endorsements[pol-real-15554] kind=ai — title only, form/edition BLANK on record) | [absent] |
| acct-real-925460 | Commercial General Liability | `gl.addlInsd` | checked (policy_endorsements[pol-real-15488] kind=ai) | unchecked |
| acct-real-925460 | Description | `desc.grant.ai` | [ai grant sentence — endorsement is on the schedule] (policy_endorsements[pol-real-15488] kind=ai — title only, form/edition BLANK on record) | [absent] |
| acct-real-925543 | Commercial General Liability | `gl.addlInsd` | checked (policy_endorsements[pol-real-15531] kind=ai) | unchecked |
| acct-real-925543 | Description | `desc.grant.ai` | [ai grant sentence — endorsement is on the schedule] (policy_endorsements[pol-real-15531] kind=ai — title only, form/edition BLANK on record) | [absent] |
| acct-real-925647 | Commercial General Liability | `gl.addlInsd` | checked (policy_endorsements[pol-real-15552] kind=ai) | unchecked |
| acct-real-925647 | Description | `desc.grant.ai` | [ai grant sentence — endorsement is on the schedule] (policy_endorsements[pol-real-15552] kind=ai — title only, form/edition BLANK on record) | [absent] |

## Failure Modes (Numbered)

Every Missed Fill and Wrong Value above, grouped into distinct failure modes — one line each with a repro account. Honest blanks (dec silent, field blank) are passes and are not listed.

1. **MISSED FILL** `gl.addlInsd` (Commercial General Liability) — repro `acct-real-924821` (+5 more sheets: acct-real-925420, acct-real-925448, acct-real-925460, acct-real-925543, acct-real-925647): expected checked, got unchecked. Unclassified — investigate by hand.
2. **MISSED FILL** `desc.grant.ai` (Description) — repro `acct-real-924821` (+5 more sheets: acct-real-925420, acct-real-925448, acct-real-925460, acct-real-925543, acct-real-925647): expected [ai grant sentence — endorsement is on the schedule], got [absent]. Fill-Rule Gap — a grant endorsement on the schedule never surfaced in the description.

## Enforcement Controls (Synthetic Probes)

The live data carries no ISC excess line, so the carrier-knowledge gate never fires in the account audits — these synthetic probes prove the detectors and gates are live. A control failure is a critical finding.

| Control | Verdict | Detail |
|---|---|---|
| Registry Gate Fires On ISC Excess + Additional Insured | Pass | isc-excess-no-additional-insured |
| Registry Gate Silent On Kinsale Excess + Additional Insured | Pass | [no hit — correct] |
| Packet Rejects Forbidden AI On ISC Excess (And Blocks Issue) | Pass | rejects=[carrier-knowledge-isc-excess-no-additional-insured] okToIssue=false |
| Presend Registry Fails Carrier Knowledge — Override Refused | Pass | status=fail overridable=false |
| Wrong-Value Detector Flags A Tampered Limit | Pass | schedule $1,000,000 vs sheet $2,000,000 → mismatch detected |

- Snapshot digest determinism: every sheet built twice with the same injected clock produced identical digests (44 sheets).

## SQLite Spot Checks

Direct SQL against `data/underwriter-desk.db`, compared to the rendered sheet value — not trusting the lib end to end.

| Check | SQL Value | Sheet Value | Verdict |
|---|---|---|---|
| Ridgeline GL Each Occurrence | $1,000,000 | $1,000,000 | Match |
| Greenleaf Personal & Adv Injury (dec statement) | Included | Included | Match |
| Meridian Cyber Aggregate (overflow line) | $1,000,000 | $1,000,000 | Match |
| Apex Umbrella Each Occurrence | $5,000,000 | $5,000,000 | Match |
| Summit INSURER A NAIC (dec-page writer wins over ISC brand) | 25798 | 25798 | Match |
| Real ISC Account Limit Count (dec-page schedule vs printed sheet) | 6 | 6 | Match |
| Northstar Garagekeepers Comp/OTC LOC (ACORD 30) | LOC 1 | LOC 1 | Match |

- Ridgeline GL Each Occurrence: `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-ridgeline-gl' AND slot='gl_each_occurrence'`
- Greenleaf Personal & Adv Injury (dec statement): `SELECT mode FROM policy_limits WHERE policy_id='pol-greenleaf-bop' AND slot='gl_personal_adv'`
- Meridian Cyber Aggregate (overflow line): `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-meridian-eo' AND slot='cyber_aggregate'`
- Apex Umbrella Each Occurrence: `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-apex-umb' AND slot='umb_each_occurrence'`
- Summit INSURER A NAIC (dec-page writer wins over ISC brand): `SELECT issuing_carrier FROM policies WHERE id='pol-summit-gl' — Sutton National → NAIC 25798`
- Real ISC Account Limit Count (dec-page schedule vs printed sheet): `SELECT COUNT(*) FROM policy_limits WHERE policy_id='pol-real-15443'`
- Northstar Garagekeepers Comp/OTC LOC (ACORD 30): `SELECT loc FROM policy_limits WHERE policy_id='pol-northstar-gar' AND slot='gk_comp_otc'`

## Schedule Drift (FORM_SETS Vs SQLite)

None — the seeded `FORM_SETS` and the SQLite schedule tables agree row for row.

## Risk Notes

- **acct-apex** — one INSURED box, 2 named-insured spellings across its policies: "Apex Roofing LLC", "Apex Roofing, L.L.C.". The sheet prints the first policy's paper (KIN-GL-884201); the others' certs would read differently.
- **acct-beacon** — 1 unscheduled policy (bare coverage codes, no limits on record): HSX-EO-661203. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-bright** — 1 unscheduled policy (bare coverage codes, no limits on record): MKL-PKG-442910. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-cedar** — 2 unscheduled policies (bare coverage codes, no limits on record): MKL-CP-774456, NXT-GL-774455. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-ironclad** — 2 unscheduled policies (bare coverage codes, no limits on record): AMT-WC-552119, KIN-GL-552120. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-lakeside** — 1 unscheduled policy (bare coverage codes, no limits on record): HSX-PKG-338821. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-metro** — 1 unscheduled policy (bare coverage codes, no limits on record): ISC-GAR-112233. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-northstar** — one INSURED box, 2 named-insured spellings across its policies: "North Star Freight LLC", "Northstar Logistics Inc". The sheet prints the first policy's paper (AMT-GAR-778302); the others' certs would read differently.
- **acct-oakridge** — 1 unscheduled policy (bare coverage codes, no limits on record): NXT-GL-667788. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-916015** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01-0000381. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-922732** — 1 unscheduled policy (bare coverage codes, no limits on record): ISCPC04000092185. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-924286** — 1 unscheduled policy (bare coverage codes, no limits on record): ISCSP000026323. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-924594** — 1 unscheduled policy (bare coverage codes, no limits on record): ISCSPCM000026410. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-924634** — 1 unscheduled policy (bare coverage codes, no limits on record): P107.050.488. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-924654** — 1 unscheduled policy (bare coverage codes, no limits on record): ISCSP000026320. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925434** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01-0000296. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925438** — 1 unscheduled policy (bare coverage codes, no limits on record): ISCPC04000092133. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925454** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01-0000306. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925472** — 1 unscheduled policy (bare coverage codes, no limits on record): ISCP04000092146. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925495** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01CM-0000376. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925551** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01-0000350. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925579** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01CM-0000351. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925588** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01CM-0000364. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-real-925681** — 1 unscheduled policy (bare coverage codes, no limits on record): HSIC-ISC01-0000388. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **acct-redwood** — 2 unscheduled policies (bare coverage codes, no limits on record): AMT-WC-910448, KIN-GL-910447. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.
- **MGA brand on the INSURER line** — 14 sheet(s) print "ISC" with a blank NAIC cell because no dec-page writer is recorded (`policies.issuing_carrier` is empty). Honest per doctrine (never a guessed code), but ISC is an MGA, not an insurer — per carrier knowledge `isc-writer-*`, a certificate naming ISC on the INSURER line misidentifies the insurer. Record the writer at intake to resolve: acct-real-916015 (letter A), acct-real-922732 (letter A), acct-real-924286 (letter A), acct-real-924594 (letter A), acct-real-924654 (letter A), acct-real-925434 (letter A), +8 more.
- **Insured street address missing on dec-verified real accounts** (Data Gap) — 10 account(s) carry no `address1`/`zip` on the accounts row (acct-real-924821, acct-real-925420, acct-real-925443, acct-real-925448, acct-real-925460, acct-real-925501, acct-real-925502, acct-real-925533, acct-real-925543, acct-real-925647). The INSURED box prints name + city/state only — honest blanks per doctrine, but the dec carries a mailing address the import never captured; holders can reject a cert with a bare-city insured block.
- **No policies on record** — acct-real-925505: no certificate can exist for these accounts; they are outside the fill audit.

## Method And Definitions

- **Filled Correct** — the sheet value matches the schedule of record exactly (raw SQLite rows, or `naic.ts` registry for insurer identity).
- **Correctly Blank** — the schedule is silent and the field claims nothing (blank, unchecked, or the dec statement "Excluded" on a silent line inside a backed section).
- **Missed Fill** — the schedule has the value; the sheet left it blank (includes any scheduled limit that surfaces nowhere: section box, additional row, or description overflow).
- **Wrong Value** — the sheet shows something the schedule cannot back. Critical, automatic fail.
- **Static/Producer** — brand constants (producer block, signature, render-time DATE), verified against `src/lib/brand.ts` and the studio wiring.
- Fill Rate = Filled Correct ÷ (Filled Correct + Missed Fill). Accuracy = (Filled Correct + Correctly Blank) ÷ all fillable fields.
- Expected values are recomputed in this script from raw SQL rows (doctrine restated, not imported), so a resolver bug cannot vouch for itself. Holder fields use a fixed audit holder ("Audit Holder LLC") and are verbatim-carry checks.
- Insurer letters are expected per WRITING PAPER (dec-page writer via `policies.issuing_carrier`, else brand) — two ISC policies on different writers are different insurers.
- Insured address cells (`insured.addr1/city/state/zip`) audit the account-record auto-fill: expected straight off the `accounts` row, wiring verified against `CertificateStudio.tsx` source. A blank street line on record yields honest blanks.
- Carrier-knowledge gates (`carrier-knowledge.ts`) are cross-checked on every printed Additional Insured box and probed synthetically (Enforcement Controls) since the live data has no ISC excess line.
- Claims-made evidence is read from BOTH the coverage-part label and scheduled endorsement titles (real ISC decs carry "Claims-Made and Reported Limitation") — an OCCUR check against claims-made paper is a Wrong Value.
- Description grants are audited for citation integrity: a grant endorsement recorded title-only (blank form/edition) backs the wording but no citation — a dangling "per  ." cite is a Wrong Value, and any concrete cite must trace to a scheduled form.
- Deterministic: same DB state → same report (snapshot clock injected). Run: `npx tsx scripts/cert-fill-audit.ts`. Exit code = wrong values + control failures.

## Trend

Same-day re-run. Previous pass: Fill Rate 98.7%, Accuracy 99.7%. This pass: Fill Rate 98.7%, Accuracy 99.7%.
