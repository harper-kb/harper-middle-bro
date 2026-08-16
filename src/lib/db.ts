import type { SupabaseBook } from "./supabase-book.server";
import { setSupabaseBookCache } from "./supabase-book.server";
import { getDb as getDatabase } from "./db/connection";
import { syncAccountsAndPolicies } from "./db/seed";
import type { BookOrder } from "./supabase-book.server";

/**
 * Thin re-export barrel. The former god file now lives in src/lib/db/:
 * connection (WAL sqlite singleton + boot chain), migrate (schema +
 * ensureColumn), seed (seed/sync/backfill), and queries/ grouped by domain.
 * Existing `@/lib/db` imports keep working; new code should import from
 * `@/lib/db/queries/*` directly.
 */
export { getDb, resetDatabase } from "./db/connection";
export * from "./db/queries/accounts";
export * from "./db/queries/address-cache";
export * from "./db/queries/decisions";
export * from "./db/queries/intake";
export * from "./db/queries/operators";
export * from "./db/queries/policy-desk";
export * from "./db/queries/threads";
export * from "./db/queries/tickets";

/** Apply a runtime-fetched Harper book through the refactored sync path. */
export function applyBook(
  book: Omit<SupabaseBook, "orders"> & { orders?: BookOrder[] },
): void {
  setSupabaseBookCache({ ...book, orders: book.orders ?? [] });
  syncAccountsAndPolicies(getDatabase());
}
