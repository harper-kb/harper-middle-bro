# Certificate Fill Audit — 2026-08-07

Auditor: cert-fill-auditor · Pipeline under test: `buildCertificatePacket` → `resolveCertSheet` (ACORD 25 2025/12; ACORD 30 2016/03 for garage accounts) · Schedule of record: `data/underwriter-desk.db` read directly via SQL. Expected values are recomputed from raw rows independently of the resolver.

## Headline

Of **1542 fillable fields** across **17 accounts** (19 sheets), **499 filled correctly**, **1043 correctly blank**, **0 missed**, **0 wrong**.

- **Platform Fill Rate:** 100.0% (Filled Correct ÷ fields the schedule can back)
- **Platform Accuracy:** 100.0% (Filled Correct + Correctly Blank ÷ all fillable fields)
- **Static/Producer fields:** 209 verified against `brand.ts` (producer block, signature, render-time date)
- Correctly Blank includes 16 boxes printing the dec statement "Excluded" where the schedule is silent inside a backed section — the platform's blank-equivalent (claims nothing), per the accuracy contract in `src/lib/acord25.ts`.

## Scoreboard Per Account

| Sheet | Total Fields | Filled Correct | Correctly Blank | Missed Fill | Wrong Value | Static | Fill Rate | Accuracy |
|---|---|---|---|---|---|---|---|---|
| acct-apex | 86 | 33 | 42 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-beacon | 87 | 11 | 65 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-bright | 83 | 10 | 62 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-cedar | 90 | 18 | 61 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-craft | 89 | 22 | 56 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-greenleaf | 85 | 22 | 52 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-harbor | 96 | 30 | 55 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-ironclad | 86 | 17 | 58 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-lakeside | 83 | 10 | 62 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-meridian | 129 | 87 | 31 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-metro | 83 | 9 | 63 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-metro · ACORD 30 | 94 | 9 | 74 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-northstar | 95 | 36 | 48 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-northstar · ACORD 30 | 100 | 42 | 47 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-oakridge | 83 | 10 | 62 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-pixel | 97 | 20 | 66 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-redwood | 86 | 17 | 58 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-ridgeline | 113 | 77 | 25 | 0 | 0 | 11 | 100.0% | 100.0% |
| acct-summit | 86 | 19 | 56 | 0 | 0 | 11 | 100.0% | 100.0% |
| **Platform** | **1751** | **499** | **1043** | **0** | **0** | **209** | **100.0%** | **100.0%** |

## Missed Fills And Wrong Values

None. Every field either matches its schedule source exactly or is correctly blank.

## SQLite Spot Checks

Direct SQL against `data/underwriter-desk.db`, compared to the rendered sheet value — not trusting the lib end to end.

| Check | SQL Value | Sheet Value | Verdict |
|---|---|---|---|
| Ridgeline GL Each Occurrence | $1,000,000 | $1,000,000 | Match |
| Greenleaf Personal & Adv Injury (dec statement) | Included | Included | Match |
| Meridian Cyber Aggregate (overflow line) | $1,000,000 | $1,000,000 | Match |
| Apex Umbrella Each Occurrence | $5,000,000 | $5,000,000 | Match |
| Northstar Garagekeepers Comp/OTC LOC (ACORD 30) | LOC 1 | LOC 1 | Match |

- Ridgeline GL Each Occurrence: `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-ridgeline-gl' AND slot='gl_each_occurrence'`
- Greenleaf Personal & Adv Injury (dec statement): `SELECT mode FROM policy_limits WHERE policy_id='pol-greenleaf-bop' AND slot='gl_personal_adv'`
- Meridian Cyber Aggregate (overflow line): `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-meridian-eo' AND slot='cyber_aggregate'`
- Apex Umbrella Each Occurrence: `SELECT amount_cents FROM policy_limits WHERE policy_id='pol-apex-umb' AND slot='umb_each_occurrence'`
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
- **acct-redwood** — 2 unscheduled policies (bare coverage codes, no limits on record): AMT-WC-910448, KIN-GL-910447. The sheet names them but prints no limits — correct (blank beats wrong), and a fill-rate ceiling until schedules land.

## Method And Definitions

- **Filled Correct** — the sheet value matches the schedule of record exactly (raw SQLite rows, or `naic.ts` registry for insurer identity).
- **Correctly Blank** — the schedule is silent and the field claims nothing (blank, unchecked, or the dec statement "Excluded" on a silent line inside a backed section).
- **Missed Fill** — the schedule has the value; the sheet left it blank (includes any scheduled limit that surfaces nowhere: section box, additional row, or description overflow).
- **Wrong Value** — the sheet shows something the schedule cannot back. Critical, automatic fail.
- **Static/Producer** — brand constants (producer block, signature, render-time DATE), verified against `src/lib/brand.ts` and the studio wiring.
- Fill Rate = Filled Correct ÷ (Filled Correct + Missed Fill). Accuracy = (Filled Correct + Correctly Blank) ÷ all fillable fields.
- Expected values are recomputed in this script from raw SQL rows (doctrine restated, not imported), so a resolver bug cannot vouch for itself. Holder fields use a fixed audit holder ("Audit Holder LLC") and are verbatim-carry checks.
- Deterministic: same DB state → same report. Run: `npx tsx scripts/cert-fill-audit.ts`.

## Trend

Same-day re-run. Previous pass: Fill Rate 100.0%, Accuracy 100.0%. This pass: Fill Rate 100.0%, Accuracy 100.0%.
