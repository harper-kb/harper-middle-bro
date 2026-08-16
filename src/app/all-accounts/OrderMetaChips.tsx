"use client";

import { useId } from "react";
import { ORDER_SOURCE_LABELS, type OrderSource } from "@/lib/account-source";
import { brokerGateView } from "@/lib/broker-gate";
import {
  dealAgeDays,
  dealAgeLabel,
  dealAgeNeedsAttention,
  harperTimestampLabel,
} from "@/lib/order-age";

const SOURCE_META: Record<OrderSource, { tip: string; tone: string }> = {
  iq: {
    tip: "IQ account — every deal on this order is an instant quote",
    tone: "meta-chip--iq",
  },
  broker: {
    tip: "Broker account — no instant-quote deals on this order",
    tone: "meta-chip--broker",
  },
  // Authoritative third state: forcing it into IQ or Broker would contradict
  // the filter, which shows mixed accounts only under All.
  mixed: {
    tip: "Mixed account — this order carries both instant-quote and broker deals",
    tone: "meta-chip--broker",
  },
};

function IqIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="meta-chip-icon">
      <path d="M7 1 2.5 6.75h2.25L4.75 11 9.5 5h-2.4z" fill="currentColor" />
    </svg>
  );
}

function BrokerIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="meta-chip-icon">
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

function UnknownIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="meta-chip-icon">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.75 6h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

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

/**
 * Source / revenue / deal-age metadata shown on every order preview, in All
 * Accounts and in the Pending, Bound and Lost views. Broker Gate is display-only
 * and appears only when the order source is Broker.
 *
 * `todayDay` is the Harper-timezone calendar day resolved once on the server so
 * the age a visitor sees cannot drift between the server render and hydration.
 */
export function OrderMetaChips({
  source,
  revenueMicros,
  createdAt,
  todayDay,
  brokerGate = null,
  brokerGateAt = null,
}: {
  source: OrderSource | null;
  revenueMicros: number | null;
  createdAt: string | null;
  todayDay: string;
  brokerGate?: string | null;
  brokerGateAt?: string | null;
}) {
  const revenue = formatRevenue(revenueMicros);
  const ageDays = dealAgeDays(createdAt, todayDay);
  const createdStamp = harperTimestampLabel(createdAt);
  const attention = ageDays !== null && dealAgeNeedsAttention(ageDays);
  const showGate = source === "broker";
  const gate = showGate ? brokerGateView(brokerGate, brokerGateAt) : null;

  return (
    <span className="meta-chips">
      {source ? (
        <MetaChip
          tone={SOURCE_META[source].tone}
          icon={source === "iq" ? <IqIcon /> : <BrokerIcon />}
          tip={SOURCE_META[source].tip}
        >
          {ORDER_SOURCE_LABELS[source]}
        </MetaChip>
      ) : (
        <MetaChip
          icon={<UnknownIcon />}
          tip="Source unavailable — this order carries no deals to classify as IQ or Broker"
        >
          Source unavailable
        </MetaChip>
      )}

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

      {ageDays === null ? (
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
      )}
    </span>
  );
}
