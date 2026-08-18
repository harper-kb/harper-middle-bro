"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { BookOrderBindStatus } from "@/lib/supabase-book.server";
import type {
  OrderDetailBoundPolicy,
  OrderDetailResponse,
} from "@/lib/order-detail-types";
import { parseRetryAfterMs } from "@/lib/http-retry";

export const ORDER_DETAIL_REFRESH_MS = 5 * 60_000;

export interface OrderDrawerSelection {
  companyId: number;
  accountId: string;
  accountName: string;
  orderId: number;
  orderLabel: string;
  status: BookOrderBindStatus;
}

type OrderDrawerContextValue = {
  selection: OrderDrawerSelection | null;
  selectedKey: string | null;
  openOrder: (
    selection: OrderDrawerSelection,
    trigger: HTMLElement | null,
  ) => void;
  closeOrder: () => void;
};

const OrderDrawerContext = createContext<OrderDrawerContextValue>({
  selection: null,
  selectedKey: null,
  openOrder: () => {},
  closeOrder: () => {},
});

export function orderDrawerKey(
  selection: Pick<OrderDrawerSelection, "accountId" | "orderId">,
): string {
  return `${selection.accountId}:${selection.orderId}`;
}

export function useOrderDetailDrawer(): OrderDrawerContextValue {
  return useContext(OrderDrawerContext);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

type DetailViewState = {
  key: string;
  data: OrderDetailResponse | null;
  loading: boolean;
  error: string | null;
};

function useOrderDetailData(selection: OrderDrawerSelection) {
  const key = orderDrawerKey(selection);
  const [retry, setRetry] = useState(0);
  const autoRetryKeyRef = useRef<string | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<DetailViewState>({
    key,
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    if (autoRetryKeyRef.current !== key) autoRetryKeyRef.current = null;

    const load = async (showLoading: boolean) => {
      controller?.abort();
      controller = new AbortController();
      setState((current) => {
        const sameOrder = current.key === key;
        return {
          key,
          data: sameOrder ? current.data : null,
          loading: showLoading && (!sameOrder || current.data === null),
          error: null,
        };
      });
      try {
        const params = new URLSearchParams({
          companyId: String(selection.companyId),
          orderId: String(selection.orderId),
        });
        const response = await fetch(`/api/orders/detail?${params}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const result = (await response.json().catch(() => ({}))) as Partial<
          OrderDetailResponse & { error: string }
        >;
        if (!response.ok) {
          const retryDelay =
            autoRetryKeyRef.current === key
              ? null
              : parseRetryAfterMs(response.headers.get("Retry-After"));
          if (retryDelay !== null) {
            autoRetryKeyRef.current = key;
            autoRetryTimerRef.current = window.setTimeout(() => {
              autoRetryTimerRef.current = null;
              if (active) setRetry((value) => value + 1);
            }, retryDelay);
            throw new Error(
              "Live order detail is busy. Retrying automatically.",
            );
          }
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Order detail is temporarily unavailable.",
          );
        }
        if (result.orderId !== selection.orderId) {
          throw new Error("The order detail response did not match this order.");
        }
        if (!active) return;
        autoRetryKeyRef.current = null;
        setState({
          key,
          data: result as OrderDetailResponse,
          loading: false,
          error: null,
        });
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setState((current) => ({
          key,
          data: current.key === key ? current.data : null,
          loading: false,
          error:
            cause instanceof Error
              ? cause.message
              : "Order detail is temporarily unavailable.",
        }));
      }
    };

    void load(true);
    const interval = window.setInterval(
      () => void load(false),
      ORDER_DETAIL_REFRESH_MS,
    );
    return () => {
      active = false;
      controller?.abort();
      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      window.clearInterval(interval);
    };
  }, [key, retry, selection.companyId, selection.orderId]);

  return {
    state,
    retry: useCallback(() => {
      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      autoRetryKeyRef.current = null;
      setRetry((value) => value + 1);
    }, []),
  };
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.25 2.75h5.5l4 4v10.5H5.25V2.75Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M10.75 2.75v4h4M7.75 10h4.5M7.75 13h4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalViewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.25 3.25h3.5v3.5m-.25-3.25-5 5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 4.25H4.5c-.69 0-1.25.56-1.25 1.25v6c0 .69.56 1.25 1.25 1.25h6c.69 0 1.25-.56 1.25-1.25V9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InitialPaymentIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.25 6.25h13.5v9H3.25v-9Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M5.25 4.25h9.5M6.25 10.75h3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle
        cx="13.75"
        cy="10.75"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function PaymentTypeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.75"
        y="4.25"
        width="14.5"
        height="11.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M3.25 8h13.5M5.5 12.25h3.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HarperFeeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="7.25"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M7.25 6.75v6.5m5.5-6.5v6.5M7.5 9.25h5M7.5 11.75h5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PolicyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.75 15.5 5v4.5c0 3.7-2.2 6.05-5.5 7.75C6.7 15.55 4.5 13.2 4.5 9.5V5L10 2.75Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="m7.5 10 1.65 1.65 3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 4 8 8m0-8-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatCurrency(
  cents: number,
  currency = "USD",
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  }
}

function formatPolicyDate(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "Unavailable";
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
  );
}

function policyStatusLabel(value: string | null): string {
  const status = value?.trim().replace(/[_-]+/g, " ") || "Bound";
  return status.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

type FinancialCardTone = "payment" | "method" | "fee";

function FinancialCard({
  tone,
  label,
  value,
  supporting,
  unavailable = false,
}: {
  tone: FinancialCardTone;
  label: string;
  value: string;
  supporting?: ReactNode;
  unavailable?: boolean;
}) {
  const Icon =
    tone === "payment"
      ? InitialPaymentIcon
      : tone === "method"
        ? PaymentTypeIcon
        : HarperFeeIcon;

  return (
    <div
      className={`order-detail-financial-card order-detail-financial-card--${tone}`}
      data-order-detail-card={tone}
      data-value-state={unavailable ? "unavailable" : "available"}
    >
      <dt className="flex min-w-0 items-center gap-2.5">
        <span className="order-detail-icon-tile h-8 w-8 shrink-0">
          <span className="h-[18px] w-[18px]">
            <Icon />
          </span>
        </span>
        <span className="min-w-0 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-[var(--muted)]">
          {label}
        </span>
      </dt>
      <dd className="mt-3 min-w-0">
        <span
          className={`order-detail-financial-value ${
            unavailable ? "order-detail-financial-value--unavailable" : ""
          }`}
        >
          {value}
        </span>
        {supporting ? (
          <span className="order-detail-financial-supporting mt-1.5 block">
            {supporting}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function DrawerSkeleton({ showPolicies }: { showPolicies: boolean }) {
  return (
    <div
      className="order-detail-skeleton order-detail-content px-4 py-4 sm:px-5 sm:py-5"
      aria-busy="true"
      aria-label="Loading order detail"
    >
      <div className="order-detail-summary-grid">
        <div className="order-detail-quote-card">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--surface-subtle)] motion-reduce:animate-none" />
          <div className="min-w-0">
            <div className="h-2.5 w-24 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none" />
            <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none" />
            <div className="mt-2 h-2.5 w-14 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded-lg bg-[var(--surface-subtle)] motion-reduce:animate-none" />
        </div>
        <div className="order-detail-financial-grid">
          {[72, 56, 64].map((width, index) => (
            <div
              key={width}
              className={`order-detail-financial-card order-detail-financial-card--${
                index === 0 ? "payment" : index === 1 ? "method" : "fee"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 animate-pulse rounded-lg bg-[var(--surface-subtle)] motion-reduce:animate-none" />
                <div className="h-2.5 w-24 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none" />
              </div>
              <div
                style={{ width }}
                className="mt-4 h-5 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none"
              />
            </div>
          ))}
        </div>
        {showPolicies ? (
          <div>
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-[var(--surface-subtle)] motion-reduce:animate-none" />
              <div className="h-3 w-28 animate-pulse rounded bg-[var(--surface-subtle)] motion-reduce:animate-none" />
            </div>
            <div className="order-detail-policy-card mt-3 h-44 animate-pulse bg-[var(--surface-subtle)] motion-reduce:animate-none" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuoteCard({
  selection,
  data,
}: {
  selection: OrderDrawerSelection;
  data: OrderDetailResponse;
}) {
  const quoteHref = `/api/orders/quote?${new URLSearchParams({
    companyId: String(selection.companyId),
    orderId: String(selection.orderId),
  })}`;

  return (
    <section
      className="order-detail-quote-card"
      aria-labelledby="order-detail-quote-heading"
      data-value-state={data.quote ? "available" : "unavailable"}
    >
      <span className="order-detail-icon-tile h-10 w-10 shrink-0">
        <span className="h-5 w-5">
          <DocumentIcon />
        </span>
      </span>
      <div className="min-w-0">
        <h3
          id="order-detail-quote-heading"
          className="text-[10px] font-bold uppercase leading-4 tracking-[0.13em] text-[var(--muted)]"
        >
          Uploaded quote
        </h3>
        {data.quote ? (
          <>
            <p
              className="mt-1.5 truncate text-sm font-semibold text-[var(--ink)]"
              title={data.quote.fileName}
            >
              {data.quote.fileName}
            </p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              {data.quote.fileType}
            </p>
          </>
        ) : (
          <p className="order-detail-empty-value mt-2">No quote uploaded</p>
        )}
      </div>
      {data.quote?.canView ? (
        <a
          href={quoteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="order-detail-quote-action"
          aria-label={`View quote ${data.quote.fileName}`}
        >
          <span>View quote</span>
          <span className="h-4 w-4">
            <ExternalViewIcon />
          </span>
        </a>
      ) : null}
    </section>
  );
}

function FinancialSummary({ data }: { data: OrderDetailResponse }) {
  const initialPayment = data.initialPayment;
  return (
    <section aria-labelledby="order-detail-financial-heading">
      <h3 id="order-detail-financial-heading" className="sr-only">
        Order financial summary
      </h3>
      <dl className="order-detail-financial-grid">
        <FinancialCard
          tone="payment"
          label="Client initial payment"
          value={
            initialPayment
              ? formatCurrency(
                  initialPayment.amountCents,
                  initialPayment.currency,
                )
              : "No initial payment recorded"
          }
          unavailable={!initialPayment}
          supporting={
            initialPayment ? (
              <span className="order-detail-payment-status rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                {initialPayment.statusLabel}
              </span>
            ) : undefined
          }
        />
        <FinancialCard
          tone="method"
          label="Payment type"
          value={
            initialPayment?.method ??
            data.paymentPlan ??
            "Payment type unavailable"
          }
          unavailable={!initialPayment?.method && !data.paymentPlan}
          supporting={
            initialPayment?.method
              ? "Initial payment method"
              : data.paymentPlan
                ? "Order payment plan"
                : undefined
          }
        />
        <FinancialCard
          tone="fee"
          label="Harper fee"
          value={
            data.harperFeeCents === null
              ? "Harper fee unavailable"
              : formatCurrency(data.harperFeeCents)
          }
          unavailable={data.harperFeeCents === null}
          supporting={data.harperFeeCents === null ? undefined : "Order fee"}
        />
      </dl>
    </section>
  );
}

function PolicyFact({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "order-detail-policy-fact--wide" : ""}>
      <dt className="order-detail-policy-fact-label">{label}</dt>
      <dd className="order-detail-policy-fact-value">{children}</dd>
    </div>
  );
}

function BoundPolicyCard({
  policy,
  position,
}: {
  policy: OrderDetailBoundPolicy;
  position: number;
}) {
  const headingId = useId();
  const policyNumber = policy.policyNumber ?? "Policy number unavailable";
  return (
    <article
      className="order-detail-policy-card"
      aria-labelledby={headingId}
      data-bound-policy-deal={policy.dealId}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="order-detail-icon-tile h-9 w-9 shrink-0">
          <span className="h-5 w-5">
            <PolicyIcon />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="order-detail-policy-eyebrow">
            Policy {position + 1}
          </p>
          <h4
            id={headingId}
            className={`order-detail-policy-number ${
              policy.policyNumber
                ? ""
                : "order-detail-policy-number--unavailable"
            }`}
            title={policyNumber}
          >
            {policyNumber}
          </h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="order-detail-policy-status">
              {policyStatusLabel(policy.status)}
            </span>
            <span className="order-detail-policy-deal">
              Deal #{policy.dealId}
            </span>
          </div>
        </div>
      </div>

      {policy.coverageLabels.length > 0 ? (
        <ul className="order-detail-policy-coverages" aria-label="Coverage lines">
          {policy.coverageLabels.map((coverage) => (
            <li key={coverage}>{coverage}</li>
          ))}
        </ul>
      ) : (
        <p className="order-detail-policy-coverages-empty">
          Coverage unavailable
        </p>
      )}

      <dl className="order-detail-policy-facts">
        <PolicyFact label="Carrier" wide>
          <span title={policy.carrierName ?? undefined}>
            {policy.carrierName ?? "Unavailable"}
          </span>
        </PolicyFact>
        <PolicyFact label="Effective">
          {formatPolicyDate(policy.effectiveDate)}
        </PolicyFact>
        <PolicyFact label="Expires">
          {formatPolicyDate(policy.expirationDate)}
        </PolicyFact>
        <PolicyFact label="Premium">
          {policy.premiumCents === null
            ? "Unavailable"
            : formatCurrency(policy.premiumCents, policy.currency)}
        </PolicyFact>
        {policy.wholesalerName ? (
          <PolicyFact label="Wholesaler">
            <span title={policy.wholesalerName}>
              {policy.wholesalerName}
            </span>
          </PolicyFact>
        ) : null}
        {policy.boundAt ? (
          <PolicyFact label="Bound on" wide>
            <LocalDateTime value={policy.boundAt} />
          </PolicyFact>
        ) : null}
      </dl>
    </article>
  );
}

function BoundPolicySummary({
  policies,
}: {
  policies: OrderDetailBoundPolicy[];
}) {
  return (
    <section
      className="order-detail-policy-section"
      aria-labelledby="order-detail-policy-heading"
    >
      <div className="order-detail-policy-section-heading">
        <span className="order-detail-policy-section-icon">
          <span className="h-[18px] w-[18px]">
            <PolicyIcon />
          </span>
        </span>
        <div className="min-w-0">
          <h3 id="order-detail-policy-heading">Bound policies</h3>
          <p>Completed coverage attached to this order</p>
        </div>
        {policies.length > 0 ? (
          <span className="order-detail-policy-count">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
          </span>
        ) : null}
      </div>
      {policies.length > 0 ? (
        <div className="order-detail-policy-grid">
          {policies.map((policy, index) => (
            <BoundPolicyCard
              key={`${policy.dealId}:${policy.policyId ?? "deal"}`}
              policy={policy}
              position={index}
            />
          ))}
        </div>
      ) : (
        <div className="order-detail-policy-empty">
          <p>Bound policy details unavailable</p>
          <span>
            This order is marked Bound, but no active completed policy record
            was returned.
          </span>
        </div>
      )}
    </section>
  );
}

export function OrderDetailContent({
  selection,
  data,
  loading,
  error,
  onRetry,
}: {
  selection: OrderDrawerSelection;
  data: OrderDetailResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !data) {
    return <DrawerSkeleton showPolicies={selection.status === "bound"} />;
  }
  if (error && !data) {
    return (
      <div className="order-detail-content px-4 py-5 sm:px-5">
        <div
          role="alert"
          className="rounded-xl border border-[var(--rule)] bg-[var(--surface-subtle)] px-4 py-4"
        >
          <p className="text-sm font-semibold text-[var(--ink)]">
            Order detail unavailable
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div
      key={`${selection.accountId}:${data.orderId}`}
      className="order-detail-content px-4 py-4 sm:px-5 sm:py-5"
    >
      {data.stale ? (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 border-l-2 border-[var(--info)] pl-2.5 text-xs font-medium text-[var(--muted)]"
        >
          Showing the last available order detail while live data refreshes.
        </div>
      ) : null}
      <div className="order-detail-summary-grid">
        <QuoteCard selection={selection} data={data} />
        <FinancialSummary data={data} />
        {selection.status === "bound" ? (
          <BoundPolicySummary policies={data.boundPolicies ?? []} />
        ) : null}
      </div>

      {error ? (
        <div
          role="status"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--rule)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--muted)]"
        >
          <span>Live refresh paused.</span>
          <button
            type="button"
            onClick={onRetry}
            className="font-semibold text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status: BookOrderBindStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

function OrderDetailHeader({
  selection,
  titleId,
  descriptionId,
  closeRef,
  onClose,
}: {
  selection: OrderDrawerSelection;
  titleId: string;
  descriptionId: string;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <header
      className={`order-detail-drawer-header order-detail-drawer-header--${selection.status} shrink-0 px-4 py-4 sm:px-5`}
      data-order-status={selection.status}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Order
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h2
              id={titleId}
              className="min-w-0 truncate text-xl font-semibold tracking-[-0.025em] text-[var(--ink)]"
              title={selection.orderLabel}
            >
              {selection.orderLabel}
            </h2>
            <span
              className="order-detail-status-badge"
              aria-label={`Order status: ${statusLabel(selection.status)}`}
            >
              <span className="order-detail-status-dot" aria-hidden="true" />
              {statusLabel(selection.status)}
            </span>
          </div>
          <p
            id={descriptionId}
            className="mt-1.5 truncate text-xs leading-5 text-[var(--muted)]"
            title={selection.accountName}
          >
            {selection.accountName}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="order-detail-close-button"
          aria-label="Close order detail"
        >
          <span className="h-4 w-4">
            <CloseIcon />
          </span>
        </button>
      </div>
    </header>
  );
}

function OrderDetailDrawer({
  selection,
  onRestoreFocus,
  onClose,
}: {
  selection: OrderDrawerSelection;
  onRestoreFocus: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { state, retry } = useOrderDetailData(selection);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = focusableElements(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(onRestoreFocus);
    };
  }, [onClose, onRestoreFocus]);

  return (
    <div
      className="order-detail-drawer-backdrop fixed inset-0 z-[110]"
      data-order-detail-backdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="order-detail-drawer-panel absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden border-l border-[var(--rule)] bg-[var(--surface-raised)] shadow-[0_24px_70px_color-mix(in_srgb,var(--shadow-color)_55%,transparent)] sm:w-[min(40rem,94vw)] sm:rounded-l-[1.25rem]"
      >
        <OrderDetailHeader
          selection={selection}
          titleId={titleId}
          descriptionId={descriptionId}
          closeRef={closeRef}
          onClose={onClose}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <OrderDetailContent
            selection={selection}
            data={state.key === orderDrawerKey(selection) ? state.data : null}
            loading={
              state.key !== orderDrawerKey(selection) || state.loading
            }
            error={state.key === orderDrawerKey(selection) ? state.error : null}
            onRetry={retry}
          />
        </div>
      </div>
    </div>
  );
}

export function OrderDetailDrawerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<OrderDrawerSelection | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openOrder = useCallback(
    (next: OrderDrawerSelection, trigger: HTMLElement | null) => {
      openerRef.current = trigger;
      setSelection(next);
    },
    [],
  );
  const closeOrder = useCallback(() => setSelection(null), []);
  const restoreFocus = useCallback(() => openerRef.current?.focus(), []);
  const value = useMemo<OrderDrawerContextValue>(
    () => ({
      selection,
      selectedKey: selection ? orderDrawerKey(selection) : null,
      openOrder,
      closeOrder,
    }),
    [closeOrder, openOrder, selection],
  );

  return (
    <OrderDrawerContext.Provider value={value}>
      {children}
      {selection && typeof document !== "undefined"
        ? createPortal(
            <OrderDetailDrawer
              selection={selection}
              onRestoreFocus={restoreFocus}
              onClose={closeOrder}
            />,
            document.body,
          )
        : null}
    </OrderDrawerContext.Provider>
  );
}
