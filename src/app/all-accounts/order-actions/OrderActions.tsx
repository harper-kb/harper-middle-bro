"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BindHandoffDialog,
  type BindHandoffTarget,
} from "@/components/orders/BindHandoffDialog";
import { bigBrotherCompanyId } from "@/lib/big-brother";
import type { BookOrderListItem } from "@/lib/db";

const BUTTON =
  "inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45";

export function OrderActions({
  order,
  accountId,
  accountName,
  canEditOrders,
  bigBrotherBaseUrl,
}: {
  order: BookOrderListItem;
  accountId: string;
  accountName: string;
  canEditOrders: boolean;
  bigBrotherBaseUrl: string;
}) {
  const [handoff, setHandoff] = useState<BindHandoffTarget | null>(null);
  const bindRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const companyId = accountId.replace(/^co-/, "");
  const bigBrotherHref = `${bigBrotherBaseUrl}/company/${companyId}/transaction?tab=orders`;
  const unboundCount = order.rich.deals.filter((deal) => !deal.isBound).length;
  const showBind = order.bindStatus !== "lost" && unboundCount > 0;

  // Rebuilt from the account id on every open, so a different row can never
  // inherit the previous company's route key.
  const openHandoff = useCallback(() => {
    setHandoff({
      orderId: order.harperOrderId,
      orderLabel: order.label,
      accountName,
      bigBrotherCompanyId: bigBrotherCompanyId(accountId),
    });
  }, [accountId, accountName, order.harperOrderId, order.label]);

  const closeHandoff = useCallback(() => {
    restoreFocusRef.current = true;
    setHandoff(null);
  }, []);

  // The trigger is inert while the dialog is up, so focus can only go back
  // once the dialog has unmounted and released the background.
  useEffect(() => {
    if (handoff !== null || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    bindRef.current?.focus();
  }, [handoff]);

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {canEditOrders ? (
          <a
            href={bigBrotherHref}
            target="_blank"
            rel="noopener noreferrer"
            className={BUTTON}
            title="Edit this order in BigBrother"
          >
            ✎ Edit
          </a>
        ) : (
          <button
            type="button"
            className={BUTTON}
            disabled
            title="You cannot edit this account. Ask a lead to change it."
          >
            ✎ Edit
          </button>
        )}
        {showBind ? (
          <button
            ref={bindRef}
            type="button"
            className="order-bind-button"
            aria-haspopup="dialog"
            aria-expanded={handoff !== null}
            onClick={(event) => {
              // Never let the card open the order drawer or toggle the row.
              event.stopPropagation();
              openHandoff();
            }}
          >
            ◎{" "}
            {unboundCount > 1
              ? `Bind ${unboundCount} Policies`
              : "Bind Policy"}
          </button>
        ) : null}
      </div>

      {handoff ? (
        <BindHandoffDialog target={handoff} onClose={closeHandoff} />
      ) : null}
    </>
  );
}
