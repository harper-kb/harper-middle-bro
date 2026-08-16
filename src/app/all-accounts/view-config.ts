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
