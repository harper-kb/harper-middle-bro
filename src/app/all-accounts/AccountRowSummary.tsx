"use client";

import { useId } from "react";
import {
  ORDER_SOURCE_LABELS,
  type OrderSource,
} from "@/lib/account-source";
import type { BookOrderListItem } from "@/lib/db";
import {
  dealAgeDays,
  dealAgeLabel,
  dealAgeNeedsAttention,
} from "@/lib/order-age";

export interface AccountOrderSummary {
  source: OrderSource | null;
  revenueMicros: number | null;
  ageDays: number | null;
  carrierNames: string[];
  orderCount: number;
}

/**
 * Summarize only the orders already attached to this account row. That keeps
 * the collapsed preview in the same successful snapshot and selected
 * lifecycle/range as the expanded order cards.
 *
 * For multiple orders:
 * - source is only IQ/Broker when every order agrees; otherwise it is Mixed
 * - revenue is the exact sum at order grain, or unavailable when any value is
 *   missing (never present a partial total as complete)
 * - age is the oldest displayed order, so newer work cannot hide stale work
 * - carriers are deduplicated from the authoritative deal payload
 */
export function summarizeAccountOrders(
  orders: readonly BookOrderListItem[],
  todayDay: string,
): AccountOrderSummary {
  const sources = new Set(orders.map((order) => order.source));
  const source =
    sources.size === 0
      ? null
      : sources.size === 1
      ? (orders[0]?.source ?? null)
      : sources.has(null)
        ? null
        : "mixed";

  let revenueMicros: number | null = 0;
  for (const order of orders) {
    if (order.revenueMicros === null) {
      revenueMicros = null;
      break;
    }
    revenueMicros += order.revenueMicros;
  }
  if (revenueMicros !== null && !Number.isSafeInteger(revenueMicros)) {
    revenueMicros = null;
  }

  const ages = orders.map((order) => dealAgeDays(order.createdAt, todayDay));
  const ageDays = ages.some((age) => age === null)
    ? null
    : Math.max(...(ages as number[]));

  const carrierNames = [
    ...new Set(
      orders.flatMap((order) =>
        order.rich.deals
          .map((deal) => deal.carrierName?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    source,
    revenueMicros,
    ageDays: Number.isFinite(ageDays) ? ageDays : null,
    carrierNames,
    orderCount: orders.length,
  };
}

function SourceIcon({ source }: { source: OrderSource | null }) {
  if (source === "iq") {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true" className="account-summary-icon">
        <path d="M7 1 2.5 6.75h2.25L4.75 11 9.5 5h-2.4z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="account-summary-icon"
    >
      <circle cx="6" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2 10.5c0-1.9 1.8-3 4-3s4 1.1 4 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CarrierIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="account-summary-icon"
    >
      <path
        d="M2 6.5 7 2l5 4.5v5H9V8H5v3.5H2z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RevenueIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="account-summary-icon"
    >
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8.8 4.9c-.45-.4-1.05-.6-1.8-.6-1 0-1.7.45-1.7 1.15 0 1.8 3.4.8 3.4 2.85 0 .8-.75 1.4-1.85 1.4-.8 0-1.5-.25-2-.75M7 3.2v7.6"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon({ attention }: { attention: boolean }) {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="account-summary-icon"
    >
      {attention ? (
        <>
          <path
            d="M7 1.5 12.5 12H1.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M7 5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="7" cy="10" r=".65" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="M7 4.1v3.1l2 1.2"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function SummaryItem({
  icon,
  children,
  tip,
  tone,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tip: string;
  tone?: "iq" | "attention";
}) {
  const tipId = useId();
  return (
    <span
      className={`account-summary-item${
        tone ? ` account-summary-item--${tone}` : ""
      }`}
      tabIndex={0}
      aria-describedby={tipId}
    >
      {icon}
      <span>{children}</span>
      <span id={tipId} role="tooltip" className="account-summary-tip">
        {tip}
      </span>
    </span>
  );
}

function formatRevenue(revenueMicros: number): string {
  const cents = Math.round(revenueMicros / 10_000);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function AccountRowSummary({
  orders,
  todayDay,
}: {
  orders: readonly BookOrderListItem[];
  todayDay: string;
}) {
  const summary = summarizeAccountOrders(orders, todayDay);
  const sourceLabel = summary.source
    ? ORDER_SOURCE_LABELS[summary.source]
    : "Source unavailable";
  const carrierLabel =
    summary.carrierNames.length === 0
      ? "Carrier unavailable"
      : summary.carrierNames.length === 1
        ? summary.carrierNames[0]
        : `${summary.carrierNames.length} carriers`;
  const ageAttention =
    summary.ageDays !== null && dealAgeNeedsAttention(summary.ageDays);
  const ageLabel =
    summary.ageDays === null
      ? "Age unavailable"
      : `${dealAgeLabel(summary.ageDays)} ago`;

  return (
    <span className="account-summary" aria-label="Account order summary">
      <SummaryItem
        icon={<SourceIcon source={summary.source} />}
        tone={summary.source === "iq" ? "iq" : undefined}
        tip={
          summary.source
            ? `${sourceLabel} source across ${summary.orderCount.toLocaleString()} ${
                summary.orderCount === 1 ? "order" : "orders"
              }`
            : "Source unavailable or inconsistent across this account's displayed orders"
        }
      >
        {sourceLabel}
      </SummaryItem>

      <SummaryItem
        icon={<ClockIcon attention={ageAttention} />}
        tone={ageAttention ? "attention" : undefined}
        tip={
          summary.ageDays === null
            ? "Age unavailable because a displayed order has no creation timestamp"
            : `${summary.orderCount === 1 ? "Order" : "Oldest displayed order"} created ${ageLabel}`
        }
      >
        {ageLabel}
      </SummaryItem>

      <SummaryItem
        icon={<CarrierIcon />}
        tip={
          summary.carrierNames.length > 0
            ? `Carrier${summary.carrierNames.length === 1 ? "" : "s"}: ${summary.carrierNames.join(", ")}`
            : "Carrier unavailable on the displayed orders"
        }
      >
        {carrierLabel}
      </SummaryItem>

      <SummaryItem
        icon={<RevenueIcon />}
        tip={
          summary.revenueMicros === null
            ? "Revenue unavailable because at least one displayed order has no authoritative revenue"
            : `Total revenue across ${summary.orderCount.toLocaleString()} ${
                summary.orderCount === 1 ? "order" : "orders"
              }`
        }
      >
        {summary.revenueMicros === null
          ? "Revenue unavailable"
          : formatRevenue(summary.revenueMicros)}
        {summary.revenueMicros !== null ? (
          <span className="account-summary-unit">Revenue</span>
        ) : null}
      </SummaryItem>
    </span>
  );
}
