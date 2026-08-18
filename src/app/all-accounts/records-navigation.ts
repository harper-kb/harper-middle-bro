/**
 * The Records → account-detail → Records round trip.
 *
 * Opening an account is an ordinary history push, so browser Back already
 * returns to the exact filtered list. The explicit "Back to Accounts" action
 * needs the same destination without depending on history depth or on
 * `document.referrer`, which a client-side transition never updates — so the
 * account link carries the canonical Records URL it was rendered from, and the
 * detail page validates it before trusting it.
 */

import {
  getAccountOrdersViewFromPath,
  parseRecordsFilterState,
  recordsFilterHref,
  type RecordsFilterState,
  type RecordsSearchParams,
  type RecordsView,
  withRecordsView,
} from "./records-filter-state";
import {
  ACCOUNT_ORDERS_VIEWS,
  type AccountOrdersView,
} from "./view-config";

export const RECORDS_RETURN_PARAM = "recordsReturn";

/** Long enough for a fully filtered list, short enough to reject junk. */
const MAX_RETURN_HREF_LENGTH = 2_048;

/** Canonical destination for a deliberate Records view switch. */
export function recordsViewHref(
  view: AccountOrdersView,
  currentParams: RecordsSearchParams,
): string {
  return recordsFilterHref({
    ...parseRecordsFilterState(view.id, currentParams),
    page: 1,
  });
}

/** Exact canonical current Records location, page included. */
export function recordsListHref(
  basePath: string,
  currentParams: RecordsSearchParams,
): string {
  return recordsFilterHref(
    parseRecordsFilterState(
      getAccountOrdersViewFromPath(basePath),
      currentParams,
    ),
  );
}

export function accountDetailHref(
  accountId: string,
  recordsHref?: string | null,
): string {
  const path = `/accounts/${encodeURIComponent(accountId)}`;
  if (!recordsHref) return path;
  const params = new URLSearchParams({ [RECORDS_RETURN_PARAM]: recordsHref });
  return `${path}?${params.toString()}`;
}

/**
 * Accept only an app-relative Records URL, and return it re-serialized from
 * the canonical parser.
 *
 * The value reaches us through the address bar, so it is treated as untrusted
 * input: anything with another origin, another protocol, a protocol-relative
 * prefix, a non-Records path or a fragment is rejected outright rather than
 * repaired, which is what keeps this from becoming an open redirect. What
 * survives is parsed into filter state and spelled canonically, so a tampered
 * or stale return URL can only ever land on a valid, filtered Records list.
 */
export function parseRecordsReturnState(
  value: unknown,
): RecordsFilterState | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RETURN_HREF_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return null;
  }

  try {
    const base = new URL("https://step-bro.invalid");
    const candidate = new URL(value, base);
    if (candidate.origin !== base.origin || candidate.hash) return null;

    const view = ACCOUNT_ORDERS_VIEWS.find(
      (entry) => entry.href === candidate.pathname,
    );
    if (!view) return null;

    const params: RecordsSearchParams = {};
    for (const key of new Set(candidate.searchParams.keys())) {
      params[key] = candidate.searchParams.get(key) ?? undefined;
    }
    const state = parseRecordsFilterState(view.id, params);
    // Foreign params are not part of the Records context and are not carried
    // back across a trust boundary.
    return { ...state, passthrough: {} };
  } catch {
    return null;
  }
}

export function parseRecordsReturnHref(value: unknown): string | null {
  const state = parseRecordsReturnState(value);
  return state ? recordsFilterHref(state) : null;
}

/**
 * The account detail sidebar gets the same Records context as its Back action,
 * so choosing another Records child from the company page preserves every
 * filter that destination can still apply.
 */
export function recordsNavigationHrefs(
  value: unknown,
): Partial<Record<RecordsView, string>> | undefined {
  const state = parseRecordsReturnState(value);
  if (!state) return undefined;
  return Object.fromEntries(
    ACCOUNT_ORDERS_VIEWS.map((view) => [
      view.id,
      recordsFilterHref(withRecordsView(state, view.id)),
    ]),
  );
}
