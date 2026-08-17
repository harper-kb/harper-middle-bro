import {
  BOOK_ORDER_BIND_STATUSES,
  emptyBookOrderRich,
  normalizeBookOrderRich,
  type BookOrderBindStatus,
  type BookOrderRichData,
} from "../../supabase-book.server";
import { parseOrderSource, type OrderSource } from "../../account-source";
import { getDb } from "../connection";

/**
 * Global company search for the operational bar.
 *
 * Runs entirely against the synced Harper book in local SQLite, so a keystroke
 * costs one in-process query pair rather than a round trip to Harper, and every
 * result belongs to the same successful sync the metrics bar timestamps.
 *
 * Matching axes, all case-insensitive:
 * - company name and DBA (`accounts.name` / `accounts.dba`)
 * - customer email and phone, through the normalized `account_search_keys`
 *   index — lowercased emails and digit-only phones, so punctuation, spacing,
 *   parentheses and a `+1` country code cannot block a match. Because Harper
 *   stores phones in E.164, a ten-digit query matches an eleven-digit stored
 *   key as a substring without any country-code special case.
 *
 * Contact keys only ever narrow the result set — a matched email or phone is
 * never returned, so identifying an account by customer contact does not put a
 * customer email or phone number on the wire.
 */

/** Best-results cap. Deliberately small: this is a jump-to, not a report. */
export const COMPANY_SEARCH_LIMIT = 8;

/** Below this the query is too broad to be worth running at all. */
export const COMPANY_SEARCH_MIN_LENGTH = 2;

/**
 * Contact axes need more signal than a name does. Two characters of an email
 * or a phone match most of the book, and those hits would only ever displace
 * better-ranked name matches.
 */
const MIN_EMAIL_LENGTH = 3;
const MIN_PHONE_DIGITS = 4;

export interface CompanySearchResult {
  /** Stable `co-{companies.id}` account id — the account detail route's key. */
  id: string;
  name: string;
  dba: string | null;
  state: string;
  orderCount: number;
  /**
   * Distinct producers across the account's orders, deduplicated by stable
   * `producers.id`. Empty when no order names one.
   */
  producerNames: string[];
  /** IQ / Broker / Mixed across the account's orders; null = unclassified. */
  source: OrderSource | null;
  /** Distinct carriers from the authoritative deal payload. */
  carrierNames: string[];
  /** Every lifecycle state present on the account, never just the first one. */
  statuses: BookOrderBindStatus[];
}

/** Neutralize LIKE wildcards so a typed `%` or `_` matches itself. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

type MatchRow = { id: string; name: string; dba: string | null; state: string };

type OrderRow = {
  account_id: string;
  bind_status: string;
  source: string | null;
  producer_id: number | null;
  producer_name: string | null;
  rich_json: string;
};

/**
 * Rank-ordered best matches. Exact company/DBA names and exact contact keys
 * come first, then name prefixes, then general substrings, then contact
 * substrings; shorter names break ties so "Azure" outranks a longer name that
 * merely contains it.
 */
export function searchCompanies(
  rawQuery: string,
  limit: number = COMPANY_SEARCH_LIMIT,
): CompanySearchResult[] {
  const query = rawQuery.trim();
  if (query.length < COMPANY_SEARCH_MIN_LENGTH) return [];

  const text = query.toLowerCase();
  const like = escapeLike(text);
  const digits = query.replace(/[^0-9]/g, "");
  const emailQuery = text.length >= MIN_EMAIL_LENGTH ? text : null;
  const phoneQuery = digits.length >= MIN_PHONE_DIGITS ? digits : null;

  // Built in lockstep with `params` so every `?` keeps its value. Nothing from
  // the operator's query is ever concatenated into the statement.
  const params: (string | number)[] = [];

  let rank =
    `CASE WHEN lower(accounts.name) = ? ` +
    `OR lower(COALESCE(accounts.dba, '')) = ? THEN 0`;
  params.push(text, text);

  const exactKey: string[] = [];
  const exactKeyParams: string[] = [];
  if (emailQuery) {
    exactKey.push("(k.kind = 'email' AND k.value = ?)");
    exactKeyParams.push(emailQuery);
  }
  if (phoneQuery) {
    // Harper stores E.164, so a ten-digit query is also exact against `1`+it.
    exactKey.push("(k.kind = 'phone' AND (k.value = ? OR k.value = '1' || ?))");
    exactKeyParams.push(phoneQuery, phoneQuery);
  }
  if (exactKey.length > 0) {
    rank +=
      ` WHEN EXISTS (SELECT 1 FROM account_search_keys k` +
      ` WHERE k.account_id = accounts.id AND (${exactKey.join(" OR ")})) THEN 0`;
    params.push(...exactKeyParams);
  }

  rank +=
    ` WHEN lower(accounts.name) LIKE ? ESCAPE '\\'` +
    ` OR lower(COALESCE(accounts.dba, '')) LIKE ? ESCAPE '\\' THEN 1`;
  params.push(`${like}%`, `${like}%`);
  rank +=
    ` WHEN lower(accounts.name) LIKE ? ESCAPE '\\'` +
    ` OR lower(COALESCE(accounts.dba, '')) LIKE ? ESCAPE '\\' THEN 2`;
  params.push(`%${like}%`, `%${like}%`);
  rank += " ELSE 3 END";

  let match =
    `lower(accounts.name) LIKE ? ESCAPE '\\'` +
    ` OR lower(COALESCE(accounts.dba, '')) LIKE ? ESCAPE '\\'`;
  params.push(`%${like}%`, `%${like}%`);

  const keyMatch: string[] = [];
  const keyMatchParams: string[] = [];
  if (emailQuery) {
    keyMatch.push("(k.kind = 'email' AND k.value LIKE ? ESCAPE '\\')");
    keyMatchParams.push(`%${like}%`);
  }
  if (phoneQuery) {
    keyMatch.push("(k.kind = 'phone' AND k.value LIKE ? ESCAPE '\\')");
    keyMatchParams.push(`%${escapeLike(phoneQuery)}%`);
  }
  if (keyMatch.length > 0) {
    match +=
      ` OR EXISTS (SELECT 1 FROM account_search_keys k` +
      ` WHERE k.account_id = accounts.id AND (${keyMatch.join(" OR ")}))`;
    params.push(...keyMatchParams);
  }

  params.push(limit);

  const db = getDb();
  const matches = db
    .prepare(
      `SELECT accounts.id, accounts.name, accounts.dba, accounts.state,
              ${rank} AS rank
       FROM accounts
       WHERE accounts.id LIKE 'co-%'
         AND EXISTS (
           SELECT 1 FROM book_orders o WHERE o.account_id = accounts.id
         )
         AND (${match})
       ORDER BY rank, length(accounts.name), accounts.name
       LIMIT ?`,
    )
    .all(...params) as (MatchRow & { rank: number })[];

  if (matches.length === 0) return [];

  // One batched read for the whole page of results — never one per row.
  const orderRows = db
    .prepare(
      `SELECT account_id, bind_status, source, producer_id, producer_name,
              rich_json
       FROM book_orders
       WHERE account_id IN (${matches.map(() => "?").join(", ")})`,
    )
    .all(...matches.map((row) => row.id)) as OrderRow[];

  const byAccount = new Map<string, OrderRow[]>();
  for (const row of orderRows) {
    const bucket = byAccount.get(row.account_id);
    if (bucket) bucket.push(row);
    else byAccount.set(row.account_id, [row]);
  }

  return matches.map((row) =>
    summarize(row, byAccount.get(row.id) ?? []),
  );
}

function parseRich(rawJson: string): BookOrderRichData {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return parsed && typeof parsed === "object"
      ? normalizeBookOrderRich(parsed as BookOrderRichData)
      : emptyBookOrderRich();
  } catch {
    return emptyBookOrderRich();
  }
}

/**
 * Collapse an account's orders into the preview. Multi-order accounts keep
 * every distinct value: the preview reports "Bound + Pending" or "2 carriers"
 * rather than presenting one arbitrary order as the state of the account.
 */
function summarize(
  account: MatchRow,
  orders: readonly OrderRow[],
): CompanySearchResult {
  const statuses = BOOK_ORDER_BIND_STATUSES.filter((status) =>
    orders.some((order) => order.bind_status === status),
  );

  // Same rule the All Accounts row summary uses: a single agreed source, or
  // Mixed — but never a guess when any order is unclassified.
  const sources = new Set(orders.map((order) => parseOrderSource(order.source)));
  const source =
    sources.size === 0
      ? null
      : sources.size === 1
        ? (parseOrderSource(orders[0]?.source) ?? null)
        : sources.has(null)
          ? null
          : "mixed";

  const carrierNames = [
    ...new Set(
      orders.flatMap((order) =>
        parseRich(order.rich_json)
          .deals.map((deal) => deal.carrierName?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Deduplicated by the stable producer id, not by the rendered name.
  const producersById = new Map<number, string>();
  for (const order of orders) {
    const name = order.producer_name?.trim();
    if (!name || order.producer_id === null) continue;
    if (!producersById.has(order.producer_id)) {
      producersById.set(order.producer_id, name);
    }
  }
  const producerNames = [...producersById.values()].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    id: account.id,
    name: account.name,
    dba: account.dba,
    state: account.state,
    orderCount: orders.length,
    producerNames,
    source,
    carrierNames,
    statuses,
  };
}
