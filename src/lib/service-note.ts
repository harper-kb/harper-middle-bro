/**
 * Workbench Service Notes — authoritative book is
 * `public.service_note_entries` (BigBrother Workbench thread). Soft-delete via
 * `deleted_at`. Newest-first: `created_at DESC NULLS LAST, id DESC`. Author
 * from `author_internal_agent_id` → `internal_agents`. Distinct from Producer
 * Notes (`orders_temp.producer_notes`).
 */

export type BookOrderServiceNote = {
  /** Stable `service_note_entries.id`. */
  id: string;
  body: string;
  author: string;
  /** Authoritative `created_at` ISO. */
  createdAt: string;
  /**
   * Visible (non-deleted) entries in this account-wide Service Note thread,
   * including the latest. Repeated on each order's latest-note snapshot so a
   * collapsed account can gate summaries without fetching single-note threads.
   */
  noteCount: number;
};

export type AccountServiceNotePreview = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  orderId: number;
  earlierCount: number;
};

/**
 * One full Service Note thread entry, mirrored locally so the expanded thread
 * reads SQLite instead of a live Management API query per interaction.
 * Account-scoped (the thread spans every order on the company), each entry
 * keeping its order anchor. Author resolved to a display name at sync time —
 * a directory rename is picked up by the periodic full reconcile, same as
 * carrier and producer names.
 */
export type BookServiceNoteEntry = {
  /** Stable `service_note_entries.id` as text. */
  id: string;
  /** Book account id (`co-<companyId>`). */
  accountId: string;
  /** Harper `orders_temp.id` the entry is anchored to. */
  orderId: number;
  body: string;
  author: string;
  /** Authoritative `created_at` ISO. */
  createdAt: string;
};

export function parseBookServiceNoteEntry(
  value: unknown,
): BookServiceNoteEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const accountId =
    typeof row.accountId === "string" ? row.accountId.trim() : "";
  const orderId = Number(row.orderId);
  const createdAt =
    typeof row.createdAt === "string" ? row.createdAt.trim() : "";
  if (!id || !accountId || !Number.isSafeInteger(orderId) || !createdAt) {
    return null;
  }
  return {
    id,
    accountId,
    orderId,
    body: typeof row.body === "string" ? row.body : "",
    author:
      typeof row.author === "string" && row.author.trim()
        ? row.author.trim()
        : "Unknown author",
    createdAt,
  };
}

type OrderWithServiceNote = {
  harperOrderId: number;
  rich: { serviceNote: BookOrderServiceNote | null };
};

function compareNewestFirst(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  const aAt = Date.parse(a.createdAt);
  const bAt = Date.parse(b.createdAt);
  const aOk = Number.isFinite(aAt);
  const bOk = Number.isFinite(bAt);
  if (aOk && bOk && aAt !== bAt) return bAt - aAt;
  if (aOk !== bOk) return aOk ? -1 : 1;
  const aId = Number(a.id);
  const bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
    return bId - aId;
  }
  return b.id.localeCompare(a.id);
}

/**
 * Latest visible Service Note across the account's currently displayed
 * orders — the same eligible set the collapsed row already shows. Tie-break
 * matches BigBrother: newer `created_at`, then higher `id`.
 */
export function pickLatestServiceNote(
  orders: readonly OrderWithServiceNote[],
): AccountServiceNotePreview | null {
  let totalNotes = 0;
  const candidates: Array<BookOrderServiceNote & { orderId: number }> = [];
  for (const order of orders) {
    const note = order.rich.serviceNote;
    if (!note) continue;
    // Current snapshots repeat the account-wide visible count on each order.
    // `max` avoids multiplying that count on accounts with several orders.
    totalNotes = Math.max(totalNotes, Math.max(1, note.noteCount));
    candidates.push({ ...note, orderId: order.harperOrderId });
  }
  if (candidates.length === 0) return null;
  candidates.sort(compareNewestFirst);
  const latest = candidates[0]!;
  return {
    id: latest.id,
    body: latest.body,
    author: latest.author,
    createdAt: latest.createdAt,
    orderId: latest.orderId,
    earlierCount: Math.max(0, totalNotes - 1),
  };
}

/** Collapse whitespace for the one/two-line collapsed preview. */
export function serviceNotePreviewBody(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : "Empty service note";
}

export function parseBookOrderServiceNote(
  value: unknown,
): BookOrderServiceNote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const createdAt =
    typeof row.createdAt === "string" ? row.createdAt.trim() : "";
  if (!id || !createdAt) return null;
  const noteCountRaw = row.noteCount;
  const noteCount =
    typeof noteCountRaw === "number" && Number.isFinite(noteCountRaw)
      ? Math.max(1, Math.floor(noteCountRaw))
      : 1;
  return {
    id,
    body: typeof row.body === "string" ? row.body : "",
    author:
      typeof row.author === "string" && row.author.trim()
        ? row.author.trim()
        : "Unknown author",
    createdAt,
    noteCount,
  };
}
