// ── THE SHARED COVERAGE-LINE VOCABULARY — the charting half, on its own ────────
// ONE definition of "what coverage line is this token", extracted from
// line-dispatch-rule.mjs (which re-exports every name below, so its callers are
// unchanged). It is its own module because the vocabulary has readers the gate's
// READ does not: the co-submit pairing fold (line-pairing.ts) charts a recorded
// token to the measured grain, and that module sits in the /actions client
// bundle's first-load graph. A bundler keeps a whole imported module for its
// side effects, so importing the gate rule there dragged the evidence SQL and
// the delta into the browser's critical path and broke the /actions JS budget
// (scripts/ci/check-actions-js-budget.mjs). Charting is pure vocabulary — no
// SQL, no verdicts, no labels — so it costs a reader only what it uses.
//
// Plain .mjs for the same reason the two rules it sits between are: a rerunnable
// measurement imports it on plain node, and the TS bundle reads it through
// allowJs — ONE rule, never a script copy.

import { normalizeLineCode } from "./line-retirement-rule.mjs";

// The REQUESTED-side aliases the backtest's normalization carries beyond the
// retirement vocabulary (compute.mjs CANON, verified against the frozen pull):
// the self-reported array is mostly bare product codes, with a measured tail
// of drifted spellings. An alias resolves BEFORE the shared normalizer so the
// gate scores exactly the lines the backtest scored.
//
// PROTOTYPE-LESS, the line-retirement-rule.mjs convention every table indexed by
// a recorded token follows: a lookup key here comes off a data feed, and on a
// plain object the miss resolves up the chain instead of to undefined.
const REQUEST_ALIASES = Object.assign(Object.create(null), {
  "W/C": "WC",
  "WORKERS COMP": "WC",
  PROF: "PL",
  "E&O": "PL",
  CP: "PROP",
  PROPERTY: "PROP",
  // The words Harper's own coverage-lines answer uses for PROP
  // (ask-harper/coverage-lines.ts) — an uncharted property request never
  // reached `blocking`, so the customer's property line could go out never.
  // This alias is a SEND-GATING change, not a display fix. A requested
  // "Commercial Property" used to normalize to the uncharted token
  // `commercial property` and sit in `unresolved`; it now charts to PROP, so
  // `lineDispatchDelta` files it under `missing` and
  // `buildLineDispatchGateInfo` puts it in `blocking` unless a package covers
  // it (line-dispatch-gate.ts:183, `!possiblyCovered`) — so the gate HOLDS the
  // send until that property line reaches a market.
  // It cuts both ways. The same charting applies to the REACHED legs, and the
  // `iq` leg is raw `coverage_types` display-name text, not an uppercased code
  // (the gate read's evidence SQL). A property line whose only evidence was an
  // instant row reading "Commercial Property" used to chart to nothing, so it
  // could not cover the request and the gate BLOCKED a line that had in fact
  // gone to market; it now reads reached-via-instant and the hold is released.
  // So: more holds where the customer's request never went out, fewer false
  // holds where it did — not "strictly more".
  // Pinned by tests/coverage-line-property-vocabulary.test.ts (both directions:
  // the full-name request that blocks, and the full-name reached leg that
  // releases).
  "COMMERCIAL PROPERTY": "PROP",
  COMM: "AUTO",
  SAM: "ABUSE",
  GAR: "GARAGE",
  SURETY: "BOND",
  "SURETY BONDS": "BOND",
  EXCESS: "UMB",
  "EXCESS LIABILITY": "UMB",
  PKG: "PKG",
  BOP: "BOP",
});

// PKG rides the satisfaction table (a package reaching the market covers its
// component lines) but is not in the retirement vocabulary — recognized here.
const EXTRA_KNOWN = new Set(["PKG", "BOP"]);

// ONE LINE, ONE CODE. The retirement vocabulary charts commercial auto twice
// (AUTO for "Commercial Auto", CA for the legacy "Commercial Auto (Liability)"
// product ref) and the gate's LINE_LABELS says both out loud as "Commercial Auto".
// Left unfolded, the two spellings of the SAME coverage line never match each
// other: an account whose brokered leg is coded CA reads as never having
// reached the market for an AUTO request, and a request carrying both spellings
// counts one line twice. The gate folds them; the retirement vocabulary keeps
// its own codes (its verdicts are pinned to core.product refs).
//
// THE FOLD MOVES THE REACHED SIDE, not just the state screen: a brokered leg
// coded CA now satisfies an AUTO request, so a submission the gate used to hold
// as "Commercial Auto never reached a market" reads reached. That widening is
// the fold's whole point (one line cannot disagree with itself), but it is a
// change to what this gate calls reached and is named as such in the build plan.
// It also means every PERSISTED gate line code — a standing
// team_actions.line_gate_overrides row, a take-back's URL param — must be read
// back through the SAME fold, or a line an operator already graduated keeps
// blocking (see foldStoredLineCode / storedLineCodeAliases in the gate rule).
//
// The fold table itself is exported because the PERSISTENCE side reads it too
// (foldStoredLineCode / storedLineCodeAliases, which stay with the gate: a
// stored line_code is the gate's own concern, not a charting reader's).
//
// PROTOTYPE-LESS for a sharper reason than the alias table above: `foldSameLine`
// is indexed by the UNCHARTED token too (normalizeLineCode lowercases what it
// cannot chart, and the fold runs on that), so on a plain object a recorded
// coverage token spelled `constructor` folded to Object.prototype's FUNCTION and
// `isChartedLineCode` then threw on `.toUpperCase()` — a TypeError out of
// `lineDispatchDelta`, i.e. the whole send gate down for that account.
export const SAME_LINE_FOLD = Object.assign(Object.create(null), { CA: "AUTO" });

/** @param {string | null} code @returns {string | null} */
export function foldSameLine(code) {
  if (code == null) return null;
  return SAME_LINE_FOLD[code] ?? code;
}

// Normalize one requested/reached token to the canonical line code.
// Returns:  a KNOWN code (gateable) · a lowercased unknown token (real but
// uncharted — surfaces as UNRESOLVED, never silently passed and never blindly
// gated) · null (generic/empty — not a scoreable line).
/** @param {string | null | undefined} raw @returns {string | null} */
export function normalizeGateLine(raw) {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const upper = t.toUpperCase().replace(/\s+/g, " ");
  const aliased = REQUEST_ALIASES[upper];
  if (aliased) return aliased;
  if (EXTRA_KNOWN.has(upper)) return upper;
  return foldSameLine(normalizeLineCode(t));
}

// A code the shared vocabulary charts (uppercase = charted; the normalizer
// lowercases anything it cannot chart).
//
// KNOWN LIMIT, named at the one caller that cannot live with it
// (splitCompoundLine's `namesALine`): a token with no cased letter — an opaque
// numeric coverage code, a limits fragment — is uppercase-identical to itself
// without being a line, so this reads it as charted. Widening the predicate
// itself moves the send gate for every reader (such a token then files under
// `missing`, not `unresolved`), which is its own change with its own
// before/after; REVIEW_NOTES.md carries it.
/** @param {string | null} code @returns {boolean} */
export function isChartedLineCode(code) {
  return code != null && code === code.toUpperCase();
}
