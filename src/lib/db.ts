import type { SupabaseBook } from "./supabase-book.server";
import { setSupabaseBookCache } from "./supabase-book.server";
import { getDb as getDatabase } from "./db/connection";
import { syncAccountsAndPolicies } from "./db/seed";
import type { BookContactKey, BookOrder } from "./supabase-book.server";

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

/**
 * Apply a runtime-fetched Harper book through the refactored sync path. Orders
 * and contact search keys are optional because the legacy Harper sync carries
 * neither; both surfaces stay empty until the two-minute refresh restores
 * them, rather than being filled with anything this book cannot vouch for.
 */
export function applyBook(
  book: Omit<SupabaseBook, "orders" | "contactKeys"> & {
    orders?: BookOrder[];
    contactKeys?: BookContactKey[];
  },
): void {
  setSupabaseBookCache({
    ...book,
    orders: book.orders ?? [],
    contactKeys: book.contactKeys ?? [],
  });
  syncAccountsAndPolicies(getDatabase());
}
