"use client";

import { useId, useState } from "react";
import { RichOrderCard } from "@/app/all-accounts/RichOrderCard";
import { OrderDetailDrawerProvider } from "@/components/orders/OrderDetailDrawer";
import type { BookOrderListItem } from "@/lib/db/queries/accounts";

const PREVIEW_COUNT = 6;

export function CompanyOrders({
  orders,
  accountId,
  accountName,
  canEditOrders,
  bigBrotherBaseUrl,
  todayDay,
}: {
  orders: BookOrderListItem[];
  accountId: string;
  accountName: string;
  canEditOrders: boolean;
  bigBrotherBaseUrl: string;
  todayDay: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? orders : orders.slice(0, PREVIEW_COUNT);
  // `orders` is the account's complete book order list (not a filtered view),
  // so "no order carries a snapshot Service Note" is a verified account-level
  // empty — the note cards can render it instantly.
  const accountServiceNotesEmpty = orders.every(
    (order) => !order.rich.serviceNote,
  );

  return (
    <OrderDetailDrawerProvider>
      <section aria-labelledby={`${listId}-heading`}>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2
              id={`${listId}-heading`}
              className="text-lg font-semibold text-[var(--ink)]"
            >
              Orders
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {orders.length === 1
                ? "1 eligible order"
                : `${orders.length.toLocaleString()} eligible orders`}
            </p>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="surface-card px-5 py-10 text-center">
            <p className="text-sm font-medium text-[var(--ink)]">
              No eligible orders
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              This company has no visible Bound, Pending, or Lost orders.
            </p>
          </div>
        ) : (
          <>
            <ul id={listId} className="space-y-3">
              {visible.map((order) => (
                <RichOrderCard
                  key={order.id}
                  order={order}
                  accountId={accountId}
                  accountName={accountName}
                  canEditOrders={canEditOrders}
                  bigBrotherBaseUrl={bigBrotherBaseUrl}
                  todayDay={todayDay}
                  deferNotes
                  accountServiceNotesEmpty={accountServiceNotesEmpty}
                />
              ))}
            </ul>
            {orders.length > PREVIEW_COUNT ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((value) => !value)}
                className="mt-4 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:border-[var(--accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {expanded
                  ? "Show fewer orders"
                  : `View all orders (${orders.length})`}
              </button>
            ) : null}
          </>
        )}
      </section>
    </OrderDetailDrawerProvider>
  );
}
