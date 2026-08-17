"use client";

import { useId } from "react";
import {
  sourceLabel,
  sourceTone,
  SOURCE_DESCRIPTIONS,
  type OrderSource,
} from "@/lib/account-source";
import { SourceIcon } from "@/components/SourceIdentity";
import { brokerGateView } from "@/lib/broker-gate";
import {
  dealAgeDays,
  dealAgeLabel,
  dealAgeNeedsAttention,
  harperTimestampLabel,
} from "@/lib/order-age";
import type { BookOrderBindStatus } from "@/lib/supabase-book.server";

function AttentionIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="meta-chip-icon">
      <path
        d="M6 1.5 11 10.5H1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M6 5v2.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="9" r="0.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Chip with a tooltip on both hover and keyboard focus. The description lives
 * in a real element rather than a `title`, which browsers never surface to
 * keyboard users; `aria-describedby` ties it to the focusable chip.
 */
function MetaChip({
  tone,
  icon,
  children,
  tip,
}: {
  tone?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  tip?: string;
}) {
  const tipId = useId();
  return (
    <span
      className={`meta-chip ${tone ?? ""}`}
      tabIndex={tip ? 0 : undefined}
      aria-describedby={tip ? tipId : undefined}
    >
      {icon}
      {children}
      {tip ? (
        <span className="meta-tip" role="tooltip" id={tipId}>
          {tip}
        </span>
      ) : null}
    </span>
  );
}

function formatRevenue(revenueMicros: number | null): string | null {
  if (revenueMicros === null) return null;
  // Micros are a six-place fixed-point copy of orders_temp.total_revenue, so
  // integer cents come out exactly; the round only guards float division.
  const cents = Math.round(revenueMicros / 10_000);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Shared IQ/Broker/Mixed source mark used by order cards and company headers. */
export function OrderSourceBadge({
  source,
}: {
  source: OrderSource | null;
}) {
  const tone = sourceTone(source);
  return (
    <MetaChip
      tone={`meta-chip--${tone}`}
      icon={<SourceIcon source={source} className="meta-chip-icon" />}
      tip={SOURCE_DESCRIPTIONS[tone]}
    >
      {sourceLabel(source)}
    </MetaChip>
  );
}

/**
 * Source / revenue metadata shown on every order preview. Deal age is active
 * work metadata and is omitted once an order is Bound. Broker Gate is
 * display-only and appears only when the order source is Broker.
 *
 * `todayDay` is the Harper-timezone calendar day resolved once on the server so
 * the age a visitor sees cannot drift between the server render and hydration.
 */
export function OrderMetaChips({
  source,
  bindStatus,
  revenueMicros,
  createdAt,
  todayDay,
  brokerGate = null,
  brokerGateAt = null,
}: {
  source: OrderSource | null;
  bindStatus: BookOrderBindStatus;
  revenueMicros: number | null;
  createdAt: string | null;
  todayDay: string;
  brokerGate?: string | null;
  brokerGateAt?: string | null;
}) {
  const revenue = formatRevenue(revenueMicros);
  const showAge = bindStatus !== "bound";
  const ageDays = showAge ? dealAgeDays(createdAt, todayDay) : null;
  const createdStamp = showAge ? harperTimestampLabel(createdAt) : null;
  const attention = ageDays !== null && dealAgeNeedsAttention(ageDays);
  const showGate = source === "broker";
  const gate = showGate ? brokerGateView(brokerGate, brokerGateAt) : null;

  return (
    <span className="meta-chips">
      <OrderSourceBadge source={source} />

      {showGate ? (
        gate ? (
          <MetaChip
            tone="meta-chip--gate"
            tip={`${gate.gate} — ${gate.label}${
              gate.at && !Number.isNaN(new Date(gate.at).getTime())
                ? ` · ${new Date(gate.at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""
            }`}
          >
            <span className="meta-chip-value">{gate.gate}</span>
            <span className="meta-chip--gate-label">{gate.label}</span>
          </MetaChip>
        ) : (
          <MetaChip tone="meta-chip--gate meta-chip--gate-missing">
            Gate unavailable
          </MetaChip>
        )
      ) : null}

      {revenue !== null ? (
        <MetaChip>
          <span className="meta-chip-value">{revenue}</span>
          <span className="meta-chip-unit">Revenue</span>
        </MetaChip>
      ) : (
        <MetaChip tip="Revenue unavailable — orders_temp.total_revenue is not set on this order">
          Revenue unavailable
        </MetaChip>
      )}

      {showAge ? (
        ageDays === null ? (
          <MetaChip tip="Deal age unavailable — no creation timestamp on this order">
            Age unavailable
          </MetaChip>
        ) : (
          <MetaChip
            tone={attention ? "meta-chip--attention" : undefined}
            icon={attention ? <AttentionIcon /> : undefined}
            tip={
              attention
                ? `Needs attention — deal created ${dealAgeLabel(ageDays).toLowerCase()} ago${
                    createdStamp ? ` (${createdStamp})` : ""
                  }`
                : createdStamp
                  ? `Deal created ${createdStamp}`
                  : undefined
            }
          >
            <span className="meta-chip-value">{dealAgeLabel(ageDays)}</span>
          </MetaChip>
        )
      ) : null}
    </span>
  );
}
