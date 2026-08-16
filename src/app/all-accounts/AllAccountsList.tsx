"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { BookAccountListItem } from "@/lib/db";
import { AccountRowSummary } from "./AccountRowSummary";
import { PlainOrderRow } from "./PlainOrderRow";
import { RichOrderCard } from "./RichOrderCard";
import { AccountNotePreviews } from "./AccountNotePreviews";

function orderCountLabel(count: number): string {
  return count === 1 ? "1 order" : `${count.toLocaleString()} orders`;
}

export function AccountRow({
  account,
  richCards,
  canEditOrders,
  bigBrotherBaseUrl,
  todayDay,
  initiallyOpen = false,
}: {
  account: BookAccountListItem;
  richCards: boolean;
  canEditOrders: boolean;
  bigBrotherBaseUrl: string;
  todayDay: string;
  /** Preview/test seam; production rows remain collapsed on first render. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const panelId = useId();
  const canExpand = account.orderCount > 0;

  return (
    <li
      className={`account-list-row border-b border-[var(--rule)] last:border-b-0 ${
        open ? "account-list-row--open" : ""
      }`}
    >
      <div
        className={`account-list-row-header ${
          open ? "account-list-row-header--open" : ""
        }`}
      >
        <div className="account-list-row-main min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              {open ? (
                <span className="account-viewing-mark" aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none">
                    <path
                      d="M2 8s2-3.5 6-3.5S14 8 14 8s-2 3.5-6 3.5S2 8 2 8Z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <circle cx="8" cy="8" r="1.75" fill="currentColor" />
                  </svg>
                </span>
              ) : null}
              <Link
                href={`/accounts/${account.id}`}
                className="account-row-name font-semibold text-[var(--ink)] transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {account.name}
              </Link>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
              {orderCountLabel(account.orderCount)}
            </span>
            {open ? (
              <span className="account-viewing-label">
                Viewing account
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {account.dba ? `DBA ${account.dba} · ` : ""}
            {account.state || "—"}
          </p>
          <div className="mt-2">
            <AccountRowSummary orders={account.orders} todayDay={todayDay} />
          </div>
        </div>

        <div className="account-list-row-note">
          <AccountNotePreviews
            orders={account.orders}
            onReveal={canExpand && !open ? () => setOpen(true) : undefined}
          />
        </div>

        <button
          type="button"
          className={`account-expand-button ${open ? "account-expand-button--open" : ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          disabled={!canExpand}
          title={
            canExpand
              ? open
                ? "Hide orders"
                : "Show orders"
              : "No orders on this account"
          }
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M5 7.5 10 12.5 15 7.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">
            {open ? "Collapse orders" : "Expand orders"}
          </span>
        </button>
      </div>

      {open && canExpand ? (
        <div
          id={panelId}
          className="account-orders-panel border-t px-4 py-3"
        >
          <ul className="space-y-2">
            {account.orders.map((order) =>
              richCards ? (
                <RichOrderCard
                  key={order.id}
                  order={order}
                  accountId={account.id}
                  accountName={account.name}
                  canEditOrders={canEditOrders}
                  bigBrotherBaseUrl={bigBrotherBaseUrl}
                  todayDay={todayDay}
                />
              ) : (
                <PlainOrderRow
                  key={order.id}
                  order={order}
                  accountId={account.id}
                  accountName={account.name}
                  canEditOrders={canEditOrders}
                  bigBrotherBaseUrl={bigBrotherBaseUrl}
                  todayDay={todayDay}
                />
              ),
            )}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function AllAccountsList({
  rows,
  emptyMessage,
  richCards = false,
  canEditOrders = false,
  bigBrotherBaseUrl = "",
  todayDay,
}: {
  rows: BookAccountListItem[];
  emptyMessage: string;
  richCards?: boolean;
  canEditOrders?: boolean;
  bigBrotherBaseUrl?: string;
  /** Harper-timezone calendar day, resolved on the server for stable ages. */
  todayDay: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--rule)]">
      {rows.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          richCards={richCards}
          canEditOrders={canEditOrders}
          bigBrotherBaseUrl={bigBrotherBaseUrl}
          todayDay={todayDay}
        />
      ))}
    </ul>
  );
}
