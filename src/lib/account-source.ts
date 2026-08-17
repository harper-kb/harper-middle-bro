/**
 * Account-source filter for the Accounts views.
 *
 * Authoritative Harper field: `deals_v2.is_instant_quote` (deal grain) — the
 * same flag BigBrother's WorkBench "Instant quotes" queue filters on.
 * `companies.instant_quote` is deliberately NOT used: it is a company-level
 * lead attribute that disagrees with how the deals were actually placed
 * (1,267 IQ-flagged companies carry broker deals, 1,907 broker-flagged
 * companies carry IQ deals, and 4,169 book companies are null).
 *
 * An order is IQ when every non-deleted deal on it is instant-quoted, Broker
 * when none are, and Mixed otherwise. Accounts partition strictly: an account
 * appears under IQ only when every order in the current view is IQ, so a
 * mixed account is reachable only from All.
 *
 * Joined by stable ids (`accounts.id` = `co-{companies.id}`), never by name.
 */

export const ACCOUNT_SOURCE_IDS = ["all", "iq", "broker"] as const;

export type AccountSourceId = (typeof ACCOUNT_SOURCE_IDS)[number];

export const ACCOUNT_SOURCE_LABELS: Record<AccountSourceId, string> = {
  all: "All",
  iq: "IQ",
  broker: "Broker",
};

/** Per-order classification persisted on `book_orders.source`. */
export type OrderSource = "iq" | "broker" | "mixed";

export function parseAccountSource(
  value: string | null | undefined,
): AccountSourceId {
  return (ACCOUNT_SOURCE_IDS as readonly string[]).includes(value ?? "")
    ? (value as AccountSourceId)
    : "all";
}

export function parseOrderSource(value: unknown): OrderSource | null {
  return value === "iq" || value === "broker" || value === "mixed"
    ? value
    : null;
}

/**
 * Classify one order from its deals. Null when the order carries no deals —
 * unclassifiable, and never coerced into a Broker or IQ answer.
 */
export function classifyOrderSource(
  deals: readonly { isInstantQuote: boolean }[],
): OrderSource | null {
  if (deals.length === 0) return null;
  const instantCount = deals.filter((deal) => deal.isInstantQuote).length;
  if (instantCount === deals.length) return "iq";
  if (instantCount === 0) return "broker";
  return "mixed";
}

/**
 * Order-preview wording, borrowed from the filter control so a badge on a card
 * always reads the same as the segment that surfaced it. Mixed has no segment
 * of its own — it is reachable only from All.
 */
export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  iq: ACCOUNT_SOURCE_LABELS.iq,
  broker: ACCOUNT_SOURCE_LABELS.broker,
  mixed: "Mixed",
};

/** Label for an order whose deals cannot classify it either way. */
export const SOURCE_UNAVAILABLE_LABEL = "Source unavailable";

/**
 * The one place a source turns into a visual identity. Every surface — filter
 * segment, collapsed row, order chip, company header, search result — composes
 * its own class from this tone rather than deciding on its own what Broker
 * looks like, so the purple can never drift back to gray in one corner.
 *
 * `mixed` and `unavailable` stay deliberately neutral: neither is Broker, and
 * tinting them purple would contradict the filter, which surfaces both only
 * under All.
 */
export type SourceTone = "iq" | "broker" | "mixed" | "unavailable";

export function sourceTone(source: OrderSource | null): SourceTone {
  return source ?? "unavailable";
}

export function sourceLabel(source: OrderSource | null): string {
  return source ? ORDER_SOURCE_LABELS[source] : SOURCE_UNAVAILABLE_LABEL;
}

/** Full-sentence explanation shown in the tooltip beside every source mark. */
export const SOURCE_DESCRIPTIONS: Record<SourceTone, string> = {
  iq: "IQ account — every deal on this order is an instant quote",
  broker: "Broker account — no instant-quote deals on this order",
  mixed:
    "Mixed account — this order carries both instant-quote and broker deals",
  unavailable:
    "Source unavailable — no deals are available to classify as IQ or Broker",
};
