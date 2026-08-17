import type { OrderSource } from "./account-source";
import type { BookOrderListItem } from "./db/queries/accounts";
import type { CompanyOrderSummary } from "./company-detail-types";

function consistentSource(
  orders: readonly BookOrderListItem[],
): OrderSource | null {
  const sources = new Set(orders.map((order) => order.source));
  if (sources.size === 0 || sources.has(null)) return null;
  if (sources.size === 1) return orders[0]?.source ?? null;
  return "mixed";
}

function exactSum(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  const total = (values as number[]).reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Company metrics intentionally aggregate once at the existing book-order
 * grain. Premium excludes taxes and fees; revenue reuses orders_temp's
 * authoritative total_revenue field.
 */
export function summarizeCompanyOrders(
  orders: readonly BookOrderListItem[],
): CompanyOrderSummary {
  const statusCounts = { bound: 0, pending: 0, lost: 0 };
  for (const order of orders) statusCounts[order.bindStatus] += 1;
  return {
    orders: [...orders],
    source: consistentSource(orders),
    totalPremiumCents: exactSum(
      orders.map((order) => order.rich.totalPremiumCents),
    ),
    totalRevenueMicros: exactSum(
      orders.map((order) => order.revenueMicros),
    ),
    totalCommissionCents: exactSum(
      orders.map((order) => order.rich.commissionRevenueCents),
    ),
    totalHarperFeeCents: exactSum(
      orders.map((order) => order.rich.harperServiceFeeCents),
    ),
    statusCounts,
  };
}
