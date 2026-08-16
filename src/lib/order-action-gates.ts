import "server-only";

import type { Operator } from "./types";

export function canEditOrders(operator: Operator | null): boolean {
  if (!operator) return false;
  if (operator.role === "manager") return true;
  const allowed = (process.env.ORDER_EDIT_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(operator.email.trim().toLowerCase());
}

export function bigBrotherCompanyOrdersHref(accountId: string): string | null {
  const match = /^co-(\d+)$/.exec(accountId);
  if (!match) return null;
  const base = bigBrotherBaseUrl();
  return `${base}/company/${match[1]}/transaction?tab=orders`;
}

export function bigBrotherBaseUrl(): string {
  return (
    process.env.BIGBROTHER_BASE_URL ??
    "https://bigbrother.harperinsure.com"
  ).replace(/\/+$/, "");
}
