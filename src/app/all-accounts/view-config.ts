import type { BookOrdersViewMode } from "@/lib/db";

export type AccountOrdersView = {
  id: BookOrdersViewMode;
  title: string;
  href: string;
};

export const ACCOUNT_ORDERS_VIEWS: readonly AccountOrdersView[] = [
  { id: "all", title: "All Accounts", href: "/all-accounts" },
  { id: "pending", title: "Pending Orders", href: "/pending-orders" },
  { id: "bound", title: "Bound Orders", href: "/bound-orders" },
  { id: "lost", title: "Lost Orders", href: "/lost-orders" },
] as const;

export function getAccountOrdersView(
  mode: BookOrdersViewMode,
): AccountOrdersView {
  return ACCOUNT_ORDERS_VIEWS.find((view) => view.id === mode)!;
}

/**
 * Source-scoped pipeline filters: each one exists only under its Account
 * Source and only on the views below. The page's normalizing redirect, the
 * toolbar's URL builder and the view switcher all read this one table, so a
 * dependent filter can never stay active under the wrong source or view.
 */
export const SOURCE_PIPELINE_FILTERS = [
  { param: "iqStage", source: "iq" },
  { param: "brokerGate", source: "broker" },
] as const;

export const SOURCE_PIPELINE_FILTER_PARAMS: readonly string[] =
  SOURCE_PIPELINE_FILTERS.map((f) => f.param);

/** Views where the source-scoped pipeline filters (IQ Stage / Broker Gate) apply. */
export function supportsSourcePipelineFilters(
  mode: BookOrdersViewMode,
): boolean {
  return mode === "all" || mode === "pending";
}
