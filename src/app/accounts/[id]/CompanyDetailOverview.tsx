"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BackToAccounts } from "./BackToAccounts";
import { ContactsCard } from "./ContactsCard";
import { CustomerLocalTime } from "./CustomerLocalTime";
import {
  CompanyCardIcon,
  CompanySummaryCard,
} from "./CompanySummaryCard";
import { OrderSourceBadge } from "@/app/all-accounts/OrderMetaChips";
import { CopyButton } from "@/components/CopyButton";
import type { OrderSource } from "@/lib/account-source";
import type { CompanyOverview } from "@/lib/company-detail-types";
import type { BookOrderBindStatus } from "@/lib/supabase-book.server";

export const COMPANY_OVERVIEW_REFRESH_MS = 5 * 60_000;

type OverviewState = {
  key: string;
  overview: CompanyOverview | null;
  error: string | null;
};

export type CompanyHeaderTone = BookOrderBindStatus | "neutral";

export function companyHeaderTone(
  counts: Record<BookOrderBindStatus, number>,
): CompanyHeaderTone {
  if (counts.pending > 0) return "pending";
  if (counts.bound > 0) return "bound";
  if (counts.lost > 0) return "lost";
  return "neutral";
}

function usePinnedCompanyHeader(
  headerRef: RefObject<HTMLElement | null>,
  sentinelRef: RefObject<HTMLDivElement | null>,
): boolean {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    const sentinel = sentinelRef.current;
    if (!header || !sentinel) return;
    const bars = [
      ...document.querySelectorAll<HTMLElement>(".desk-sticky-header"),
    ];
    let offset = -1;
    let crossing: IntersectionObserver | null = null;

    const sync = () => {
      const visible = bars.find((bar) => bar.offsetHeight > 0);
      const next = visible
        ? Math.round(
            (Number.parseFloat(getComputedStyle(visible).top) || 0) +
              visible.offsetHeight,
          )
        : 0;
      if (next === offset) return;
      offset = next;
      header.style.setProperty("--company-header-offset", `${offset}px`);
      crossing?.disconnect();
      if (typeof IntersectionObserver === "undefined") return;
      crossing = new IntersectionObserver(
        ([entry]) => setPinned(!entry.isIntersecting),
        { threshold: 0, rootMargin: `-${offset}px 0px 0px 0px` },
      );
      crossing.observe(sentinel);
    };

    sync();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    for (const bar of bars) resize?.observe(bar);
    window.addEventListener("resize", sync);
    return () => {
      crossing?.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [headerRef, sentinelRef]);

  return pinned;
}

function formatUsd(cents: number | null): string {
  if (cents === null) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function producerInitials(name: string): string {
  const letters = name
    .split(/[\s.-]+/)
    .map((part) => part.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  if (letters.length === 0) return "P";
  return (
    letters.length === 1
      ? letters[0]!
      : `${letters[0]!}${letters[letters.length - 1]!}`
  ).toUpperCase();
}

function locationLines(overview: CompanyOverview | null): string[] {
  if (!overview) return [];
  const { address1, address2, city, state, postalCode } = overview.location;
  const cityState = [
    city,
    [state, postalCode].filter(Boolean).join(" ") || null,
  ]
    .filter(Boolean)
    .join(", ");
  return [address1, address2, cityState || null].filter(
    (line): line is string => Boolean(line),
  );
}

function DealStateCounts({
  counts,
}: {
  counts: Record<BookOrderBindStatus, number>;
}) {
  const statuses = [
    { id: "bound", label: "Bound", count: counts.bound },
    { id: "pending", label: "Pending", count: counts.pending },
    { id: "lost", label: "Lost", count: counts.lost },
  ].filter((status) => status.count > 0);

  return (
    <span className="company-deal-counts">
      {statuses.map((status, index) => (
        <span
          key={status.id}
          className={`company-deal-count company-deal-count--${status.id}`}
        >
          {index > 0 ? (
            <span aria-hidden="true" className="text-[var(--muted)]">
              ·
            </span>
          ) : null}
          <span className="company-deal-count-dot" aria-hidden="true" />
          {status.count.toLocaleString()} {status.label}{" "}
          {status.count === 1 ? "deal" : "deals"}
        </span>
      ))}
    </span>
  );
}

export function CompanyIdCard({ companyId }: { companyId: number }) {
  const displayId = `#${companyId}`;
  return (
    <aside className="company-id-card" aria-label={`Company ID ${displayId}`}>
      <CompanyCardIcon name="company-id" />
      <span className="min-w-0">
        <span className="company-id-label">Company ID</span>
        <span className="company-id-value">{displayId}</span>
      </span>
      <CopyButton
        value={String(companyId)}
        label={`Copy company ID ${displayId}`}
        successMessage="Company ID copied"
      />
    </aside>
  );
}

function RevenueBreakdown({
  totalRevenueCents,
  commissionCents,
  harperFeeCents,
}: {
  totalRevenueCents: number | null;
  commissionCents: number | null;
  harperFeeCents: number | null;
}) {
  if (commissionCents === null || harperFeeCents === null) return null;
  const reconciles =
    totalRevenueCents !== null &&
    commissionCents + harperFeeCents === totalRevenueCents;
  return (
    <div className="company-revenue-breakdown">
      <p className="company-card-supporting">
        <span className="font-semibold tabular-nums text-[var(--ink)]">
          {formatUsd(commissionCents)}
        </span>{" "}
        Commission
        <span className="mx-1.5 opacity-50" aria-hidden="true">
          +
        </span>
        <span className="font-semibold tabular-nums text-[var(--ink)]">
          {formatUsd(harperFeeCents)}
        </span>{" "}
        Harper fee
      </p>
      {!reconciles ? (
        <p className="mt-1.5 text-[11px] text-[var(--warning)]">
          Recorded components differ from the stored revenue total.
        </p>
      ) : null}
    </div>
  );
}

export function CompanyDetailOverview({
  companyId,
  fallbackCompanyName,
  initialOverview,
  paymentsSlot,
  source,
  statusCounts,
  totalPremiumCents,
  totalRevenueCents,
  totalCommissionCents,
  totalHarperFeeCents,
  recordsReturnHref,
}: {
  companyId: number;
  fallbackCompanyName: string;
  initialOverview: CompanyOverview | null;
  /**
   * Payment history, streamed from the server behind its own Suspense
   * boundary so the (potentially slow, live) payments query never blocks the
   * first paint of a page that otherwise renders from local data.
   */
  paymentsSlot: ReactNode;
  source: OrderSource | null;
  statusCounts: Record<BookOrderBindStatus, number>;
  totalPremiumCents: number | null;
  totalRevenueCents: number | null;
  totalCommissionCents: number | null;
  totalHarperFeeCents: number | null;
  recordsReturnHref?: string | null;
}) {
  const initialKey = `${companyId}:${initialOverview?.fetchedAt ?? "missing"}`;
  const headerRef = useRef<HTMLDivElement>(null);
  const headerSentinelRef = useRef<HTMLDivElement>(null);
  const headerPinned = usePinnedCompanyHeader(headerRef, headerSentinelRef);
  const headerTone = companyHeaderTone(statusCounts);
  const [state, setState] = useState<OverviewState>(() => ({
    key: initialKey,
    overview: initialOverview,
    error: null,
  }));
  const overview = state.key === initialKey ? state.overview : initialOverview;
  const refreshError = state.key === initialKey ? state.error : null;

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/accounts/${companyId}/overview`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("company_overview_request_failed");
        const result = (await response.json()) as CompanyOverview;
        if (result.companyId !== companyId) {
          throw new Error("company_overview_response_mismatch");
        }
        if (!active) return;
        setState({ key: initialKey, overview: result, error: null });
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setState((current) => ({
          key: initialKey,
          overview:
            current.key === initialKey ? current.overview : initialOverview,
          error:
            cause instanceof Error
              ? cause.message
              : "company_overview_request_failed",
        }));
      }
    };
    const initialTimer =
      initialOverview === null
        ? window.setTimeout(() => void load(), 0)
        : null;
    const interval = window.setInterval(
      () => void load(),
      COMPANY_OVERVIEW_REFRESH_MS,
    );
    return () => {
      active = false;
      controller?.abort();
      if (initialTimer !== null) window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [companyId, initialKey, initialOverview]);

  const companyName = overview?.name ?? fallbackCompanyName;
  const address = locationLines(overview);

  return (
    <>
      <div
        ref={headerSentinelRef}
        className="company-page-header-sentinel"
        aria-hidden="true"
      />
      <div
        ref={headerRef}
        className="company-page-sticky-region"
      >
        <div className="company-page-back-row">
          <BackToAccounts returnHref={recordsReturnHref} />
        </div>
        <header
          className={`company-page-header company-page-header--${headerTone}${
          headerPinned ? " company-page-header--pinned" : ""
        }`}
          data-company-header-tone={headerTone}
        >
          <div className="min-w-0">
            <p className="eyebrow">Company</p>
            <h1
              className="company-page-title"
              title={companyName}
            >
              {companyName}
            </h1>
            {overview?.dba &&
            overview.dba.toLowerCase() !== overview.name.toLowerCase() ? (
              <p className="mt-1 text-sm text-[var(--muted)]">
                DBA {overview.dba}
              </p>
            ) : null}
            <div className="company-page-meta">
              <OrderSourceBadge source={source} />
              <DealStateCounts counts={statusCounts} />
            </div>
            {overview?.stale ? (
              <p className="mt-2 text-xs text-[var(--warning)]">
                Overview data may be stale.
              </p>
            ) : null}
            <p className="sr-only" role="status" aria-live="polite">
              {refreshError ? "Company details refresh paused." : ""}
            </p>
          </div>
          <CompanyIdCard companyId={companyId} />
        </header>
      </div>

      <div className="mt-5">{paymentsSlot}</div>

      <div className="company-summary-grid">
        <CompanySummaryCard tone="producer" label="Producer">
          {overview ? (
            overview.producer ? (
              <div className="flex min-w-0 items-center gap-3">
                <span className="company-producer-avatar" aria-hidden="true">
                  {producerInitials(overview.producer.name)}
                </span>
                <span className="min-w-0">
                  <span
                    className="company-card-primary block truncate"
                    title={overview.producer.name}
                  >
                    {overview.producer.name}
                  </span>
                  <span className="company-card-meta block tabular-nums">
                    Producer #{overview.producer.id}
                  </span>
                </span>
              </div>
            ) : (
              <p className="company-card-empty">Unassigned producer</p>
            )
          ) : (
            <p className="company-card-empty">
              Producer temporarily unavailable.
            </p>
          )}
        </CompanySummaryCard>

        <CustomerLocalTime
          companyId={companyId}
          location={
            overview?.location ?? {
              address1: null,
              address2: null,
              city: null,
              state: null,
              stateCode: null,
              postalCode: null,
              country: null,
            }
          }
          timeZone={
            overview?.timeZone ?? {
              id: null,
              source: null,
              unavailableReason: "stored_timezone_missing",
            }
          }
        />

        <CompanySummaryCard
          tone="location"
          label="Location"
          action={
            address.length > 0 ? (
              <CopyButton
                value={address.join("\n")}
                label="Copy company address"
                successMessage="Address copied"
              />
            ) : undefined
          }
        >
          {!overview ? (
            <p className="company-card-empty">
              Location temporarily unavailable.
            </p>
          ) : address.length === 0 ? (
            <p className="company-card-empty">No primary location on file.</p>
          ) : (
            <address
              className="space-y-1 not-italic"
              title={address.join(", ")}
            >
              {address.map((line) => (
                <p key={line} className="company-card-primary leading-5">
                  {line}
                </p>
              ))}
            </address>
          )}
        </CompanySummaryCard>

        {overview ? (
          <ContactsCard contacts={overview.contacts} />
        ) : (
          <CompanySummaryCard tone="contacts" label="Contacts">
            <p className="company-card-empty">
              Contacts temporarily unavailable.
            </p>
          </CompanySummaryCard>
        )}

        <CompanySummaryCard
          tone="premium"
          label="Total premium"
          help="Sum of orders_temp.total_premium across this company's visible Bound, Pending, and Lost orders. Taxes and fees are excluded; unavailable if any order is missing premium."
        >
          <p className="company-metric-value">
            {formatUsd(totalPremiumCents)}
          </p>
        </CompanySummaryCard>

        <CompanySummaryCard
          tone="revenue"
          label="Total revenue"
          help="Sum of Step Bro's authoritative orders_temp.total_revenue values at unique order grain. It is not recomputed from premium, payments, commission, or fees; unavailable if any order is missing revenue."
        >
          <div className="company-revenue-row">
            <p className="company-metric-value">
              {formatUsd(totalRevenueCents)}
            </p>
            <RevenueBreakdown
              totalRevenueCents={totalRevenueCents}
              commissionCents={totalCommissionCents}
              harperFeeCents={totalHarperFeeCents}
            />
          </div>
        </CompanySummaryCard>
      </div>
    </>
  );
}
