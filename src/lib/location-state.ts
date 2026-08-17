/**
 * Location State axis for the Accounts views — the company/account's U.S.
 * location state (`companies.company_state` → normalized at refresh time →
 * `accounts.state`), the same value every collapsed account row displays.
 * This is the account's main location, not a per-order risk address, and it
 * is entirely distinct from the order lifecycle state (Pending/Bound/Lost)
 * the records pages are named after.
 *
 * Canonical identity: the two-letter USPS code. The live book stores a mix
 * of codes and full names ("FL" and "Florida" both appear on eligible
 * companies — verified), so the one normalizer below is shared by the book
 * refresh (write side) and the filter (read side). Missing and invalid
 * values are a real, explicit bucket ("Unknown / Not set"), never silently
 * grouped under a real state.
 */

export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
  // Territories: none in the current book (verified live), but a 2-letter
  // code passes the normalizer through, so they are first-class if they land.
  PR: "Puerto Rico", VI: "U.S. Virgin Islands", GU: "Guam",
  AS: "American Samoa", MP: "Northern Mariana Islands",
};

/** Every recognized USPS code, alphabetical — the filter's fixed vocabulary. */
export const US_STATE_CODES: readonly string[] = Object.keys(
  US_STATE_NAMES,
).sort();

const US_STATE_CODE_SET = new Set(US_STATE_CODES);

const STATE_CODES_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAMES).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ]),
);

export function isUsStateCode(raw: string): boolean {
  return US_STATE_CODE_SET.has(raw);
}

/**
 * The canonical location-state formatter, shared by the book refresh (which
 * writes `accounts.state`) and the Accounts filter (which reads it).
 * Two-letter values fold to upper case; full names map to their USPS code —
 * including names carrying stray trailing punctuation ("Georgia." appears in
 * the live book). Anything else passes through untouched: an unknown value
 * stays visibly itself rather than being coerced into a real state.
 */
export function normalizeLocationState(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const byName = STATE_CODES_BY_NAME[s.toLowerCase()];
  if (byName) return byName;
  const stripped = s.replace(/[\s.,]+$/, "");
  return STATE_CODES_BY_NAME[stripped.toLowerCase()] ?? s;
}

/**
 * Filter id for accounts whose stored location state is missing or is not a
 * recognized USPS code — the rows that display "—" (or a raw legacy value).
 * Matches the row's display state exactly, mirroring gate:none / step:none.
 */
export const LOCATION_STATE_NONE = "state:none";
export const LOCATION_STATE_NONE_LABEL = "Unknown / Not set";

export type LocationStateFilterId = string;

export const LOCATION_STATE_FILTER_PARAM = "state";

export function isLocationStateFilterId(
  raw: string,
): raw is LocationStateFilterId {
  return raw === LOCATION_STATE_NONE || US_STATE_CODE_SET.has(raw);
}

/**
 * Parse the `state` URL param. Empty / missing → no state filter. Tokens are
 * normalized (so a hand-written ?state=ca or ?state=Florida still lands on
 * the code) and validated against the fixed USPS vocabulary; unknown tokens
 * are safely dropped. Codes sort alphabetically with Unknown last, so the
 * normalizing redirect settles on one spelling of any selection.
 */
export function parseLocationStates(
  raw: string | null | undefined,
): LocationStateFilterId[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<LocationStateFilterId>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (token.toLowerCase() === LOCATION_STATE_NONE) {
      seen.add(LOCATION_STATE_NONE);
      continue;
    }
    const code = normalizeLocationState(token);
    if (US_STATE_CODE_SET.has(code)) seen.add(code);
  }
  return sortLocationStates([...seen]);
}

/** Codes alphabetically, Unknown / Not set last. */
export function sortLocationStates(
  ids: readonly LocationStateFilterId[],
): LocationStateFilterId[] {
  return [...ids].sort((a, b) => {
    if (a === LOCATION_STATE_NONE) return b === LOCATION_STATE_NONE ? 0 : 1;
    if (b === LOCATION_STATE_NONE) return -1;
    return a.localeCompare(b);
  });
}

/** Serialize selected states for the URL. Empty → omit param. */
export function serializeLocationStates(
  ids: readonly LocationStateFilterId[],
): string | undefined {
  if (ids.length === 0) return undefined;
  return sortLocationStates(ids).join(",");
}

/** Label for one filter id: "CA — California" pieces live with the control. */
export function locationStateLabel(id: LocationStateFilterId): string {
  if (id === LOCATION_STATE_NONE) return LOCATION_STATE_NONE_LABEL;
  return US_STATE_NAMES[id] ?? id;
}

/**
 * True when a stored account state matches the selection — the same
 * membership rule the SQL predicate applies: recognized codes match
 * themselves, everything else (missing, legacy, junk) belongs to
 * Unknown / Not set. Empty selection means no state filter.
 */
export function accountMatchesLocationStates(
  storedState: string | null | undefined,
  selected: readonly LocationStateFilterId[],
): boolean {
  if (selected.length === 0) return true;
  const stored = (storedState ?? "").trim().toUpperCase();
  const recognized = US_STATE_CODE_SET.has(stored);
  return selected.some((id) =>
    id === LOCATION_STATE_NONE ? !recognized : recognized && stored === id,
  );
}
