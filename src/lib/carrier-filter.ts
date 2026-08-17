/**
 * Carrier filter axis for the Accounts views.
 *
 * Authoritative Harper relationship (verified live): every eligible
 * `deals_v2` row resolves its carrier through `deals_v2.carrier` →
 * `insurance_carriers.code` (12,271 / 12,271 at audit time), with
 * `NULLIF(d.carrier,'')` / `NULLIF(d.ai_carrier,'')` as refresh-time text
 * fallbacks that currently never fire. The snapshot persists the resolved
 * display name per deal (`rich.deals[].carrierName`); `deals_v2.wholesaler`
 * → `general_agents` is a market intermediary, not the carrier, and never
 * enters this axis.
 *
 * Identity: `insurance_carriers.code` is an office/address grain — one
 * underwriting company holds many codes (e.g. 12 codes all named
 * "ZURICH AMERICAN INS CO", differing only by region/city), and Harper has
 * no parent-entity key (`party_id` is per-office). Filtering by office code
 * would render indistinguishable duplicate menu entries and split orders the
 * desk reads as one carrier. So the filter identity is the carrier-entity
 * key derived deterministically at read time from the verified display name:
 * lowercased, trimmed, inner whitespace collapsed. Nothing is merged on
 * similarity — only names that are byte-identical after case/whitespace
 * folding share a key (verified live: 12 case-only variant pairs, zero
 * punctuation-only pairs). Punctuation is deliberately preserved so two
 * genuinely different names can never collide.
 */

export const CARRIER_FILTER_PARAM = "carrier";

/**
 * Guardrail for hostile/degenerate URLs only — the live book carries ~300
 * carrier entities, so a real selection can never reach this.
 */
export const MAX_SELECTED_CARRIERS = 400;

/**
 * The deterministic carrier-entity key for one verified display name.
 * Lowercase + trim + collapse runs of whitespace; null when there is no
 * name to key (the deal's carrier is unknown — never invent one).
 */
export function carrierKeyFromName(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return key || null;
}

/**
 * Distinct carrier keys across an order's deals — the same deal set the
 * order card and the collapsed row derive their carrier line from, so filter
 * membership and display can never disagree.
 */
export function carrierKeysForDeals(
  deals: readonly { carrierName: string | null }[],
): string[] {
  const keys = new Set<string>();
  for (const deal of deals) {
    const key = carrierKeyFromName(deal.carrierName);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * URL-token escaping for one key. Keys are data-derived (normalized display
 * names), so unlike the fixed iqStage/brokerGate vocabularies a key could in
 * principle contain the `,` list separator. Only `%` and `,` are escaped —
 * everything else stays readable in the address bar.
 */
function encodeCarrierKeyToken(key: string): string {
  return key.replaceAll("%", "%25").replaceAll(",", "%2c");
}

function decodeCarrierKeyToken(token: string): string {
  return token.replaceAll(/%2c/gi, ",").replaceAll(/%25/gi, "%");
}

/**
 * Parse the `carrier` URL param. Empty / missing → no carrier filter.
 * Tokens are unescaped, re-normalized to canonical keys and deduplicated;
 * the result is sorted so the page's normalizing redirect settles on exactly
 * one spelling of any selection. Unknown keys survive parsing — whether a
 * key exists in the book is a data question the facet answers, and a shared
 * URL must not silently drop the sender's intent.
 */
export function parseCarrierFilter(raw: string | null | undefined): string[] {
  // Runtime shapes the page types don't promise (e.g. a repeated ?carrier=
  // param arriving as an array) parse as no selection rather than throwing.
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const key = carrierKeyFromName(decodeCarrierKeyToken(part));
    if (!key) continue;
    seen.add(key);
    if (seen.size >= MAX_SELECTED_CARRIERS) break;
  }
  return [...seen].sort();
}

/** Serialize selected carrier keys for the URL. Empty → omit param. */
export function serializeCarrierFilter(
  keys: readonly string[],
): string | undefined {
  if (keys.length === 0) return undefined;
  return [...keys].sort().map(encodeCarrierKeyToken).join(",");
}

/**
 * True when an order's deals carry any selected carrier — OR within the
 * carrier set. Empty selection means no carrier filter.
 */
export function orderMatchesCarriers(
  deals: readonly { carrierName: string | null }[],
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  const keys = carrierKeysForDeals(deals);
  return selected.some((key) => keys.includes(key));
}
