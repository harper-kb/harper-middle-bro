/**
 * Accounts list sort axis — one typed shape shared by the State & Sort
 * control, the URL param and the server query, so the client can never ask
 * for an ordering the query does not implement.
 *
 * Two independent choices compose one ordering:
 * - Date order (always active): Oldest first is the default ordering of
 *   every Accounts records page; Newest first flips it. The date is the
 *   canonical representative date per page (the shared representative-order
 *   rule's `created_at`; the verified bind event on Bound).
 * - Revenue order (optional): when active it takes priority — the list
 *   orders by the exact revenue figure each row displays (aggregate of
 *   matching orders, unavailable when any is missing) and the date order
 *   then arranges equal-revenue runs and the unavailable tail. Date stays
 *   subordinate because representative dates are nearly unique: a primary
 *   date key would make any revenue choice invisible.
 *
 * Null dates and unavailable revenue sort after valid values in every
 * combination; account name and stable id close every ordering.
 */

export const ACCOUNT_DATE_ORDER_IDS = ["oldest", "newest"] as const;
export type AccountDateOrder = (typeof ACCOUNT_DATE_ORDER_IDS)[number];

export const ACCOUNT_REVENUE_ORDER_IDS = [
  "none",
  "revenue-desc",
  "revenue-asc",
] as const;
export type AccountRevenueOrder = (typeof ACCOUNT_REVENUE_ORDER_IDS)[number];

export interface AccountSort {
  date: AccountDateOrder;
  revenue: AccountRevenueOrder;
}

export const DEFAULT_ACCOUNT_SORT: AccountSort = {
  date: "oldest",
  revenue: "none",
};

export const ACCOUNT_SORT_PARAM = "sort";

export const ACCOUNT_DATE_ORDER_LABELS: Record<AccountDateOrder, string> = {
  oldest: "Oldest first",
  newest: "Newest first",
};

export const ACCOUNT_REVENUE_ORDER_LABELS: Record<AccountRevenueOrder, string> =
  {
    none: "None",
    "revenue-desc": "High to low",
    "revenue-asc": "Low to high",
  };

/** Compact trigger wording pieces ("Revenue high · Newest"). */
const REVENUE_SUMMARIES: Record<
  Exclude<AccountRevenueOrder, "none">,
  string
> = {
  "revenue-desc": "Revenue high",
  "revenue-asc": "Revenue low",
};

export function isDefaultAccountSort(sort: AccountSort): boolean {
  return (
    sort.date === DEFAULT_ACCOUNT_SORT.date &&
    sort.revenue === DEFAULT_ACCOUNT_SORT.revenue
  );
}

function isDateOrder(raw: string): raw is AccountDateOrder {
  return (ACCOUNT_DATE_ORDER_IDS as readonly string[]).includes(raw);
}

function isRevenueOrder(
  raw: string,
): raw is Exclude<AccountRevenueOrder, "none"> {
  return raw === "revenue-desc" || raw === "revenue-asc";
}

/**
 * Parse the `sort` URL param — a comma list of at most one date token
 * (`newest`/`oldest`) and one revenue token (`revenue-desc`/`revenue-asc`).
 * Unknown tokens are safely ignored; anything unparseable is the default.
 */
export function parseAccountSort(raw: string | null | undefined): AccountSort {
  const sort: AccountSort = { ...DEFAULT_ACCOUNT_SORT };
  if (typeof raw !== "string") return sort;
  let dateSeen = false;
  let revenueSeen = false;
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!dateSeen && isDateOrder(token)) {
      sort.date = token;
      dateSeen = true;
    } else if (!revenueSeen && isRevenueOrder(token)) {
      sort.revenue = token;
      revenueSeen = true;
    }
  }
  return sort;
}

/**
 * Serialize for the URL: primary-first (`revenue-desc,newest`), default
 * components omitted, the full default omitted entirely.
 */
export function serializeAccountSort(sort: AccountSort): string | undefined {
  const tokens: string[] = [];
  if (sort.revenue !== "none") tokens.push(sort.revenue);
  if (sort.date !== "oldest") tokens.push(sort.date);
  return tokens.length > 0 ? tokens.join(",") : undefined;
}

/** Compact non-default summary ("Revenue high · Newest"); null when default. */
export function accountSortSummary(sort: AccountSort): string | null {
  const parts: string[] = [];
  if (sort.revenue !== "none") parts.push(REVENUE_SUMMARIES[sort.revenue]);
  if (sort.date !== "oldest")
    parts.push(sort.date === "newest" ? "Newest" : "Oldest");
  return parts.length > 0 ? parts.join(" · ") : null;
}
