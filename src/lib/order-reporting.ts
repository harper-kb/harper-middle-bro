export const ORDER_REPORTING_RANGE_IDS = [
  "all-time",
  "this-week",
  "last-week",
  "last-30-days",
] as const;

export type OrderReportingRangeId =
  (typeof ORDER_REPORTING_RANGE_IDS)[number];

export const ORDER_REPORTING_RANGE_LABELS: Record<
  OrderReportingRangeId,
  string
> = {
  "all-time": "All Time",
  "this-week": "This Week",
  "last-week": "Last Week",
  "last-30-days": "Last 30 Days",
};

export function parseOrderReportingRange(
  value: string | null | undefined,
): OrderReportingRangeId {
  return (ORDER_REPORTING_RANGE_IDS as readonly string[]).includes(value ?? "")
    ? (value as OrderReportingRangeId)
    : "all-time";
}
