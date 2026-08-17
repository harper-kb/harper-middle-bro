"use client";

import Link from "next/link";
import { memo, useCallback, useId, useMemo, useRef } from "react";
import type { BookAccountListItem } from "@/lib/db";
import { buildAccountRowModel } from "@/lib/account-row-model";
import {
  AccountRowStageLine,
  AccountRowSummary,
  AccountStateBadge,
} from "./AccountRowSummary";
import { RichOrderCard } from "./RichOrderCard";
import { AccountNotePreviews } from "./AccountNotePreviews";
import {
  accountRowPanelActive,
  accountRowPanelMounted,
  accountRowPreviewsActive,
  accountRowPreviewsMounted,
  useAccountRowPhase,
} from "./use-account-row-transition";
import {
  isAccountDeemphasized,
  type ExpandedAccountIds,
} from "./use-account-expansion";

const HEADER_INTERACTIVE =
  'a,button,input,textarea,select,summary,[role="button"],[data-account-toggle-ignore]';

/**
 * Whether a click landed on the row's own surface rather than on something
 * that already means something else — the account link, the chevron, or a
 * note preview, each of which keeps its own behaviour. Mirrors the order
 * card's `shouldOpenOrderFromCard` so both surfaces answer this the same way.
 */
export function shouldToggleAccountFromHeader(
  target: EventTarget | null,
  header: HTMLElement,
): boolean {
  if (!(target instanceof Node) || !header.contains(target)) return false;
  const element = target as { closest?: (selector: string) => Element | null };
  if (typeof element?.closest !== "function") return false;
  return !element.closest(HEADER_INTERACTIVE);
}

/**
 * Memoized: with the open/closed state lifted to the list, an unmemoized row
 * would re-render every account on the page each time one chevron is pressed.
 * `deemphasized` only flips when focus mode as a whole turns on or off.
 */
export const AccountRow = memo(function AccountRow({
  account,
  canEditOrders,
  bigBrotherBaseUrl,
  todayDay,
  expanded = false,
  deemphasized = false,
  onToggle,
  registerToggle,
}: {
  account: BookAccountListItem;
  canEditOrders: boolean;
  bigBrotherBaseUrl: string;
  todayDay: string;
  /** Owned by the list's expanded-id set; the row only animates toward it. */
  expanded?: boolean;
  /** Another account holds focus, so this one softens into the background. */
  deemphasized?: boolean;
  onToggle?: (id: string) => void;
  registerToggle?: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const open = expanded;
  const phase = useAccountRowPhase(open);
  const panelId = useId();
  const canExpand = account.orderCount > 0;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);

  const attachToggle = useCallback(
    (node: HTMLButtonElement | null) => {
      toggleRef.current = node;
      registerToggle?.(account.id, node);
    },
    [account.id, registerToggle],
  );

  // Never strand focus on a node that is about to unmount or go inert.
  const parkFocusOnToggle = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === toggleRef.current) return;
    if (panelRef.current?.contains(active) || slotRef.current?.contains(active)) {
      toggleRef.current?.focus();
    }
  }, []);

  const revealFromPreview = useCallback(() => {
    parkFocusOnToggle();
    if (!open) onToggle?.(account.id);
  }, [account.id, onToggle, open, parkFocusOnToggle]);

  const toggle = useCallback(() => {
    if (open) parkFocusOnToggle();
    onToggle?.(account.id);
  }, [account.id, onToggle, open, parkFocusOnToggle]);

  const orderCards = useMemo(
    () =>
      account.orders.map((order) => (
        <RichOrderCard
          key={order.id}
          order={order}
          accountId={account.id}
          accountName={account.name}
          canEditOrders={canEditOrders}
          bigBrotherBaseUrl={bigBrotherBaseUrl}
          todayDay={todayDay}
          accountServiceNotesEmpty={!account.hasServiceNotes}
        />
      )),
    [account, canEditOrders, bigBrotherBaseUrl, todayDay],
  );

  // Derived from the orders the current view already filtered down to, so the
  // badge, stage and counts always describe what the page is showing.
  const model = useMemo(
    () => buildAccountRowModel(account.orders, todayDay),
    [account.orders, todayDay],
  );

  const previewsMounted = accountRowPreviewsMounted(phase);
  const previewsActive = accountRowPreviewsActive(phase);
  const panelMounted = accountRowPanelMounted(phase);
  const panelActive = accountRowPanelActive(phase);

  return (
    <li
      className={`account-list-row account-list-row--${phase} border-b border-[var(--rule)] last:border-b-0 ${
        open ? "account-list-row--open" : ""
      } ${deemphasized ? "account-list-row--deemphasized" : ""}`}
    >
      <div
        className={`account-list-row-header ${
          open ? "account-list-row-header--open" : ""
        } ${canExpand ? "account-list-row-header--clickable" : ""}`}
        // Pointer affordance only. The chevron below stays the labelled,
        // focusable control that carries aria-expanded for the keyboard.
        onClick={(event) => {
          if (!canExpand) return;
          if (!shouldToggleAccountFromHeader(event.target, event.currentTarget)) {
            return;
          }
          toggle();
        }}
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
            <AccountStateBadge state={model.state} />
            <span className="account-row-sep" aria-hidden="true">
              ·
            </span>
            <span className="account-row-place">
              {account.dba ? (
                <>
                  <span className="account-row-dba" title={account.dba}>
                    DBA {account.dba}
                  </span>
                  <span className="account-row-sep" aria-hidden="true">
                    ·
                  </span>
                </>
              ) : null}
              <span className="account-row-state">{account.state || "—"}</span>
            </span>
            {open ? (
              <span className="account-viewing-label">
                Viewing account
              </span>
            ) : null}
          </div>
          <AccountRowStageLine model={model} />
          <div className="mt-1.5">
            <AccountRowSummary model={model} />
          </div>
        </div>

        <div className="account-note-slot" ref={slotRef}>
          <div
            className="account-note-slot-inner"
            aria-hidden={previewsActive ? undefined : true}
            inert={!previewsActive}
          >
            {previewsMounted ? (
              <AccountNotePreviews
                accountId={account.id}
                orders={account.orders}
                onReveal={canExpand ? revealFromPreview : undefined}
              />
            ) : null}
          </div>
        </div>

        <button
          type="button"
          ref={attachToggle}
          className={`account-expand-button ${open ? "account-expand-button--open" : ""}`}
          aria-expanded={open}
          aria-controls={canExpand ? panelId : undefined}
          disabled={!canExpand}
          title={
            canExpand
              ? open
                ? "Hide orders"
                : "Show orders"
              : "No orders on this account"
          }
          onClick={toggle}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
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

      {canExpand ? (
        <div id={panelId} className="account-orders-shell">
          <div className="account-orders-shell-inner">
            {panelMounted ? (
              <div
                ref={panelRef}
                className="account-orders-panel border-t px-4 py-3"
                aria-hidden={panelActive ? undefined : true}
                inert={!panelActive}
              >
                <ul className="space-y-2">{orderCards}</ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
});

export function AllAccountsList({
  rows,
  emptyMessage,
  canEditOrders = false,
  bigBrotherBaseUrl = "",
  todayDay,
  expanded,
  onToggle,
  registerToggle,
}: {
  rows: BookAccountListItem[];
  emptyMessage: string;
  canEditOrders?: boolean;
  bigBrotherBaseUrl?: string;
  /** Harper-timezone calendar day, resolved on the server for stable ages. */
  todayDay: string;
  expanded?: ExpandedAccountIds;
  onToggle?: (id: string) => void;
  registerToggle?: (id: string, node: HTMLButtonElement | null) => void;
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
          canEditOrders={canEditOrders}
          bigBrotherBaseUrl={bigBrotherBaseUrl}
          todayDay={todayDay}
          expanded={expanded?.has(account.id) ?? false}
          deemphasized={
            expanded ? isAccountDeemphasized(expanded, account.id) : false
          }
          onToggle={onToggle}
          registerToggle={registerToggle}
        />
      ))}
    </ul>
  );
}
