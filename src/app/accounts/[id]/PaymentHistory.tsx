"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CompanyCardIcon } from "./CompanySummaryCard";
import { LocalDateTime } from "@/components/LocalDateTime";
import {
  PAYMENT_PAGE_SIZE,
  type PaymentHistoryItem,
  type PaymentHistoryPage,
  type PaymentHistoryStatus,
} from "@/lib/company-detail-types";
import { parseRetryAfterMs } from "@/lib/http-retry";

/**
 * An empty loaded list is only trustworthy when no request error is showing.
 */
export function showNoLoadedPaymentRecords(
  loadedCount: number,
  error: string | null,
): boolean {
  return loadedCount === 0 && !error;
}

const STATUS: Record<
  PaymentHistoryStatus,
  { label: string; className: string }
> = {
  link_sent: {
    label: "Link Sent",
    className:
      "border-sky-600/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  processing: {
    label: "Processing",
    className:
      "border-amber-600/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  settled: {
    label: "Settled",
    className:
      "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className:
      "border-rose-600/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  returned: {
    label: "Returned",
    className:
      "border-rose-600/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  voided: {
    label: "Voided",
    className: "border-[var(--rule)] bg-[var(--sand)] text-[var(--muted)]",
  },
  refund_pending: {
    label: "Refund Pending",
    className:
      "border-amber-600/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  refunded: {
    label: "Refunded",
    className:
      "border-violet-600/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  refund_failed: {
    label: "Refund Failed",
    className:
      "border-rose-600/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  unknown: {
    label: "Status Unavailable",
    className: "border-[var(--rule)] bg-[var(--sand)] text-[var(--muted)]",
  },
};

function formatCurrencyAmount(
  amountCents: number | null,
  currency: string | null,
): string {
  if (amountCents === null || !currency) return "Amount unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

function formatAmount(item: PaymentHistoryItem): string {
  return formatCurrencyAmount(item.amountCents, item.currency);
}

function typeLabel(item: PaymentHistoryItem): string {
  if (item.type === "payment_link") return "Payment link";
  if (item.type === "refund") return "Refund";
  if (item.status === "settled") return "Settlement";
  return "Payment";
}

function statusIcon(status: PaymentHistoryStatus): string {
  if (status === "settled" || status === "refunded") return "✓";
  if (
    status === "failed" ||
    status === "returned" ||
    status === "refund_failed"
  ) {
    return "×";
  }
  if (status === "link_sent") return "↗";
  if (status === "voided") return "—";
  return "•";
}

function HistoryItemContent({ item }: { item: PaymentHistoryItem }) {
  const status = STATUS[item.status];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold tabular-nums text-[var(--ink)]">
            {formatAmount(item)}
          </p>
          {item.currency ? (
            <span className="text-[10px] font-semibold text-[var(--muted)]">
              {item.currency}
            </span>
          ) : null}
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}
          >
            <span aria-hidden="true">{statusIcon(item.status)}</span>
            {status.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {typeLabel(item)}
          {item.orderId ? ` · Order #${item.orderId}` : " · Order unavailable"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)] sm:justify-end">
        <LocalDateTime value={item.occurredAt} />
        <span className="font-mono">{item.safeReference}</span>
        {item.createdBy ? <span>By {item.createdBy}</span> : null}
      </div>
    </div>
  );
}

function PaymentDataState() {
  return (
    <p role="status" className="company-payment-data-state">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="company-payment-data-state-icon"
      >
        <circle cx="8" cy="8" r="5.75" />
        <path d="M8 4.75v3.5l2.35 1.4" />
      </svg>
      Showing the last available payment data.
    </p>
  );
}

export function PaymentHistory({
  companyId,
  initial,
}: {
  companyId: number;
  initial: PaymentHistoryPage | null;
}) {
  const [expanded, setExpanded] = useState(false);
  // Page metadata (total, stale flag) — recoverable client-side when the
  // server render could not load it.
  const [page, setPage] = useState<PaymentHistoryPage | null>(initial);
  const [items, setItems] = useState<PaymentHistoryItem[]>(
    initial?.items ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedOffset, setFailedOffset] = useState<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const fetchPageRef = useRef<
    (offset: number, allowAutoRetry?: boolean) => Promise<void>
  >(async () => {});
  const listId = useId();
  const total = page?.total ?? 0;

  const fetchPage = useCallback(
    async (offset: number, allowAutoRetry = true) => {
      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      setLoading(true);
      setError(null);
      setFailedOffset(null);
      try {
        const response = await fetch(
          `/api/accounts/${companyId}/payment-history?offset=${offset}&limit=${PAYMENT_PAGE_SIZE}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const retryDelay = allowAutoRetry
            ? parseRetryAfterMs(response.headers.get("Retry-After"))
            : null;
          if (retryDelay !== null) {
            setFailedOffset(offset);
            setError(
              "Live payment data is busy. Retrying automatically.",
            );
            setLoading(false);
            autoRetryTimerRef.current = window.setTimeout(() => {
              autoRetryTimerRef.current = null;
              void fetchPageRef.current(offset, false);
            }, retryDelay);
            return;
          }
          throw new Error("payment_history_request_failed");
        }
        const result = (await response.json()) as PaymentHistoryPage;
        setPage(result);
        setItems((current) => {
          const next = offset === 0 ? [] : [...current];
          const seen = new Set(next.map((item) => item.id));
          for (const item of result.items) {
            if (!seen.has(item.id)) next.push(item);
          }
          return next;
        });
        setLoading(false);
        return;
      } catch {
        setFailedOffset(offset);
        setError("Payment history is temporarily unavailable.");
        setLoading(false);
      }
    },
    [companyId],
  );

  useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(
    () => () => {
      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
      }
    },
    [],
  );

  // The server render could not load the preview: recover client-side instead
  // of leaving a permanently dead card. Deferred a tick so the effect never
  // sets state synchronously during mount.
  useEffect(() => {
    if (initial) return;
    const timer = window.setTimeout(() => void fetchPage(0), 0);
    return () => window.clearTimeout(timer);
  }, [initial, fetchPage]);

  async function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // The SSR preview already carries the full first page; only fetch when it
    // came up short (older snapshot or a mid-page write).
    if (total > 0 && items.length < Math.min(total, PAYMENT_PAGE_SIZE)) {
      await fetchPage(0);
    }
  }

  const settledCount = page?.settledCount ?? 0;
  const settledAmount = page
    ? formatCurrencyAmount(
        page.settledAmountCents,
        page.settledCurrency,
      )
    : "Amount unavailable";

  return (
    <section
      aria-labelledby={`${listId}-heading`}
      data-company-section="payment-history"
    >
      <div className="company-payment-heading">
        <div className="flex min-w-0 items-center gap-2.5">
          <CompanyCardIcon name="payment" />
          <div>
            <p className="company-section-eyebrow">Operational</p>
            <h2 id={`${listId}-heading`} className="company-section-title">
              Payment History
            </h2>
          </div>
        </div>
        {page && total > 0 ? (
          <span className="company-payment-count">
            {total.toLocaleString()} {total === 1 ? "record" : "records"}
          </span>
        ) : null}
      </div>

      <div className="company-payment-card">
        {!page ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <p className="text-sm text-[var(--muted)]" aria-live="polite">
              {loading
                ? "Loading payment history…"
                : (error ?? "Payment history is temporarily unavailable.")}
            </p>
            {!loading ? (
              <button
                type="button"
                onClick={() => void fetchPage(0)}
                className="rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : total === 0 ? (
          <div className="px-4 py-4">
            <p className="text-sm text-[var(--muted)]">
              {page.stale
                ? "No payment history in the last available data."
                : "No payment history."}
            </p>
            {page.stale ? (
              <div className="mt-2">
                <PaymentDataState />
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="company-payment-summary">
              <div className="min-w-0">
                <div className="company-payment-summary-label-row">
                  <p className="company-payment-summary-label">Total settled</p>
                  {page.stale ? <PaymentDataState /> : null}
                </div>
                <div className="company-payment-summary-value-row">
                  <p className="company-payment-summary-value">
                    {settledAmount}
                  </p>
                  {page.settledCurrency &&
                  page.settledAmountCents !== null ? (
                    <span className="company-payment-summary-currency">
                      {page.settledCurrency}
                    </span>
                  ) : null}
                  {settledCount > 0 ? (
                    <span className="company-payment-settled-count">
                      <span aria-hidden="true">✓</span>
                      {settledCount.toLocaleString()} settled
                    </span>
                  ) : null}
                </div>
                <p className="company-payment-summary-supporting">
                  {settledCount === 0
                    ? "No settled payments yet."
                    : `${settledCount.toLocaleString()} successful ${
                        settledCount === 1 ? "settlement" : "settlements"
                      } across this company.`}
                </p>
              </div>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                disabled={loading}
                onClick={() => void toggleExpanded()}
                className="company-payment-action"
              >
                <span>
                  {loading
                    ? "Loading payment history…"
                    : expanded
                      ? "Hide payment history"
                      : `View payment history (${total})`}
                </span>
                {!loading ? (
                  <span
                    aria-hidden="true"
                    className={`company-payment-action-chevron${
                      expanded
                        ? " company-payment-action-chevron--expanded"
                        : ""
                    }`}
                  >
                    ↓
                  </span>
                ) : null}
              </button>
            </div>

            {expanded ? (
              <div
                id={listId}
                className="company-payment-history-panel"
              >
                <div className="company-payment-history-toolbar">
                  <div>
                    <p className="company-payment-history-title">
                      Payment records
                    </p>
                    <p className="company-payment-history-subtitle">
                      Newest activity first
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-[var(--muted)]">
                    {items.length.toLocaleString()} of {total.toLocaleString()}{" "}
                    loaded
                  </span>
                </div>
                {items.length > 0 ? (
                  <ul className="company-payment-history-list">
                    {items.map((item) => (
                      <li key={item.id} className="company-payment-history-item">
                        <HistoryItemContent item={item} />
                      </li>
                    ))}
                  </ul>
                ) : showNoLoadedPaymentRecords(items.length, error) ? (
                  <p className="text-xs text-[var(--muted)]">
                    No payment records loaded.
                  </p>
                ) : null}
                {items.length < total ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void fetchPage(items.length)}
                    className="mt-4 text-xs font-semibold text-[var(--accent)] hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Load more
                  </button>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p
                aria-live="polite"
                className="px-4 pb-3 text-xs text-rose-600 dark:text-rose-300"
              >
                {error}
                {!loading && failedOffset !== null ? (
                  <button
                    type="button"
                    onClick={() => void fetchPage(failedOffset)}
                    className="ml-2 rounded border border-current/40 px-2 py-0.5 text-[11px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Retry
                  </button>
                ) : null}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
