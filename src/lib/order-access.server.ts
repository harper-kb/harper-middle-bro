import "server-only";

import { getDb } from "@/lib/db";

export function isVisibleBookOrder(
  companyId: number,
  orderId: number,
): boolean {
  if (
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !Number.isSafeInteger(orderId) ||
    orderId <= 0
  ) {
    return false;
  }
  const row = getDb()
    .prepare(
      `SELECT 1
       FROM book_orders
       WHERE account_id = ? AND harper_order_id = ?
       LIMIT 1`,
    )
    .get(`co-${companyId}`, orderId);
  return Boolean(row);
}
