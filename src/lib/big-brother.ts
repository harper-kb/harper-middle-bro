/**
 * Big Brother deep links.
 *
 * The route key is `public.companies.id` — the same bigint Step Bro carries as
 * `accounts.id = co-{companies.id}`. Verified against `midfunnel_tasks
 * .bigbrother_url`, where 249 of 252 distinct stored `/company/{id}` links
 * resolve to a `companies.id` row (243 also match on company name; the rest
 * were renamed after the task was written). It is NOT `orders_temp.id`,
 * `companies.party_id`, `companies.external_id`, or any CRM id.
 */

/** The only origin this app is allowed to hand an operator off to. */
export const BIG_BROTHER_ORIGIN = "https://bigbrother.harperinsure.com";

/** `companies.id` is a positive bigint; the route accepts nothing else. */
const COMPANY_ID = /^[1-9][0-9]{0,17}$/;
const ACCOUNT_ID = /^co-([1-9][0-9]{0,17})$/;

/**
 * The Big Brother company id for a Step Bro account id, or null when the
 * account id is not the `co-{companies.id}` shape the route key comes from.
 * Never falls back to a name, an order id, or a partial parse.
 */
export function bigBrotherCompanyId(
  accountId: string | null | undefined,
): string | null {
  if (typeof accountId !== "string") return null;
  return ACCOUNT_ID.exec(accountId.trim())?.[1] ?? null;
}

/**
 * The company's Orders tab on Big Brother, or null when the id is missing or
 * malformed. Callers disable the handoff on null rather than guessing a URL.
 */
export function bigBrotherCompanyOrdersUrl(
  companyId: string | number | null | undefined,
): string | null {
  if (companyId === null || companyId === undefined) return null;
  const raw =
    typeof companyId === "number"
      ? Number.isSafeInteger(companyId) && companyId > 0
        ? String(companyId)
        : ""
      : companyId.trim();
  if (!COMPANY_ID.test(raw)) return null;

  const url = `${BIG_BROTHER_ORIGIN}/company/${encodeURIComponent(raw)}/transaction?tab=orders`;
  // Belt and braces: the built string must still parse to the trusted origin.
  return isBigBrotherUrl(url) ? url : null;
}

/** True only for an absolute URL on the trusted Big Brother origin. */
export function isBigBrotherUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.origin === BIG_BROTHER_ORIGIN;
}
