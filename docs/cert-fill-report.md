# Certificate Fill Audit — 2026-08-11

Auditor: cert-fill-auditor · Pipeline under test: the one-door assembler `buildFactSnapshot` (`cert-snapshot.ts`) → `buildCertificatePacket` → `resolveCertSheet` (ACORD 25 2025/12; ACORD 30 2016/03 for garage accounts), plus the `cert-checks.ts` presend registry and the `carrier-knowledge.ts` enforcement gates · Schedule of record: `data/underwriter-desk.db` read directly via SQL. Expected values are recomputed from raw rows independently of the resolver.

## Headline

Of **1676 fillable fields** across **17 accounts** (19 sheets), **733 filled correctly**, **943 correctly blank**, **0 missed**, **0 wrong**.

- **Fictional Seed Accounts** (17): 733 filled correct, 943 correctly blank, 0 missed, 0 wrong — Fill Rate 100.0%, Accuracy 100.0%.
- **Real ISC Accounts** (`acct-real-*`, 0 with policies): 0 filled correct, 0 correctly blank, 0 missed, 0 wrong — Fill Rate —, Accuracy —. 0 carry dec-verified schedules (writer + limits attached off the dec); the rest are unattached and audit as honest blanks.

- **Platform Fill Rate:** 100.0% (Filled Correct ÷ fields the schedule can back)
- **Platform Accuracy:** 100.0% (Filled Correct + Correctly Blank ÷ all fillable fields)
- **Static/Producer fields:** 228 verified against `brand.ts` (producer block, signature, render-time date)
- Correctly Blank includes 15 boxes printing the dec statement "Excluded" where the schedule is silent inside a backed section — the platform's blank-equivalent (claims nothing), per the accuracy contract in `src/lib/acord25.ts`.

## Scoreboard Per Account

| Sheet | Total Fields | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Static | Fill Rate | Accuracy |
|---|---|---|---|---|---|---|---|---|
| acct-apex | 91 | 37 | 42 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-beacon | 102 | 24 | 66 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-bright | 89 | 24 | 53 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-cedar | 97 | 34 | 51 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-craft | 94 | 26 | 56 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-greenleaf | 90 | 26 | 52 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-harbor | 101 | 34 | 55 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-ironclad | 95 | 40 | 43 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-lakeside | 96 | 33 | 51 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-meridian | 134 | 91 | 31 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-metro | 100 | 31 | 57 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-metro · ACORD 30 | 109 | 45 | 52 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-northstar | 100 | 41 | 47 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-northstar · ACORD 30 | 110 | 52 | 46 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-oakridge | 90 | 26 | 52 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-pixel | 102 | 24 | 66 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-redwood | 95 | 40 | 43 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-ridgeline | 118 | 81 | 25 | 0 | 0 | 12 | 100.0% | 100.0% |
| acct-summit | 91 | 24 | 55 | 0 | 0 | 12 | 100.0% | 100.0% |
| **Platform** | **1904** | **733** | **943** | **0** | **0** | **228** | **100.0%** | **100.0%** |

## Dec-Verified Sample Scorecard (Real Book + Hard Seeds)

The operator sample: every real account whose dec-page schedule is attached and writer-verified (`policies.issuing_carrier` set), plus two hard seeds — `acct-meridian` (6 policies / 4 carriers, overflow) and `acct-northstar` (garage, ACORD 25 + 30).

| Sheet | Account | Total | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Fill Rate | Accuracy |
|---|---|---|---|---|---|---|---|---|
| acct-meridian | Meridian Reach Marketing LLC | 134 | 91 | 31 | 0 | 0 | 100.0% | 100.0% |
| acct-northstar | Northstar Logistics Inc | 100 | 41 | 47 | 0 | 0 | 100.0% | 100.0% |
| acct-northstar · ACORD 30 | Northstar Logistics Inc | 110 | 52 | 46 | 0 | 0 | 100.0% | 100.0% |
| **Sample** | | **344** | **184** | **124** | **0** | **0** | **100.0%** | **100.0%** |

## Missed Fills And Wrong Values

None. Every field either matches its schedule source exactly or is correctly blank.

## Failure Modes (Numbered)

None observed on this DB state.

## Enforcement Controls (Synthetic Probes)

The live data carries no ISC excess line, so the carrier-knowledge gate never fires in the account audits — these synthetic probes prove the detectors and gates are live. A control failure is a critical finding.

| Control | Verdict | Detail |
|---|---|---|
| Registry Gate Fires On ISC Excess + Additional Insured | Pass | isc-excess-no-additional-insured |
| Registry Gate Silent On Kinsale Excess + Additional Insured | Pass | [no hit — correct] |
| Packet Rejects Forbidden AI On ISC Excess (And Blocks Issue) | Pass | rejects=[carrier-knowledge-isc-excess-no-additional-insured] okToIssue=false |
| Presend Registry Fails Carrier Knowledge — Override Refused | Pass | status=fail overridable=false |
| Wrong-Value Detector Flags A Tampered Limit | Pass | schedule $1,000,000 vs sheet $2,000,000 → mismatch detected |

- Snapshot digest determinism: every sheet built twice with the same injected clock produced identical digests (19 sheets).

## SQLite Spot Checks

Direct SQL against `data/underwriter-desk.db`, compared to the rendered sheet value — not trusting the lib end to end.

| Check | SQL Value | Sheet Value | Verdict |
|---|---|---|---|
| Ridgeline GL Each Occurrence | $1,000,000 | $1,000,000 | Match |
| Greenleaf Personal & Adv Injury (dec statement) | Included | Included | Match |
| Meridian Cyber Aggregate (overflow line) | $1,000,000 | $1,000,000 | Match |
| Apex Umbrella Each Occurrence | $5,000,000 | $5,000,000 | Match |
| Summit INSURER A NAIC (dec-page writer wins over ISC brand) | 25798 | 25798 | Match |
| Northstar Garagekeepers Comp/OTC LOC (ACORD 30) | LOC 1 | LOC 1 | Match |

- Ridgeline GL Each Occurrence: `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-ridgeline-gl' AND slot='gl_each_occurrence'`
- Greenleaf Personal & Adv Injury (dec statement): `SELECT mode FROM policy_limits WHERE policy_id='pol-greenleaf-bop' AND slot='gl_personal_adv'`
- Meridian Cyber Aggregate (overflow line): `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-meridian-eo' AND slot='cyber_aggregate'`
- Apex Umbrella Each Occurrence: `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-apex-umb' AND slot='umb_each_occurrence'`
- Summit INSURER A NAIC (dec-page writer wins over ISC brand): `SELECT issuing_carrier FROM policies WHERE id='pol-summit-gl' — Sutton National → NAIC 25798`
- Northstar Garagekeepers Comp/OTC LOC (ACORD 30): `SELECT loc FROM policy_limits WHERE policy_id='pol-northstar-gar' AND slot='gk_comp_otc'`

## Schedule Drift (FORM_SETS Vs SQLite)

None — the seeded `FORM_SETS` and the SQLite schedule tables agree row for row.

## Risk Notes

- **acct-apex** — one INSURED box, 2 named-insured spellings across its policies: "Apex Roofing LLC", "Apex Roofing, L.L.C.". The sheet prints the first policy's paper (KIN-GL-884201); the others' certs would read differently.
- **acct-northstar** — one INSURED box, 2 named-insured spellings across its policies: "North Star Freight LLC", "Northstar Logistics Inc". The sheet prints the first policy's paper (AMT-GAR-778302); the others' certs would read differently.

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

Same-day re-run. Previous pass: Fill Rate 100.0%, Accuracy 100.0%. This pass: Fill Rate 100.0%, Accuracy 100.0%.
