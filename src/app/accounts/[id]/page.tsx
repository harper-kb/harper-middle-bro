import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CompanyDetailOverview } from "./CompanyDetailOverview";
import { CompanyOrders } from "./CompanyOrders";
import { CompanyCardIcon } from "./CompanySummaryCard";
import { PaymentHistory } from "./PaymentHistory";
import { Nav } from "@/components/Nav";
import { summarizeCompanyOrders } from "@/lib/company-detail";
import { PAYMENT_PAGE_SIZE } from "@/lib/company-detail-types";
import {
  loadCompanyOverview,
  loadPaymentHistory,
} from "@/lib/company-detail.server";
import {
  getAccountDetail,
  getBookAccountOrders,
} from "@/lib/db";
import { harperCalendarDay } from "@/lib/order-age";
import {
  bigBrotherBaseUrl,
  canEditOrders,
} from "@/lib/order-action-gates";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

function companyIdFromAccountId(accountId: string): number | null {
  const match = accountId.match(/^co-(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Payment history is the one load on this page that can still hit the live
 * Management API (through the durable stale-while-revalidate cache), so it
 * streams behind its own Suspense boundary instead of blocking the first
 * paint of a page that otherwise renders from local SQLite.
 */
async function CompanyPayments({ companyId }: { companyId: number }) {
  // Full first page, not just the latest event: same cost (one query, the
  // window total rides along), and it warms the exact cache key the client's
  // first expand reads — see PAYMENT_PAGE_SIZE.
  const initial = await loadPaymentHistory({
    companyId,
    offset: 0,
    limit: PAYMENT_PAGE_SIZE,
  }).catch((cause) => {
    console.warn("company_payment_preview_failed", {
      companyId,
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_payment_preview_error",
    });
    return null;
  });
  return (
    <PaymentHistory key={companyId} companyId={companyId} initial={initial} />
  );
}

function PaymentHistoryFallback() {
  return (
    <section aria-label="Payment History" data-company-section="payment-history">
      <div className="company-payment-heading">
        <div className="flex min-w-0 items-center gap-2.5">
          <CompanyCardIcon name="payment" />
          <div>
            <p className="company-section-eyebrow">Operational</p>
            <h2 className="company-section-title">Payment History</h2>
          </div>
        </div>
      </div>
      <div className="company-payment-card">
        <p className="px-4 py-4 text-sm text-[var(--muted)]" aria-live="polite">
          Loading payment history…
        </p>
      </div>
    </section>
  );
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, operator] = await Promise.all([
    params,
    getSessionOperator(),
  ]);
  if (!operator) notFound();
  const account = getAccountDetail(id);
  const companyId = companyIdFromAccountId(id);
  if (!account || !companyId) notFound();

  const orders = getBookAccountOrders(account.id);
  const summary = summarizeCompanyOrders(orders);

  // Once the book mirror has synced, this is a local SQLite read — the page
  // paints without waiting on any network call. Payment history streams in
  // separately (see CompanyPayments).
  const overview = await loadCompanyOverview(companyId).catch((cause) => {
    console.warn("company_overview_load_failed", {
      companyId,
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_company_overview_error",
    });
    return null;
  });
  const totalRevenueCents =
    summary.totalRevenueMicros === null
      ? null
      : Math.round(summary.totalRevenueMicros / 10_000);
  const companyName = overview?.name ?? account.name;
  const todayDay = harperCalendarDay(new Date())!;
  const editOrdersAllowed = canEditOrders(operator);
  const bigBrotherUrl = bigBrotherBaseUrl();

  return (
    <>
      <Nav active="/accounts" operator={operator} />
      <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
        <CompanyDetailOverview
          companyId={companyId}
          fallbackCompanyName={account.name}
          initialOverview={overview}
          paymentsSlot={
            <Suspense fallback={<PaymentHistoryFallback />}>
              <CompanyPayments companyId={companyId} />
            </Suspense>
          }
          source={summary.source}
          statusCounts={summary.statusCounts}
          totalPremiumCents={summary.totalPremiumCents}
          totalRevenueCents={totalRevenueCents}
          totalCommissionCents={summary.totalCommissionCents}
          totalHarperFeeCents={summary.totalHarperFeeCents}
        />

        <div className="mt-10">
          <CompanyOrders
            orders={summary.orders}
            accountId={account.id}
            accountName={companyName}
            canEditOrders={editOrdersAllowed}
            bigBrotherBaseUrl={bigBrotherUrl}
            todayDay={todayDay}
          />
        </div>
      </main>
    </>
  );
}
