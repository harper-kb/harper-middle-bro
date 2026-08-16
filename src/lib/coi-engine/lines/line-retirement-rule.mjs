// ── PER-COVERAGE-LINE RETIREMENT — the pure primitives ────────────────────────
// DR's ruling, 2026-07-06 11:25 AM PT, verbatim: "Just retire it by line, and
// can you just flag this in FDO, what we ended up landing with and why? Just
// using the example of the multi-account one."
//
// This file is plain .mjs ON PURPOSE (the quote-exists.mjs precedent): the TS
// server bundle imports it through src/lib/submissions/line-retirement.ts
// (allowJs), and the rerunnable measurement script
// (scripts/measure-line-retirement.mjs) imports it directly on plain node —
// ONE rule, never a script copy. The narrative header (the ruling, the
// collision with the coverage-line completeness law, the diagnosed quote→line
// mapping) lives in line-retirement.ts.

// The canonical line-code vocabulary is core.product.external_ref. Full names
// (either side's) normalize into it; unknown labeled lines normalize to their
// own lowercased token so they only ever match themselves — a quote clearly
// labeled for some line we don't chart must never hold an unrelated line
// hostage, and must never retire one either.
//
// Every lookup table here is indexed by an attacker-influenced token, so all of
// them are PROTOTYPE-LESS: on a plain object `NAME_TO_CODE["constructor"]`
// resolves up the chain to a function, and that non-string would escape
// normalizeLineCode() into the charted-line checks that call .toUpperCase().
const NAME_TO_CODE = Object.assign(Object.create(null), {
  "general liability": "GL",
  "professional liability": "PL",
  "professional liability/errors & omissions": "PL",
  "workers compensation": "WC",
  "workers' compensation": "WC",
  "workers comp": "WC",
  property: "PROP",
  umbrella: "UMB",
  // The umbrella line written in FULL WORDS (feedback plane #2783, "Coverage line
  // removed: Umb — Umb. Why: remove the umb" — the fourth `Umb` removal). The three
  // arrivals before it each closed a CERTIFICATE-plane reader of the bare code
  // (#2045 the fold and the card, #2046 the sibling merge, #2460 the compound
  // cell); this vocabulary knew the line by the single word above, so the ACORD 25
  // section's own name (`Umbrella Liability`, the label coi-data and prior-formats
  // speak) and the bound book's own spelling (`Commercial Umbrella`,
  // renewal-checklist's measured deals_v2 alias list) normalized to themselves —
  // one coverage line under two identities that could never match (#1153). It cost
  // the ask's sentence on five readers that all chart through here: the review
  // panel offered the SAME line twice (dedupeRequestedLines kept both spellings and
  // the stored-email widen added the second, against the promise its own comment
  // makes), the co-submit read could not reach the measured GL × umbrella row, a
  // quote answering the line never retired its card, and splitCompoundLine could not
  // part `Umbrella Liability/Cargo` — so #2460's own removal still took the cargo
  // half off a customer's certificate. COMPACT_NAME_TO_CODE is derived from these
  // rows, so the solid and hyphenated spellings come with them (`UmbrellaLiability`,
  // `Commercial-Umbrella`) and there is no second anchor to keep in step.
  // A GATING change, not only a display fix, named as such the way the COMMERCIAL
  // PROPERTY alias is: a requested line spelled this way now files under `missing`
  // and HOLDS the send until it reaches a market, and a reached leg spelled this way
  // now RELEASES a hold it used to cause.
  "umbrella liability": "UMB",
  "commercial umbrella": "UMB",
  "business owners policy": "BOP",
  // The package written WITHOUT the generic noun (feedback plane #2738,
  // "Coverage line removed: BOP — BOP. Why: no prop" — the third BOP removal whose
  // reason is the property half). Three planes already chart these two words as
  // this package — certificateLineSection's own rung (#1818), renewal-checklist's
  // alias list, line-pairing — while the SHARED vocabulary the package-fairness
  // table is read through did not, so `Businessowners` normalized to itself and
  // packageCarriedLines / packageComponentOverlaps / withPackageSatisfaction saw
  // no package at all: the ACORD 140 rode out on a send whose package the operator
  // had just unchecked (#2341's ruling), the "already carries Property" card note
  // stayed silent (#2024's), and the gate claimed GL and Property missing on an
  // account that carries both. COMPACT_NAME_TO_CODE is derived from this row, so
  // the separator spellings (`Businessowners`, `Business-Owners`, both
  // possessives) come with it and there is no second anchor to keep in step.
  // A GATING change, not only a display fix, and named as such the way the
  // COMMERCIAL PROPERTY alias is: a reached leg spelled this way now covers a BOP
  // request, and a requested one now files under `missing` rather than
  // `unresolved` — answered by a reached package or a reached GL + Property pair.
  "business owners": "BOP",
  "garage liability": "GARAGE",
  "cyber liability": "CYBER",
  "liquor liability": "LIQ",
  "commercial auto": "AUTO",
  "commercial auto (liability)": "CA",
  "abuse & molestation": "ABUSE",
  "abuse and molestation": "ABUSE",
  "inland marine": "IM",
  "hired & non-owned auto": "HNOA",
  "hired and non-owned auto": "HNOA",
  "surety bond": "BOND",
  // The space-free product code the send surfaces carry ("SuretyBond" — the
  // spelling feedback plane item 1151 arrived in). Charted HERE, not in the
  // dispatch gate's own alias table, because normalizeGateLine delegates to
  // this vocabulary: one row, and both the gate and the retirement read stop
  // filing the line as an uncharted token that matches only itself.
  suretybond: "BOND",
  "employment practices liability": "EPL",
  "directors & officers": "DO",
  "product liability": "PROD",
  cargo: "CARGO",
  "technology errors & omissions": "TECH_EO",
  "event liability": "EVENT",
  "group health": "GH",
});

// Code drift between the two sides, folded to the product vocabulary
// (insurance.quote coverage elements say EPLI where core.product says EPL —
// diagnosed live 2026-07-06). The Abuse & Molestation line carries the same
// drift the other way: core.product.external_ref is 'AM' (the code the intent
// spine stamps as coverageLineCode) while the display name normalizes to
// 'ABUSE', so without the fold an 'AM'-coded item never matches a quote
// labeled by name and the answered line is never removed (the
// coverage-line-removed heal, 2026-07-22).
//
// AM is confirmed Abuse & Molestation and nothing else: the core.product
// directory mirror (compose/seed/insurance-twin/01_directory.sql:15) carries
// (707, 'AM', 'Abuse & Molestation') and no other row there carries 'AM'. The
// fold is structurally narrow — normalizeLineCode upper-cases and maps spaces
// to '_', so only the literal code 'AM'/'am' can reach this alias.
const CODE_ALIASES = Object.assign(Object.create(null), { EPLI: "EPL", AM: "ABUSE" });

// The GENERIC markers: a quote element wearing one of these is a live quote
// whose line CANNOT be attributed — it holds every line (ambiguity), it
// retires none. "OTHER" is generic on BOTH sides (an OTHER-line item can only
// ever be held, never auto-retired).
const GENERIC_MARKERS = new Set(["other", "package policy", ""]);

// The charted names with every separator squeezed out, DERIVED from the table
// above (never a second vocabulary). The live self-reported code array and the
// product external_refs also carry a charted line's name written solid —
// `SuretyBond`, which lineDispatchEvidenceSql uppercases to `SURETYBOND` — and
// without this fold that spelling normalized to its own uncharted token while
// "Surety Bond" / "SURETY" normalized to BOND, so ONE coverage line reached the
// gate and the retirement read under two identities that could never match
// (feedback plane #1153).
const COMPACT_NAME_TO_CODE = Object.assign(
  Object.create(null),
  Object.fromEntries(
    Object.entries(NAME_TO_CODE).map(([name, code]) => [name.replace(/[^a-z0-9]/g, ""), code]),
  ),
);

// The known product codes (so a bare code passes through as itself).
const KNOWN_CODES = new Set([
  "GL", "PL", "WC", "PROP", "UMB", "BOP", "GARAGE", "CYBER", "LIQ", "AUTO",
  "CA", "ABUSE", "IM", "HNOA", "BOND", "EPL", "DO", "PROD", "CARGO",
  "TECH_EO", "EVENT", "GH",
]);

// Normalize a line label (a quote coverage_type, a PCO coverage_code, a
// product name, or a product external_ref) to the canonical code. Null means
// GENERIC/UNATTRIBUTABLE — on the quote side that is the ambiguity signal; on
// the requested side it means the line can be held but never auto-retired.
/** @param {string | null | undefined} raw @returns {string | null} */
export function normalizeLineCode(raw) {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase().replace(/\s+/g, " ");
  if (GENERIC_MARKERS.has(lower)) return null;
  const named = NAME_TO_CODE[lower];
  if (named) return named;
  const upper = t.toUpperCase().replace(/\s+/g, "_");
  const aliased = CODE_ALIASES[upper] ?? upper;
  if (KNOWN_CODES.has(aliased)) return aliased;
  // Tried LAST, after every existing rung, so no already-charted token can
  // shift onto this path — only a spelling that would otherwise fall through
  // uncharted can be recovered here.
  const compact = COMPACT_NAME_TO_CODE[lower.replace(/[^a-z0-9]/g, "")];
  if (compact) return compact;
  // A labeled line outside the charted vocabulary: itself, lowercased — it
  // matches only its own kind, and it never manufactures ambiguity.
  return lower;
}

/**
 * @typedef {{ attributed: Set<string>, unattributed: number }} CompanyQuoteLines
 * @typedef {"retire" | "ambiguous-hold" | "stand"} LineRetirementVerdict
 */

// The per-line verdict. `lineCode` is the ITEM's requested line (normalized;
// null = the item's own line is unlabeled/generic).
/** @param {string | null} lineCode @param {CompanyQuoteLines | undefined} quotes @returns {LineRetirementVerdict} */
export function lineRetirementVerdict(lineCode, quotes) {
  if (!quotes || (quotes.attributed.size === 0 && quotes.unattributed === 0)) return "stand";
  if (lineCode != null && quotes.attributed.has(lineCode)) return "retire";
  // A live quote exists that we cannot tie to a line (or the item's own line
  // is unlabeled): the line MIGHT be answered — but the completeness law says
  // never silently drop a line that may still need to go out. HOLD, stated.
  if (quotes.unattributed > 0 || lineCode == null) return "ambiguous-hold";
  // Quotes exist but every one is attributed to OTHER lines: this line has
  // not been answered — the multi-line survivor. The card stands untouched.
  return "stand";
}

// The COMPANY-grain verdict, for rows that card one item for the whole
// account (the legacy pre-send fallback, the stuck-aging emitter): retire
// only when the row names at least one line and EVERY named line retires —
// a partially-quoted account's card stands (its remaining work is real), and
// any ambiguity holds the whole row.
/** @param {Array<string | null>} lineCodes @param {CompanyQuoteLines | undefined} quotes @returns {LineRetirementVerdict} */
export function companyRetirementVerdict(lineCodes, quotes) {
  if (!quotes || (quotes.attributed.size === 0 && quotes.unattributed === 0)) return "stand";
  if (!lineCodes.length) return "ambiguous-hold";
  const verdicts = lineCodes.map((c) => lineRetirementVerdict(c, quotes));
  if (verdicts.every((v) => v === "retire")) return "retire";
  if (verdicts.some((v) => v === "ambiguous-hold")) return "ambiguous-hold";
  return "stand";
}

// Fold the read's rows into the per-company evidence map.
/** @param {Array<{ cid?: string | null, line_raw?: string | null }>} rows @returns {Map<string, CompanyQuoteLines>} */
export function foldQuotedLineRows(rows) {
  const by = new Map();
  for (const r of rows) {
    const cid = (r.cid ?? "").trim();
    if (!cid) continue;
    const entry = by.get(cid) ?? { attributed: new Set(), unattributed: 0 };
    const code = normalizeLineCode(r.line_raw);
    if (code == null) entry.unattributed += 1;
    else entry.attributed.add(code);
    by.set(cid, entry);
  }
  return by;
}

// The screened-residual reason (the junk-gate convention: a retired row is a
// visible count, never a silent vanish) and the held class's card note.
export const LINE_RETIRED_REASON = "line_quoted_retired";
export const AMBIGUOUS_HOLD_NOTE =
  "A quote is back for this account but not clearly for this line — the line stays here until that's certain.";
// The sibling chip's honest status for a retired line (the surviving WC card
// still shows the GL sibling — as answered, not as pending work).
export const RETIRED_SIBLING_STATUS = "quoted";

// ── The one set-based read (both bridges, line-attributed) ─────────────────────
// Deliberately SEMI-JOINED against the deduped pre-send company set (trap #20:
// insurance.quote has no account_id index — a correlated per-row probe blows
// the gateway budget; this is the accountQuoteExistsCteSql shape with the
// coverage elements unnested). A live quote with NO coverage array emits one
// NULL-line row (the LEFT JOIN LATERAL over the empty-array CASE), so
// unattributed quotes are VISIBLE as the ambiguity signal, never dropped.
// Statuses excluded are the one QUOTE_DEAD_STATUSES literal (quote-exists.mjs
// — the caller passes it so one literal governs lane-wide).
/** @param {string[]} companyIds @param {string} deadStatuses @returns {string} */
export function preSendQuotedLinesSql(companyIds, deadStatuses) {
  const inList = companyIds.map((id) => `'${String(id).replace(/'/g, "")}'`).join(",");
  return `
  SELECT DISTINCT t.cid, t.line_raw FROM (
    SELECT lr_bca.company_id::text AS cid, lr_cov.cov ->> 'coverage_type' AS line_raw
    FROM backwards_compatibility.company_account lr_bca
    JOIN insurance.quote lr_q ON lr_q.account_id = lr_bca.account_id
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(to_jsonb(lr_q) -> 'coverage') = 'array'
           THEN to_jsonb(lr_q) -> 'coverage' ELSE '[]'::jsonb END
    ) lr_cov(cov) ON true
    WHERE lr_bca.company_id::text IN (${inList})
      AND lower(coalesce(lr_q.status,'')) NOT IN ${deadStatuses}
    UNION ALL
    SELECT lr_pco.company_id::text AS cid, lr_pco.coverage_code AS line_raw
    FROM public.placement_coverage_opportunities lr_pco
    LEFT JOIN insurance.quote lr_pq ON lr_pq.id::text = lr_pco.quote_id::text
    WHERE lr_pco.company_id::text IN (${inList})
      AND ((lr_pco.quote_id IS NOT NULL
            AND (lr_pq.id IS NULL OR lower(coalesce(lr_pq.status,'')) NOT IN ${deadStatuses}))
           OR lower(coalesce(lr_pco.quote_status,'')) = 'quoted')
  ) t
  LIMIT 1000
`;
}

// The loader reads the evidence in COMPANY CHUNKS of this size (the pre-push
// Bugbot's truncation catch): the read caps at the gateway's 1,000 rows, and
// a silently-truncated slice would leave some companies' quote evidence
// unread — those cards would STAND un-retired (the safe direction, but a
// quiet one). Chunking keeps every slice far under the cap; a chunk that
// still fills it is surfaced as a named partial, never swallowed.
export const QUOTED_LINES_CHUNK = 200;
