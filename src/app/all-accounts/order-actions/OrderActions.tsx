"use client";

import { useState } from "react";
import type { BookOrderListItem } from "@/lib/db";
import { BindPolicyModal } from "./BindPolicyModal";

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
  const [binding, setBinding] = useState(false);
  const companyId = accountId.replace(/^co-/, "");
  const bigBrotherHref = `${bigBrotherBaseUrl}/company/${companyId}/transaction?tab=orders`;
  const unboundCount = order.rich.deals.filter((deal) => !deal.isBound).length;
  const showBind = order.bindStatus !== "lost" && unboundCount > 0;

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
            type="button"
            className="order-bind-button"
            onClick={() => setBinding(true)}
          >
            ◎{" "}
            {unboundCount > 1
              ? `Bind ${unboundCount} Policies`
              : "Bind Policy"}
          </button>
        ) : null}
      </div>

      {binding ? (
        <BindPolicyModal
          order={order}
          companyId={companyId}
          accountName={accountName}
          bigBrotherHref={bigBrotherHref}
          onClose={() => setBinding(false)}
        />
      ) : null}
    </>
  );
}
