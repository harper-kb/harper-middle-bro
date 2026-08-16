"use client";

import type { BookOrderListItem } from "@/lib/db";
import { BrokerGateRail } from "./BrokerGateRail";
import { OrderNoteThreads } from "./OrderNoteThreads";
import { OrderMetaChips } from "./OrderMetaChips";

function formatOrderedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function BindBadge({ status }: { status: BookOrderListItem["bindStatus"] }) {
  if (status === "bound") {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-emerald-700 ring-1 ring-inset ring-emerald-600/25 dark:text-emerald-300">
        Bound
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="order-status-pending inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset">
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-600 ring-1 ring-inset ring-zinc-500/25 dark:text-zinc-400">
      Lost
    </span>
  );
}

/** Truthful per-status policy line — never a fabricated number. */
function policyLine(status: BookOrderListItem["bindStatus"]): string {
  if (status === "pending") return "No policy number yet";
  return "No policy — deal lost";
}

/**
 * The All Accounts order preview. Carries the same metadata group as the
 * filtered views' RichOrderCard, without the money grid and order actions
 * those views add.
 */
export function PlainOrderRow({
  order,
  accountId,
  accountName,
  canEditOrders,
  bigBrotherBaseUrl,
  todayDay,
}: {
  order: BookOrderListItem;
  accountId: string;
  accountName: string;
  canEditOrders: boolean;
  bigBrotherBaseUrl: string;
  todayDay: string;
}) {
  const ordered = formatOrderedAt(order.orderedAt);

  return (
    <li className="rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[var(--ink)]">
              {order.label}
            </p>
            <BindBadge status={order.bindStatus} />
          </div>
          <OrderMetaChips
            source={order.source}
            revenueMicros={order.revenueMicros}
            createdAt={order.createdAt}
            todayDay={todayDay}
            brokerGate={order.brokerGate}
            brokerGateAt={order.brokerGateAt}
          />
        </div>
        {ordered ? (
          <p className="mt-1 text-xs text-[var(--muted)]">Ordered {ordered}</p>
        ) : null}
        {order.source === "broker" ? (
          <BrokerGateRail
            brokerGate={order.brokerGate}
            brokerGateAt={order.brokerGateAt}
          />
        ) : null}
      </div>

      <div className="mt-2 text-sm">
        {order.bindStatus === "bound" ? (
          order.policyNumbers.length > 0 ? (
            <ul className="space-y-0.5">
              {order.policyNumbers.map((n) => (
                <li key={n} className="tabular-nums text-[var(--ink)]">
                  Policy #{n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-amber-800 dark:text-amber-300">
              Bound — policy number missing on file
            </p>
          )
        ) : (
          <p className="italic text-[var(--muted)]">
            {policyLine(order.bindStatus)}
          </p>
        )}
      </div>

      <OrderNoteThreads
        accountId={accountId}
        accountName={accountName}
        orderId={order.harperOrderId}
        orderLabel={order.label}
        canEditProducer={canEditOrders}
        producerEditHref={`${bigBrotherBaseUrl}/company/${accountId.replace(/^co-/, "")}/transaction?tab=orders`}
      />

      {order.inconsistency ? (
        <p className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
          Data inconsistency: {order.inconsistency}
        </p>
      ) : null}
    </li>
  );
}
