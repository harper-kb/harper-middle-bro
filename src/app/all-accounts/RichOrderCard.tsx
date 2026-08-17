"use client";

import { useEffect, useRef, useState } from "react";
import {
  orderDrawerKey,
  useOrderDetailDrawer,
} from "@/components/orders/OrderDetailDrawer";
import type { BookOrderListItem } from "@/lib/db";
import { BrokerGateRail } from "./BrokerGateRail";
import { OrderMetaChips } from "./OrderMetaChips";
import {
  OrderNoteThreads,
  type ProducerNotePreview,
} from "./OrderNoteThreads";
import { OrderActions } from "./order-actions/OrderActions";

const CARD_INTERACTIVE =
  'a,button,input,textarea,select,summary,[role="button"],[data-order-drawer-ignore]';

export function shouldOpenOrderFromCard(
  target: EventTarget | null,
  card: HTMLElement,
): boolean {
  if (!(target instanceof Node) || !card.contains(target)) return false;
  const element = target as { closest?: (selector: string) => Element | null };
  if (typeof element?.closest !== "function") return false;
  const interactive = element.closest(CARD_INTERACTIVE);
  return !interactive;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatUsd(cents: number | null, zero = "$0.00"): string {
  if (cents === null) return "—";
  if (cents === 0) return zero;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "orange" | "red" | "blue";
}) {
  const classes = {
    neutral:
      "border-[var(--rule)] bg-[var(--sand)]/45 text-[var(--muted)]",
    green:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    orange: "order-status-pending",
    red: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    blue: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${classes[tone]}`}
    >
      {children}
    </span>
  );
}

function MoneyCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${
          tone === "positive"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "negative"
              ? "text-rose-600 dark:text-rose-400"
              : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DeferredOrderNoteThreads({
  defer,
  accountId,
  accountName,
  orderId,
  orderLabel,
  canEditProducer,
  producerEditHref,
  producerNotePreview,
  accountServiceNotesEmpty,
}: {
  defer: boolean;
  accountId: string;
  accountName: string;
  orderId: number;
  orderLabel: string;
  canEditProducer: boolean;
  producerEditHref: string;
  producerNotePreview: ProducerNotePreview;
  accountServiceNotesEmpty?: boolean;
}) {
  const [ready, setReady] = useState(!defer);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ready || !defer) return;
    const node = sentinelRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      const timer = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [defer, ready]);

  if (ready) {
    return (
      <OrderNoteThreads
        accountId={accountId}
        accountName={accountName}
        orderId={orderId}
        orderLabel={orderLabel}
        canEditProducer={canEditProducer}
        producerEditHref={producerEditHref}
        producerNotePreview={producerNotePreview}
        accountServiceNotesEmpty={accountServiceNotesEmpty}
      />
    );
  }

  return (
    <div
      ref={sentinelRef}
      className="order-note-threads mt-3 grid gap-2 sm:grid-cols-2"
      aria-label={`Notes for ${orderLabel} load when visible`}
    >
      <div className="h-28 animate-pulse rounded-xl border border-[var(--rule)] bg-[var(--sand)]/25 motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl border border-[var(--rule)] bg-[var(--sand)]/25 motion-reduce:animate-none" />
    </div>
  );
}

export function RichOrderCard({
  order,
  accountId,
  accountName,
  canEditOrders,
  bigBrotherBaseUrl,
  todayDay,
  deferNotes = false,
  accountServiceNotesEmpty,
}: {
  order: BookOrderListItem;
  accountId: string;
  accountName: string;
  canEditOrders: boolean;
  bigBrotherBaseUrl: string;
  todayDay: string;
  /** Company lists defer note API work until the shared card nears view. */
  deferNotes?: boolean;
  /** Account-level verified "no Service Notes" — seeds the empty card instantly. */
  accountServiceNotesEmpty?: boolean;
}) {
  const { rich } = order;
  const drawer = useOrderDetailDrawer();
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const companyId = Number(accountId.replace(/^co-/, ""));
  const selection =
    Number.isSafeInteger(companyId) && companyId > 0
      ? {
          companyId,
          accountId,
          accountName,
          orderId: order.harperOrderId,
          orderLabel: order.label,
          status: order.bindStatus,
        }
      : null;
  const selected =
    selection !== null &&
    drawer.selectedKey === orderDrawerKey(selection);

  function openOrder(trigger: HTMLElement | null) {
    if (selection) drawer.openOrder(selection, trigger);
  }

  const carrierNames = [
    ...new Set(
      rich.deals
        .map((deal) => deal.carrierName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const wholesalerNames = [
    ...new Set(
      rich.deals
        .map((deal) => deal.wholesalerName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const paymentLabel =
    rich.paymentType === "financed"
      ? "Financed"
      : rich.paymentType === "full_pay" || rich.paymentType === "full"
        ? "Paid in Full"
        : null;
  const statusTone =
    order.bindStatus === "bound"
      ? "green"
      : order.bindStatus === "pending"
        ? "orange"
        : "red";
  const commission = rich.commissionRevenueCents;

  return (
    <li
      data-component="step-bro-order-card"
      data-order-id={order.harperOrderId}
      data-order-active={selected ? "true" : undefined}
      className={`step-bro-order-card rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-3 shadow-[0_1px_0_color-mix(in_srgb,var(--ink)_5%,transparent)] ${
        selected ? "step-bro-order-card--active" : ""
      }`}
      onClick={(event) => {
        if (!shouldOpenOrderFromCard(event.target, event.currentTarget)) return;
        openOrder(titleButtonRef.current);
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-sm font-semibold">
                <button
                  ref={titleButtonRef}
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`View details for ${order.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openOrder(event.currentTarget);
                  }}
                  className="order-detail-trigger rounded-sm text-left text-[var(--ink)] underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {order.label}
                </button>
              </h3>
              <Chip tone={statusTone}>
                {order.bindStatus[0].toUpperCase() + order.bindStatus.slice(1)}
              </Chip>
              {paymentLabel ? <Chip>{paymentLabel}</Chip> : null}
            </div>
            <OrderMetaChips
              source={order.source}
              bindStatus={order.bindStatus}
              revenueMicros={order.revenueMicros}
              createdAt={order.createdAt}
              todayDay={todayDay}
              brokerGate={order.brokerGate}
              brokerGateAt={order.brokerGateAt}
            />
          </div>

          {order.source === "broker" ? (
            <BrokerGateRail
              brokerGate={order.brokerGate}
              brokerGateAt={order.brokerGateAt}
            />
          ) : null}

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
            <span>{formatDate(rich.initialPaymentAt ?? order.orderedAt)}</span>
            <span>
              {rich.documentCount.toLocaleString()}{" "}
              {rich.documentCount === 1 ? "document" : "documents"}
            </span>
            <span>
              {rich.policyCount.toLocaleString()}{" "}
              {rich.policyCount === 1 ? "policy" : "policies"}
            </span>
            {carrierNames.length > 0 ? (
              <span>
                Carrier: {carrierNames.join(", ")}
                {wholesalerNames.length === 1
                  ? ` · via ${wholesalerNames[0]}`
                  : ""}
              </span>
            ) : null}
            {rich.initialPaymentAt ? (
              <span>first payment {formatDate(rich.initialPaymentAt)}</span>
            ) : null}
          </div>
        </div>

        <div data-order-drawer-ignore>
          <OrderActions
            order={order}
            accountId={accountId}
            accountName={accountName}
            canEditOrders={canEditOrders}
            bigBrotherBaseUrl={bigBrotherBaseUrl}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--rule)] pt-2.5 sm:grid-cols-5">
        <MoneyCell label="Premium" value={formatUsd(rich.totalPremiumCents)} />
        <MoneyCell label="Taxes" value={formatUsd(rich.taxesCents)} />
        <MoneyCell label="Fees" value={formatUsd(rich.feesCents)} />
        <MoneyCell label="Total" value={formatUsd(rich.totalCostCents)} />
        <MoneyCell
          label="Commission Δ"
          value={
            commission === null
              ? "—"
              : `${commission > 0 ? "+" : ""}${formatUsd(commission)}`
          }
          tone={
            commission === null
              ? undefined
              : commission > 0
                ? "positive"
                : commission < 0
                  ? "negative"
                  : undefined
          }
        />
      </div>

      <div data-order-drawer-ignore>
        <DeferredOrderNoteThreads
          defer={deferNotes}
          accountId={accountId}
          accountName={accountName}
          orderId={order.harperOrderId}
          orderLabel={order.label}
          canEditProducer={canEditOrders}
          producerEditHref={`${bigBrotherBaseUrl}/company/${accountId.replace(/^co-/, "")}/transaction?tab=orders`}
          producerNotePreview={{
            body: rich.producerNote,
            updatedAt: rich.producerNoteUpdatedAt,
            authorName: rich.producerNoteUpdatedByName,
          }}
          accountServiceNotesEmpty={accountServiceNotesEmpty}
        />
      </div>

      {rich.deals.length > 1 ? (
        <ul className="mt-2 space-y-1 border-t border-[var(--rule)] pt-2">
          {rich.deals.map((deal) => (
            <li
              key={deal.dealId}
              className="text-[11px] text-[var(--muted)]"
            >
              {[
                deal.carrierName ?? `Deal #${deal.dealId}`,
                deal.wholesalerName
                  ? `via ${deal.wholesalerName}`
                  : null,
                deal.dealStage,
                deal.premiumCents === null
                  ? null
                  : formatUsd(deal.premiumCents),
                deal.policyNumber ? `#${deal.policyNumber}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </li>
          ))}
        </ul>
      ) : null}

      {order.inconsistency ? (
        <p className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
          Data inconsistency: {order.inconsistency}
        </p>
      ) : null}

    </li>
  );
}
