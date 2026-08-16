// ── THE DISPATCH-TIME COVERAGE-LINE GATE — the pure primitives ────────────────
// DR's go, 2026-07-07 (the coverage-line drop, super-backtested first): a
// submission cannot read "sent" / complete while a coverage line the CUSTOMER
// asked for (insurance.submission.coverage_self_reported_codes_json — the
// self-reported set, never the system's recommended codes and never
// companies.insurance_types) has neither a brokered dispatch (a
// placement_coverage_opportunities row) nor an instant-quote leg
// (instant_quote_data_labelling).
//
// THE MEASURED PROBLEM (the frozen backtest, DR/datasets/coverage-line-backtest,
// matured Jan–May 2026 cohort, 3,279 multi-line companies): 63% of dispatched
// multi-line accounts had at least one requested line that never reached ANY
// market, ~$893K estimated Harper revenue on never-sent lines in the window —
// and a dropped line never goes out late (8 late dispatches in 3,279). It
// never goes. This gate makes the drop impossible to read past at the exact
// seam the backtest located: submission → dispatch.
//
// This file is plain .mjs ON PURPOSE (the line-retirement-rule.mjs precedent):
// the TS server bundle imports it through line-dispatch-gate.ts (allowJs), and
// a rerunnable measurement can import it directly on plain node — ONE rule,
// never a script copy.

import { isChartedLineCode, normalizeGateLine, SAME_LINE_FOLD } from "./line-vocabulary.mjs";

// THE CHARTING HALF lives in ./line-vocabulary.mjs and is re-exported here, so
// every existing caller of this module keeps its import. It is a separate module
// because the pairing fold needs charting inside the /actions client bundle and
// must not carry this file's evidence read with it (the JS budget).
export { foldSameLine, isChartedLineCode, normalizeGateLine } from "./line-vocabulary.mjs";

// A stored/param gate code read back through the fold — persisted rows predate
// it, so the legacy spelling still has to match the code the gate now emits.
/** @param {string | null | undefined} raw @returns {string} */
export function foldStoredLineCode(raw) {
  const upper = (raw ?? "").trim().toUpperCase();
  return SAME_LINE_FOLD[upper] ?? upper;
}

// Every stored spelling that folds to `code` (the folded code plus each legacy
// spelling collapsed into it) — a WRITE keyed on line_code must reach them all.
/** @param {string | null | undefined} code @returns {string[]} */
export function storedLineCodeAliases(code) {
  const folded = foldStoredLineCode(code);
  const legacy = Object.keys(SAME_LINE_FOLD).filter((k) => SAME_LINE_FOLD[k] === folded && k !== folded);
  return [folded, ...legacy];
}

// THE AMBIGUOUS "CA" (DR's ruling, 2026-07-16, on the live used-car-dealer
// card: he read "CA + GL $1M/$2M requested" as COMMERCIAL AUTO on a car
// dealership — it was California). That ruling landed in the checker's
// PRESENTATION seam (src/lib/submissions/checker-vocab.ts) and the ambiguity
// recurred here, where the product decides what a coverage LINE is: a bare CA
// in the customer's self-reported set became a charted line named "Commercial
// Auto", and the pre-send check then claimed it "was requested at intake" —
// feedback item #1126, an operator deleting the line because there is no
// commercial auto anywhere on the custom intake form.
//
// CA is the ONLY collision between the US state/territory codes and the
// charted line vocabulary, and it is only ever a line code as the legacy
// product ref — commercial auto arrives on the REQUESTED side written in words
// or as AUTO, both of which still chart. So on the requested side a bare state
// code is screened off exactly like FEE/OTHER (never a scoreable line, and not
// surfaced as an uncharted one either: naming "CA" on a card is the ambiguity
// DR ruled out). The REACHED side keeps normalizeGateLine — its tokens are
// product refs off a dispatch record, where CA really is commercial auto.
const STATE_AMBIGUOUS_CODES = new Set(["CA"]);

/** @param {string | null | undefined} raw @returns {string | null} */
export function normalizeRequestedLine(raw) {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (STATE_AMBIGUOUS_CODES.has(t.toUpperCase())) return null;
  return normalizeGateLine(t);
}

// The plain-English label for a charted code — the card speaks service
// vocabulary, never a bare code soup.
//
// PROTOTYPE-LESS: `lineLabel` looks this up with a RAW data-feed token as well as
// a charted code (see below), so on a plain object `lineLabel("constructor")`
// returned Object.prototype's FUNCTION as the label a card would render.
const LINE_LABELS = Object.assign(Object.create(null), {
  GL: "General Liability",
  PL: "Professional Liability",
  WC: "Workers' Comp",
  PROP: "Property",
  UMB: "Umbrella / Excess",
  BOP: "Business Owners Policy",
  PKG: "Package",
  GARAGE: "Garage Liability",
  CYBER: "Cyber",
  LIQ: "Liquor Liability",
  AUTO: "Commercial Auto",
  CA: "Commercial Auto",
  ABUSE: "Abuse & Molestation",
  IM: "Inland Marine",
  HNOA: "Hired & Non-Owned Auto",
  BOND: "Surety Bond",
  EPL: "Employment Practices",
  DO: "Directors & Officers",
  PROD: "Product Liability",
  CARGO: "Motor Truck Cargo",
  TECH_EO: "Tech E&O",
  EVENT: "Event Liability",
  GH: "Group Health",
});
/** @param {string} code @returns {string} */
export function lineLabel(code) {
  const direct = LINE_LABELS[code];
  if (direct) return direct;
  // A caller can hand this a RAW token off a data feed ("Prop", "prop", "CP",
  // "workers comp") rather than a canonical code — the loader stamps bare
  // product codes onto the IQ-labeling and legacy-submission spines. Chart it
  // through the shared normalizer before the lookup so the label half of a
  // `code — label` render is never the code echoed back ("Prop — Prop", ask
  // #997). A token the vocabulary cannot chart stays itself — never a guess.
  const charted = normalizeGateLine(code);
  return (charted != null && LINE_LABELS[charted]) || code;
}

// Is this token the record carrying a BARE product code, as opposed to the
// operator's own words for the line?
//
// Whitespace is the estate's existing tell (native-dispatch's
// coverageLineLabel): prose carries more than the code and rides verbatim.
// Punctuated shorthand — "E&O", "D&O", "W/C" — is ALSO the record's own words:
// the card names such a line as `E&O (Professional Liability)`, so the token has
// to survive next to the charted name for the two halves to read as one line
// (ask #1129). What expands is the purely alphabetic code the operator cannot
// read as words: PROP, GL, WC, CP.
/** @param {string} token @returns {boolean} */
function isBareLineCode(token) {
  return /^[A-Za-z]+$/.test(token.trim());
}

// The words a DISPLAY surface should speak for one recorded coverage token: a
// bare charted code expands to the operator label, anything else passes through
// byte-for-byte. Display-only — the raw token stays the data (ask #997).
/** @param {string} token @returns {string} */
export function displayLineToken(token) {
  if (!isBareLineCode(token)) return token;
  const code = normalizeGateLine(token);
  return code != null && isChartedLineCode(code) ? lineLabel(code) : token;
}

// One recorded coverage token split into the lines it NAMES. A packet regularly
// covers several lines under one subject and this estate spells that with a
// slash — the subject shape is `<insured> | CA GL/WC Risk` (verified live
// 2026-07-09 on the packet widen, one GL section and one WC section under a
// single subject; the same convention as `<insured> | MA Prop/GL Risk`). No
// insured is named here on purpose: the packet is identified by its date and
// failure mode, never by the customer. So a loader that knows only commas and
// plusses handed the pair over as one token the vocabulary cannot name, and the
// co-submit measurement could not reach it (plane #1260, "garage and GL
// together?").
//
// A slash is ALSO inside single lines, which is why nothing splits unless the
// vocabulary can read the halves as DIFFERENT charted lines and cannot read the
// whole: "W/C" and "Professional Liability/Errors & Omissions" each chart whole,
// "Umbrella/Excess Liability" is two halves on ONE code, and an uncharted half
// ("Comp/OTC") is never claimed to be two lines. Raw tokens out — the gates
// normalize those themselves.
//
// "Charted" has to mean NAMES A LINE here, which is stricter than
// isChartedLineCode: that predicate reads uppercase-identity as the tell, and a
// token with no cased letter is uppercase-identical without being a coverage
// line at all. So the limits fragment in "GL/1000" passed as a charted half and
// this split INVENTED the line "1000" — a send checkbox and a gate hold for
// something the vocabulary never charted. Every declared product code carries
// A-Z, so requiring one cannot cost a real line its split.
/** @param {string | null} code @returns {boolean} */
const namesALine = (code) => isChartedLineCode(code) && /[A-Z]/.test(code);

/** @param {string | null | undefined} raw @returns {string[]} */
export function splitCompoundLine(raw) {
  const token = (raw ?? "").trim();
  if (!token) return [];
  if (!token.includes("/")) return [token];
  if (namesALine(normalizeGateLine(token))) return [token];
  const parts = token.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [token];
  const codes = parts.map((p) => normalizeGateLine(p));
  if (!codes.every((c) => namesALine(c))) return [token];
  return new Set(codes).size === codes.length ? parts : [token];
}

// ONE LINE, ONE ENTRY. A recorded coverage column names the same line twice —
// the token repeated ("E&O, E&O"), or a code beside another charted spelling of
// itself ("PROF + E&O", "Umbrella, Excess Liability") — and the requested set is
// a LIST OF LINES, so the second entry is not a second line: it is one line said
// twice, on every reader that speaks the set (the card's classified-as sentence,
// the send panel's per-line boxes, the coded checker's per-line document rules,
// the packet widen's length compare, which a duplicate can make suppress a line
// the email really adds). Feedback plane #1538: "Coverage line removed: E&O —
// E&O. Why: two e&o??" — the operator removing one of the two by hand.
//
// The count of DISTINCT lines never changes, so this is not the narrowing
// submissions.intake-coverage-precedence reserves for a human: the same doctrine
// as SAME_LINE_FOLD ("a request carrying both spellings counts one line twice").
//
// The requested-side normalizer decides, never a fold of our own: two tokens
// collapse only where the shared vocabulary charts them as ONE line, so a
// spelling it cannot chart ("Errors and Omissions") keys on its own words and
// stays its own entry rather than being guessed onto PL, and the bare state code
// the requested side screens off ("CA" is California here) keys on its own words
// too — California can fold onto nothing. The record's FIRST spelling and its
// order survive: those words are what the subject builder and the email sections
// speak (ask #997).
/** @param {Iterable<string | null | undefined>} raws @returns {string[]} */
export function dedupeRequestedLines(raws) {
  const out = [];
  const seen = new Set();
  for (const raw of raws) {
    const token = (raw ?? "").trim();
    if (!token) continue;
    const key = normalizeRequestedLine(token) ?? token.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/**
 * @typedef {{ requestedRaw: string[], reachedBrokered: string[], reachedInstant: string[] }} CompanyLineEvidence
 * @typedef {{ code: string, label: string, via: "brokered" | "instant" | "package" }} ReachedLine
 * @typedef {{ code: string, label: string, possiblyCovered: boolean }} MissingLine
 * @typedef {{ reached: ReachedLine[], missing: MissingLine[], unresolved: string[], multiLine: boolean }} LineDispatchDelta
 */

// Fold the chunked read's rows into per-company evidence. Row kinds:
//   req — one self-reported code element (already uppercased by the SQL)
//   pco — one brokered PCO coverage_code
//   iq  — one instant row's coverage_types string (comma-joined display names)
/** @param {Array<{ cid?: string | null, kind?: string | null, val?: string | null }>} rows @returns {Map<string, CompanyLineEvidence>} */
export function foldLineDispatchRows(rows) {
  const by = new Map();
  for (const r of rows) {
    const cid = (r.cid ?? "").trim();
    if (!cid) continue;
    const entry = by.get(cid) ?? { requestedRaw: [], reachedBrokered: [], reachedInstant: [] };
    const val = (r.val ?? "").trim();
    if (val) {
      if (r.kind === "req") entry.requestedRaw.push(val);
      else if (r.kind === "pco") entry.reachedBrokered.push(val);
      else if (r.kind === "iq") for (const part of val.split(",")) entry.reachedInstant.push(part.trim());
    }
    by.set(cid, entry);
  }
  return by;
}

// The delta — the whole gate as one pure function. `satisfactionRows` is the
// playbook's package-fairness table (each row: when = comma list, ALL of which
// must be reached; satisfies = comma list of codes then covered), and
// `nonScoreable` screens FEE/OTHER-class tokens off the requested set (the
// backtest's own exclusion — those are never scoreable lines).
/**
 * @param {CompanyLineEvidence} evidence
 * @param {{ satisfactionRows: Array<{ when: string, satisfies: string }>, nonScoreable: RegExp }} rules
 * @returns {LineDispatchDelta}
 */
export function lineDispatchDelta(evidence, rules) {
  const unresolved = [];
  /** @type {Set<string>} */
  const requested = new Set();
  for (const raw of evidence.requestedRaw) {
    if (rules.nonScoreable.test(raw.trim())) continue;
    const code = normalizeRequestedLine(raw);
    if (code == null) continue; // generic marker — not a scoreable line (the backtest's rule)
    if (!isChartedLineCode(code)) {
      // Real but uncharted: SURFACED as unresolved, never silently passed —
      // and never blindly gated either (we cannot verify a line we cannot
      // chart; the card states the limit).
      if (!unresolved.includes(raw.trim())) unresolved.push(raw.trim());
      continue;
    }
    requested.add(code);
  }

  /** @type {Map<string, "brokered" | "instant">} */
  const reachedVia = new Map();
  let unattributedReached = 0;
  for (const raw of evidence.reachedBrokered) {
    const code = normalizeGateLine(raw);
    if (code == null) unattributedReached += 1;
    else if (isChartedLineCode(code) && !reachedVia.has(code)) reachedVia.set(code, "brokered");
  }
  for (const raw of evidence.reachedInstant) {
    const code = normalizeGateLine(raw);
    if (code == null) unattributedReached += 1;
    else if (isChartedLineCode(code) && !reachedVia.has(code)) reachedVia.set(code, "instant");
  }

  // The package-fairness pass (the backtest's satisfaction rules, as playbook
  // data): a package that reached the market covers its component lines.
  /** @type {Map<string, "package">} */
  const satisfiedByPackage = new Map();
  for (const row of rules.satisfactionRows) {
    const when = String(row.when ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    const satisfies = String(row.satisfies ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    if (!when.length || !satisfies.length) continue;
    if (when.every((c) => reachedVia.has(c))) {
      for (const c of satisfies) if (!reachedVia.has(c)) satisfiedByPackage.set(c, "package");
    }
  }

  const reached = [];
  const missing = [];
  for (const code of [...requested].sort()) {
    const via = reachedVia.get(code) ?? satisfiedByPackage.get(code);
    if (via) reached.push({ code, label: lineLabel(code), via });
    else {
      // A dispatch we could not tie to any line (a coverage-less quote, a
      // generic package marker) means this line MIGHT have gone out — the
      // honest read holds the claim both ways: the line surfaces as missing,
      // but flagged possibly-covered, and it never hard-gates the stage.
      missing.push({ code, label: lineLabel(code), possiblyCovered: unattributedReached > 0 });
    }
  }
  return { reached, missing, unresolved, multiLine: requested.size + unresolved.length >= 2 };
}

// ── The one set-based read (requested + both reached legs, chunked) ───────────
// UNION discipline: every leg emits (cid text, kind text, val text). The
// requested leg reads the customer's OWN codes off the submission rows inside
// the lookback; the PCO leg is the brokered dispatch record; the instant leg
// is the instant lane's coverage strings. Semi-joined against the company
// chunk (trap #20 — never per-row probes), capped inside the gateway page.
/** @param {string[]} companyIds @param {number} lookbackDays @returns {string} */
export function lineDispatchEvidenceSql(companyIds, lookbackDays) {
  // Company ids are digit strings from our own rows — anything else is
  // stripped whole (tighter than the retirement read's quote-strip: no
  // character that could read as SQL survives into the literal).
  const inList = companyIds.map((id) => `'${String(id).replace(/[^A-Za-z0-9_-]/g, "")}'`).join(",");
  const days = Math.max(1, Math.round(lookbackDays));
  return `
  SELECT DISTINCT t.cid, t.kind, t.val FROM (
    SELECT ldg_s.company_id::text AS cid, 'req' AS kind, upper(ldg_code.c) AS val
    FROM insurance.submission ldg_s,
         jsonb_array_elements_text(ldg_s.coverage_self_reported_codes_json::jsonb) ldg_code(c)
    WHERE ldg_s.company_id::text IN (${inList})
      AND ldg_s.coverage_self_reported_codes_json IS NOT NULL
      AND ldg_s.created_at >= now() - interval '${days} days'
    UNION ALL
    SELECT ldg_p.company_id::text AS cid, 'pco' AS kind, upper(ldg_p.coverage_code) AS val
    FROM public.placement_coverage_opportunities ldg_p
    WHERE ldg_p.company_id::text IN (${inList})
      AND ldg_p.coverage_code IS NOT NULL
    UNION ALL
    SELECT ldg_i.company_id::text AS cid, 'iq' AS kind, ldg_i.coverage_types AS val
    FROM public.instant_quote_data_labelling ldg_i
    WHERE ldg_i.company_id::text IN (${inList})
      AND ldg_i.coverage_types IS NOT NULL
  ) t
  LIMIT 1000
`;
}

// The chunk size (the line-retirement precedent): far under the gateway's
// 1,000-row page so a slice can never silently truncate a company's evidence.
// Requested + reached rows per company run larger than the retirement read's
// (three legs), so the chunk is deliberately small — the live measurement
// (2026-07-07, 7d cohort) read ~3.5 rows/company, so 60 companies sit ~5x
// under the cap; the loader ALSO refuses to fold a chunk that filled the
// page (partial evidence could false-gate a line that actually went out).
export const LINE_DISPATCH_CHUNK = 60;
