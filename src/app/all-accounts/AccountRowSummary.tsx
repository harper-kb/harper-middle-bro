"use client";

import { useId } from "react";
import {
  sourceLabel as formatSourceLabel,
  sourceTone,
} from "@/lib/account-source";
import { SourceIcon } from "@/components/SourceIdentity";
import {
  ACCOUNT_STATE_LABELS,
  stageText,
  type AccountRowModel,
  type AccountRowState,
} from "@/lib/account-row-model";
import { dealAgeLabel, harperTimestampLabel } from "@/lib/order-age";

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
  tone?: "iq" | "broker" | "attention";
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

/**
 * Compact state badge beside the account name. Colours are the same tokens the
 * expanded order card uses, so a row and the card it opens never disagree.
 */
export function AccountStateBadge({ state }: { state: AccountRowState }) {
  return (
    <span className={`account-state-badge account-state-badge--${state}`}>
      {ACCOUNT_STATE_LABELS[state]}
    </span>
  );
}

/**
 * Stage and order-count line. The stage is omitted entirely — not faked — when
 * the representative order is mixed-source or unclassified.
 */
export function AccountRowStageLine({ model }: { model: AccountRowModel }) {
  return (
    <p className="account-stage-line">
      {model.stage ? (
        <>
          <span className="account-stage-prefix">{model.stage.prefix}:</span>
          {model.stage.code ? (
            <span className="account-stage-code">{model.stage.code}</span>
          ) : null}
          <span
            className={`account-stage-value${
              model.stage.set ? "" : " account-stage-value--unset"
            }`}
            title={stageText(model.stage)}
          >
            {model.stage.value}
          </span>
          <span className="account-stage-dot" aria-hidden="true" />
        </>
      ) : null}
      <span className="account-stage-count">{model.countLabel}</span>
    </p>
  );
}

export function AccountRowSummary({ model }: { model: AccountRowModel }) {
  const summary = model;
  const sourceLabel = formatSourceLabel(summary.source);
  // Only the two authoritative books carry a source tint; mixed and
  // unavailable stay in the row's neutral metadata voice.
  const tone = sourceTone(summary.source);
  const sourceTint = tone === "iq" || tone === "broker" ? tone : undefined;
  const carrierLabel =
    summary.carrierNames.length === 0
      ? "Carrier unavailable"
      : summary.carrierNames.length === 1
        ? summary.carrierNames[0]
        : `${summary.carrierNames.length} carriers`;
  const ageAttention = summary.ageAttention;
  const ageLabel =
    summary.ageDays === null ? null : `${dealAgeLabel(summary.ageDays)} ago`;
  const stamp = harperTimestampLabel(summary.representative?.createdAt ?? null);

  return (
    <span className="account-summary" aria-label="Account order summary">
      <SummaryItem
        icon={
          <SourceIcon
            source={summary.source}
            className="account-summary-icon"
          />
        }
        tone={sourceTint}
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

      {/* Pending work only. A bound or lost row renders no age element at all,
          so there is never an orphan divider where a date used to be. */}
      {ageLabel !== null ? (
        <SummaryItem
          icon={<ClockIcon attention={ageAttention} />}
          tone={ageAttention ? "attention" : undefined}
          tip={
            ageAttention
              ? `Needs attention — pending order created ${ageLabel}${stamp ? ` (${stamp})` : ""}`
              : `Pending order created ${ageLabel}${stamp ? ` (${stamp})` : ""}`
          }
        >
          {ageLabel}
        </SummaryItem>
      ) : null}

      <SummaryItem
        icon={<CarrierIcon />}
        tip={
          summary.carrierNames.length > 0
            ? `Carrier${summary.carrierNames.length === 1 ? "" : "s"} on ${summary.representative?.label ?? "this order"}: ${summary.carrierNames.join(", ")}`
            : "No carrier named on the representative order"
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
