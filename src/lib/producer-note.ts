/**
 * Producer Notes — authoritative source is `orders_temp.producer_notes`, with
 * `producer_notes_updated_at` and the author resolved from
 * `producer_notes_updated_by` → `internal_agents`. One note per order (a text
 * column that gets overwritten), so there is no thread and no soft-delete.
 *
 * Deliberately separate from Workbench Service Notes
 * (`public.service_note_entries`, see src/lib/service-note.ts) — the two are
 * different books and must never be merged or relabeled as each other.
 */

export type AccountProducerNotePreview = {
  body: string;
  /** Null when the directory cannot name the last editor. */
  author: string | null;
  /** `producer_notes_updated_at`; null when Harper never stamped it. */
  updatedAt: string | null;
  orderId: number;
  /** Other displayed orders that also carry a producer note. */
  earlierCount: number;
};

type OrderWithProducerNote = {
  harperOrderId: number;
  rich: {
    producerNote: string | null;
    producerNoteUpdatedAt: string | null;
    producerNoteUpdatedByName: string | null;
  };
};

/**
 * Latest producer note across the account's currently displayed orders — the
 * same eligible set the collapsed row already summarizes. Newest
 * `producer_notes_updated_at` wins; an unstamped note sorts last (never ahead
 * of a note Harper actually dated), and the higher order id breaks ties.
 */
export function pickLatestProducerNote(
  orders: readonly OrderWithProducerNote[],
): AccountProducerNotePreview | null {
  const candidates: Array<{
    body: string;
    author: string | null;
    updatedAt: string | null;
    orderId: number;
    at: number | null;
  }> = [];

  for (const order of orders) {
    const body = order.rich.producerNote?.trim();
    if (!body) continue;
    const rawAt = order.rich.producerNoteUpdatedAt;
    const parsed = rawAt ? Date.parse(rawAt) : Number.NaN;
    candidates.push({
      body,
      author: order.rich.producerNoteUpdatedByName?.trim() || null,
      updatedAt: rawAt ?? null,
      orderId: order.harperOrderId,
      at: Number.isFinite(parsed) ? parsed : null,
    });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.at !== null && b.at !== null && a.at !== b.at) return b.at - a.at;
    if ((a.at === null) !== (b.at === null)) return a.at === null ? 1 : -1;
    return b.orderId - a.orderId;
  });

  const latest = candidates[0]!;
  return {
    body: latest.body,
    author: latest.author,
    updatedAt: latest.updatedAt,
    orderId: latest.orderId,
    earlierCount: candidates.length - 1,
  };
}

/** Collapse whitespace for the one/two-line collapsed preview. */
export function producerNotePreviewBody(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : "Empty producer note";
}
