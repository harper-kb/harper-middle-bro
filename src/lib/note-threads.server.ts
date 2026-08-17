import "server-only";

import { createHash } from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/connection";
import {
  META_SERVICE_NOTES_SYNCED_AT,
  readBookMeta,
} from "@/lib/db/book-meta";
import type {
  NoteThread,
  NoteThreadEntry,
  NoteThreadsResponse,
} from "@/lib/note-thread-types";
import { normalizeBookOrderRich } from "@/lib/supabase-book.server";
import { runSupabaseManagementQuery } from "@/lib/supabase-management.server";

const MAX_THREAD_ROWS = 500;
/** How long a fetched thread is served without re-querying. */
const THREAD_CACHE_TTL_MS = 15_000;
/**
 * How long an expired entry is retained as a stale fallback. The Management
 * API this reads through is shared with the two-minute book refresh and can
 * transiently fail (rate limits, timeouts); a note thread the operator could
 * see fifteen seconds ago is strictly better than an error card, and the next
 * successful fetch replaces it.
 */
const THREAD_STALE_TTL_MS = 10 * 60_000;
const MAX_THREAD_CACHE_ENTRIES = 256;
/** One bounded retry for transient Management API failures. */
const THREAD_RETRY_DELAY_MS = 350;

type ThreadCacheEntry = {
  value: NoteThread;
  freshUntil: number;
  staleUntil: number;
};

/**
 * Cached per unit, not per (order, company) pair: the Service thread is
 * account-scoped and identical for every order card on an expanded account,
 * so caching it per order would run the same heavy query once per card.
 */
const threadUnitCache = new Map<string, ThreadCacheEntry>();
const threadUnitInFlight = new Map<string, Promise<NoteThread>>();

function asTimestamp(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
}

export function visibleNoteThreadVersion(
  type: NoteThread["type"],
  scopeId: string,
  visibilityScope: string,
  entries: readonly NoteThreadEntry[],
): string {
  const hash = createHash("sha256");
  hash.update(`note-thread:v2:${visibilityScope}:${type}:${scopeId}\n`);
  for (const entry of entries) {
    hash.update(entry.id);
    hash.update("\0");
    hash.update(entry.createdAt ?? "");
    hash.update("\0");
    hash.update(entry.updatedAt ?? "");
    hash.update("\0");
    hash.update(entry.author);
    hash.update("\0");
    hash.update(String(entry.orderId));
    hash.update("\0");
    hash.update(createHash("sha256").update(entry.body).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function makeThread(
  type: NoteThread["type"],
  scope: NoteThread["scope"],
  scopeId: string,
  visibilityScope: string,
  entries: NoteThreadEntry[],
): NoteThread {
  entries.sort((a, b) => {
    const aAt = Date.parse(a.updatedAt ?? a.createdAt ?? "");
    const bAt = Date.parse(b.updatedAt ?? b.createdAt ?? "");
    if (Number.isFinite(aAt) && Number.isFinite(bAt) && aAt !== bAt) {
      return bAt - aAt;
    }
    return b.id.localeCompare(a.id, undefined, { numeric: true });
  });
  return {
    type,
    scope,
    entries,
    version: visibleNoteThreadVersion(
      type,
      scopeId,
      visibilityScope,
      entries,
    ),
    latestAt: entries[0]?.updatedAt ?? entries[0]?.createdAt ?? null,
  };
}

/**
 * Service Notes are the account-scoped BigBrother Workbench thread. Each entry
 * keeps its stable order anchor so the viewer never obscures which order it
 * came from.
 */
async function fetchServiceThread(
  companyId: number,
  visibilityScope: string,
): Promise<NoteThread> {
  const serviceSql = `
    SELECT
      n.id::text AS id,
      n.order_id,
      n.body,
      n.created_at::text AS created_at,
      COALESCE(
        NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
        'Unknown author'
      ) AS author
    FROM public.service_note_entries n
    LEFT JOIN public.internal_agents a ON a.id = n.author_internal_agent_id
    WHERE n.company_id = ${companyId}
      AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${MAX_THREAD_ROWS}`;
  // Interactive timeout: these back a card the operator is looking at. A hung
  // Management API call at the old 20s, doubled by the retry and again by the
  // client's silent retries, could pin the loading skeleton for over a minute.
  const serviceRows = await runSupabaseManagementQuery<Record<string, unknown>>(
    serviceSql,
    8_000,
  );
  if (serviceRows.length >= MAX_THREAD_ROWS) {
    throw new Error(
      "This Service Note thread is too large to return safely without pagination.",
    );
  }
  const serviceEntries = serviceRows.flatMap((row): NoteThreadEntry[] => {
    const id = String(row.id ?? "").trim();
    const entryOrderId = Number(row.order_id);
    const createdAt = asTimestamp(row.created_at);
    if (!id || !Number.isFinite(entryOrderId) || !createdAt) return [];
    return [
      {
        id,
        body: String(row.body ?? ""),
        author: String(row.author ?? "Unknown author"),
        createdAt,
        updatedAt: null,
        edited: false,
        orderId: entryOrderId,
        orderLabel: `Order #${entryOrderId}`,
      },
    ];
  });
  return makeThread(
    "service",
    "account",
    `company:${companyId}`,
    visibilityScope,
    serviceEntries,
  );
}

/**
 * Producer Notes remain the current, overwriteable value on the selected
 * order, represented as the agreed single-entry thread.
 */
async function fetchProducerThread(
  companyId: number,
  orderId: number,
  visibilityScope: string,
): Promise<NoteThread> {
  const producerSql = `
    SELECT
      o.id::text AS id,
      o.producer_notes AS body,
      o.producer_notes_updated_at::text AS updated_at,
      COALESCE(
        NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
        'Unknown author'
      ) AS author
    FROM public.orders_temp o
    LEFT JOIN public.internal_agents a ON a.id = o.producer_notes_updated_by
    WHERE o.company_id = ${companyId}
      AND o.id = ${orderId}
      AND COALESCE(o.is_deleted, false) = false
      AND o.producer_notes IS NOT NULL
      AND BTRIM(o.producer_notes) <> ''
    LIMIT 1`;
  const producerRows = await runSupabaseManagementQuery<
    Record<string, unknown>
  >(producerSql, 8_000);
  const producerEntries = producerRows.flatMap((row): NoteThreadEntry[] => {
    const body = String(row.body ?? "");
    if (!body.trim()) return [];
    const updatedAt = asTimestamp(row.updated_at);
    return [
      {
        id: `producer-${orderId}`,
        body,
        author: String(row.author ?? "Unknown author"),
        createdAt: updatedAt,
        updatedAt,
        edited: false,
        orderId,
        orderLabel: `Order #${orderId}`,
      },
    ];
  });
  return makeThread(
    "producer",
    "order",
    `company:${companyId}:order:${orderId}`,
    visibilityScope,
    producerEntries,
  );
}

function pruneThreadCache() {
  const now = Date.now();
  for (const [key, entry] of threadUnitCache) {
    if (entry.staleUntil <= now) threadUnitCache.delete(key);
  }
  while (threadUnitCache.size > MAX_THREAD_CACHE_ENTRIES) {
    const oldest = threadUnitCache.keys().next().value as string | undefined;
    if (!oldest) break;
    threadUnitCache.delete(oldest);
  }
}

/** Writes invalidate hard — a fresh note must never be answered with stale. */
export function invalidateNoteThreads(companyId: number): void {
  const prefixes = [`producer:${companyId}:`, `service:${companyId}:`];
  for (const key of threadUnitCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      threadUnitCache.delete(key);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchThreadWithRetry(
  fetcher: () => Promise<NoteThread>,
): Promise<NoteThread> {
  try {
    return await fetcher();
  } catch {
    await delay(THREAD_RETRY_DELAY_MS);
    return await fetcher();
  }
}

/**
 * One thread unit: fresh cache → shared in-flight fetch (with one bounded
 * retry) → stale fallback. Only a failure with nothing cached surfaces as an
 * error, so a transient Management API blip cannot blank a thread the
 * operator was just reading.
 */
async function loadThreadUnit(
  key: string,
  fetcher: () => Promise<NoteThread>,
): Promise<NoteThread> {
  const cached = threadUnitCache.get(key);
  if (cached && cached.freshUntil > Date.now()) return cached.value;
  let pending = threadUnitInFlight.get(key);
  if (!pending) {
    pending = fetchThreadWithRetry(fetcher);
    threadUnitInFlight.set(key, pending);
  }
  try {
    const value = await pending;
    const now = Date.now();
    threadUnitCache.set(key, {
      value,
      freshUntil: now + THREAD_CACHE_TTL_MS,
      staleUntil: now + THREAD_STALE_TTL_MS,
    });
    pruneThreadCache();
    return value;
  } catch (cause) {
    if (cached && cached.staleUntil > Date.now()) {
      console.warn("note_threads_served_stale", {
        key,
        errorCategory:
          cause instanceof Error ? cause.message : "note_threads_unknown_error",
      });
      return cached.value;
    }
    throw cause;
  } finally {
    threadUnitInFlight.delete(key);
  }
}

/**
 * Whether the SQLite Service Note mirror is populated for the current book.
 * The flag is written in the same transaction as the rows, so a true answer
 * means the table really carries the synced thread set.
 */
export function localNoteThreadsReady(db: Database.Database): boolean {
  return readBookMeta(db, META_SERVICE_NOTES_SYNCED_AT) !== null;
}

/**
 * The local read path: both threads straight from SQLite, no network. The
 * producer note already travels with the order payload (`rich_json`), and the
 * service thread is mirrored into `book_service_notes` by the book refresh.
 * Entry shapes and version hashing are identical to the live path so summary
 * cache keys stay stable across the two.
 */
export function loadLocalNoteThreads(
  db: Database.Database,
  {
    companyId,
    orderId,
    visibilityScope,
  }: {
    companyId: number;
    orderId: number;
    visibilityScope: string;
  },
): NoteThreadsResponse {
  const accountId = `co-${companyId}`;

  const orderRow = db
    .prepare(
      `SELECT rich_json FROM book_orders
       WHERE account_id = ? AND harper_order_id = ?`,
    )
    .get(accountId, orderId) as { rich_json: string } | undefined;
  let parsedRich: unknown = null;
  try {
    parsedRich = orderRow ? JSON.parse(orderRow.rich_json) : null;
  } catch {
    parsedRich = null;
  }
  const rich = normalizeBookOrderRich(
    parsedRich && typeof parsedRich === "object"
      ? (parsedRich as Record<string, unknown>)
      : null,
  );
  const producerEntries: NoteThreadEntry[] = [];
  if (rich.producerNote && rich.producerNote.trim()) {
    const updatedAt = asTimestamp(rich.producerNoteUpdatedAt);
    producerEntries.push({
      id: `producer-${orderId}`,
      body: rich.producerNote,
      author: rich.producerNoteUpdatedByName ?? "Unknown author",
      createdAt: updatedAt,
      updatedAt,
      edited: false,
      orderId,
      orderLabel: `Order #${orderId}`,
    });
  }
  const producer = makeThread(
    "producer",
    "order",
    `company:${companyId}:order:${orderId}`,
    visibilityScope,
    producerEntries,
  );

  const noteRows = db
    .prepare(
      `SELECT id, order_id, body, author, created_at
       FROM book_service_notes
       WHERE account_id = ?
       ORDER BY created_at DESC, CAST(id AS INTEGER) DESC
       LIMIT ${MAX_THREAD_ROWS}`,
    )
    .all(accountId) as {
    id: string;
    order_id: number;
    body: string;
    author: string;
    created_at: string;
  }[];
  if (noteRows.length >= MAX_THREAD_ROWS) {
    throw new Error(
      "This Service Note thread is too large to return safely without pagination.",
    );
  }
  const serviceEntries = noteRows.flatMap((row): NoteThreadEntry[] => {
    const id = String(row.id ?? "").trim();
    const entryOrderId = Number(row.order_id);
    const createdAt = asTimestamp(row.created_at);
    if (!id || !Number.isFinite(entryOrderId) || !createdAt) return [];
    return [
      {
        id,
        body: String(row.body ?? ""),
        author: String(row.author ?? "Unknown author"),
        createdAt,
        updatedAt: null,
        edited: false,
        orderId: entryOrderId,
        orderLabel: `Order #${entryOrderId}`,
      },
    ];
  });
  const service = makeThread(
    "service",
    "account",
    `company:${companyId}`,
    visibilityScope,
    serviceEntries,
  );

  return { accountId: companyId, orderId, producer, service };
}

export async function loadNoteThreads({
  companyId,
  orderId,
  visibilityScope,
}: {
  companyId: number;
  orderId: number;
  visibilityScope: string;
}): Promise<NoteThreadsResponse> {
  // Local-first: once the book refresh has mirrored the threads into SQLite,
  // this whole request is two indexed local reads — no Management API call,
  // no TTL, nothing to warm. The live path below survives only as the
  // fallback for the window before the first mirrored snapshot lands.
  const db = getDb();
  if (localNoteThreadsReady(db)) {
    return loadLocalNoteThreads(db, { companyId, orderId, visibilityScope });
  }

  pruneThreadCache();
  const [producer, service] = await Promise.all([
    loadThreadUnit(`producer:${companyId}:${orderId}:${visibilityScope}`, () =>
      fetchProducerThread(companyId, orderId, visibilityScope),
    ),
    loadThreadUnit(`service:${companyId}:${visibilityScope}`, () =>
      fetchServiceThread(companyId, visibilityScope),
    ),
  ]);
  return { accountId: companyId, orderId, producer, service };
}
