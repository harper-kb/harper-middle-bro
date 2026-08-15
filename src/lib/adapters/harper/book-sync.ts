import "server-only";

import { executeAgentToolsCommand } from "../agent-tools/client";
import { agentToolsConfigured } from "../agent-tools/config";
import { buildBookFromRows } from "./book";
import type { HarperPolicyRow } from "./policy-state";

/**
 * Refresh the desk's book from Harper, at runtime, over the credentials the
 * app already holds.
 *
 * The packed-env-var route carries a snapshot someone produced by hand; it
 * is as old as the last person who ran the pipeline, and getting a new one
 * onto a deployed instance means a person with Railway access. This asks
 * Harper directly for the same rows the offline import reads, through the
 * same Agent Tools door the desk already uses for its mutations.
 *
 * Deliberately not wired into boot. The book loader is synchronous and runs
 * inside the first database open, so a fetch there would block the first
 * request behind a network call and fail the whole boot when Harper is
 * slow. This is called explicitly and writes what it finds.
 */

export const POLICY_STATE_COMMAND = "data policy-state read";

export interface BookSyncResult {
  ok: boolean;
  /** Why nothing was written, when nothing was. */
  reason: string | null;
  fetchedRows: number;
  accounts: number;
  policies: number;
  scheduled: number;
  skipped: number;
  droppedLimits: number;
}

const NOT_CONFIGURED: BookSyncResult = {
  ok: false,
  reason:
    "Harper Agent Tools credentials not provisioned (set HARPER_AGENT_TOOLS_BASE_URL + HARPER_AGENT_TOOLS_TOKEN)",
  fetchedRows: 0,
  accounts: 0,
  policies: 0,
  scheduled: 0,
  skipped: 0,
  droppedLimits: 0,
};

/**
 * Fetch the in-force book and hand back what it maps to. Does not write —
 * the caller applies it, so a failed fetch can never half-replace a book
 * that is currently serving certificates.
 */
export async function fetchHarperBook(
  limit = 400,
): Promise<
  | { ok: false; reason: string }
  | { ok: true; rows: HarperPolicyRow[]; book: ReturnType<typeof buildBookFromRows> }
> {
  if (!agentToolsConfigured()) return { ok: false, reason: NOT_CONFIGURED.reason! };

  const res = await executeAgentToolsCommand(POLICY_STATE_COMMAND, {
    in_force_only: true,
    limit,
  });
  if (!res.ok) {
    return { ok: false, reason: res.error ?? `Agent Tools returned ${res.status}` };
  }

  // The read answers in an envelope: {status, data_contract, rows: [...]}.
  // A response without rows is a contract change or a fails-closed
  // not_configured, and either way must not be read as an empty book —
  // that would wipe every account the desk is serving.
  const payload = res.data as { status?: string; rows?: unknown };
  if (payload.status && payload.status !== "ok") {
    return { ok: false, reason: `policy-state read returned status "${payload.status}"` };
  }
  if (!Array.isArray(payload.rows)) {
    return { ok: false, reason: "policy-state read carried no rows array" };
  }
  if (payload.rows.length === 0) {
    return { ok: false, reason: "policy-state read carried zero rows" };
  }

  const rows = payload.rows as HarperPolicyRow[];
  return { ok: true, rows, book: buildBookFromRows(rows) };
}

/**
 * Fetch and write. Returns what changed rather than throwing, so a route or
 * a script can report the outcome without a try/catch around every call.
 */
export async function syncBookFromHarper(limit = 400): Promise<BookSyncResult> {
  let fetched: Awaited<ReturnType<typeof fetchHarperBook>>;
  try {
    fetched = await fetchHarperBook(limit);
  } catch (err) {
    return { ...NOT_CONFIGURED, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!fetched.ok) return { ...NOT_CONFIGURED, reason: fetched.reason };

  const { rows, book } = fetched;
  // Imported here rather than at module scope: db.ts opens the database on
  // first import, and this module is loaded by routes that may never sync.
  const { applyBook } = await import("../../db");
  applyBook({
    fetchedAt: new Date().toISOString(),
    accounts: book.accounts,
    policies: book.policies,
    schedules: book.schedules,
  });

  return {
    ok: true,
    reason: null,
    fetchedRows: rows.length,
    accounts: book.accounts.length,
    policies: book.policies.length,
    scheduled: Object.values(book.schedules).filter((s) => s.limits.length > 0).length,
    skipped: book.stats.skipped,
    droppedLimits: book.stats.droppedLimits.length,
  };
}
