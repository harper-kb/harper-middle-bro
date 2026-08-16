import "server-only";

import { createHash } from "crypto";
import type {
  NoteThread,
  NoteThreadEntry,
  NoteThreadsResponse,
} from "@/lib/note-thread-types";
import { runSupabaseManagementQuery } from "@/lib/supabase-management.server";

const MAX_THREAD_ROWS = 500;
const THREAD_CACHE_TTL_MS = 15_000;
const MAX_THREAD_CACHE_ENTRIES = 128;

const threadCache = new Map<
  string,
  { value: NoteThreadsResponse; expiresAt: number }
>();
const threadInFlight = new Map<string, Promise<NoteThreadsResponse>>();

function asTimestamp(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
}

function threadVersion(
  type: NoteThread["type"],
  scopeId: string,
  entries: readonly NoteThreadEntry[],
): string {
  const hash = createHash("sha256");
  hash.update(`note-thread:v1:${type}:${scopeId}\n`);
  for (const entry of entries) {
    hash.update(entry.id);
    hash.update("\0");
    hash.update(entry.createdAt ?? "");
    hash.update("\0");
    hash.update(entry.updatedAt ?? "");
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
    version: threadVersion(type, scopeId, entries),
    latestAt: entries[0]?.updatedAt ?? entries[0]?.createdAt ?? null,
  };
}

/**
 * Reads the two authoritative books separately.
 *
 * Service Notes are the account-scoped BigBrother Workbench thread. Each entry
 * keeps its stable order anchor so the viewer never obscures which order it
 * came from. Producer Notes remain the current, overwriteable value on the
 * selected order and are represented as the agreed single-entry thread.
 */
async function fetchNoteThreads({
  companyId,
  orderId,
}: {
  companyId: number;
  orderId: number;
}): Promise<NoteThreadsResponse> {
  const serviceSql = `
    SELECT
      n.id::text AS id,
      n.order_id,
      n.body,
      n.created_at::text AS created_at,
      COALESCE(
        NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
        'Harper operator'
      ) AS author
    FROM public.service_note_entries n
    LEFT JOIN public.internal_agents a ON a.id = n.author_internal_agent_id
    WHERE n.company_id = ${companyId}
      AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${MAX_THREAD_ROWS}`;
  const producerSql = `
    SELECT
      o.id::text AS id,
      o.producer_notes AS body,
      o.producer_notes_updated_at::text AS updated_at,
      COALESCE(
        NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
        'Unknown producer'
      ) AS author
    FROM public.orders_temp o
    LEFT JOIN public.internal_agents a ON a.id = o.producer_notes_updated_by
    WHERE o.company_id = ${companyId}
      AND o.id = ${orderId}
      AND COALESCE(o.is_deleted, false) = false
      AND o.producer_notes IS NOT NULL
      AND BTRIM(o.producer_notes) <> ''
    LIMIT 1`;

  const [serviceRows, producerRows] = await Promise.all([
    runSupabaseManagementQuery<Record<string, unknown>>(serviceSql, 20_000),
    runSupabaseManagementQuery<Record<string, unknown>>(producerSql, 20_000),
  ]);
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
        author: String(row.author ?? "Harper operator"),
        createdAt,
        updatedAt: null,
        edited: false,
        orderId: entryOrderId,
        orderLabel: `Order #${entryOrderId}`,
      },
    ];
  });

  const producerEntries = producerRows.flatMap(
    (row): NoteThreadEntry[] => {
      const body = String(row.body ?? "");
      if (!body.trim()) return [];
      const updatedAt = asTimestamp(row.updated_at);
      return [
        {
          id: `producer-${orderId}`,
          body,
          author: String(row.author ?? "Unknown producer"),
          createdAt: updatedAt,
          updatedAt,
          edited: false,
          orderId,
          orderLabel: `Order #${orderId}`,
        },
      ];
    },
  );

  return {
    accountId: companyId,
    orderId,
    producer: makeThread(
      "producer",
      "order",
      `company:${companyId}:order:${orderId}`,
      producerEntries,
    ),
    service: makeThread(
      "service",
      "account",
      `company:${companyId}`,
      serviceEntries,
    ),
  };
}

function cacheKey(companyId: number, orderId: number): string {
  return `${companyId}:${orderId}`;
}

function pruneThreadCache() {
  const now = Date.now();
  for (const [key, entry] of threadCache) {
    if (entry.expiresAt <= now) threadCache.delete(key);
  }
  while (threadCache.size > MAX_THREAD_CACHE_ENTRIES) {
    const oldest = threadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    threadCache.delete(oldest);
  }
}

export function invalidateNoteThreads(companyId: number): void {
  const prefix = `${companyId}:`;
  for (const key of threadCache.keys()) {
    if (key.startsWith(prefix)) threadCache.delete(key);
  }
}

export async function loadNoteThreads({
  companyId,
  orderId,
}: {
  companyId: number;
  orderId: number;
}): Promise<NoteThreadsResponse> {
  pruneThreadCache();
  const key = cacheKey(companyId, orderId);
  const cached = threadCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let pending = threadInFlight.get(key);
  if (!pending) {
    pending = fetchNoteThreads({ companyId, orderId });
    threadInFlight.set(key, pending);
  }
  try {
    const value = await pending;
    threadCache.set(key, {
      value,
      expiresAt: Date.now() + THREAD_CACHE_TTL_MS,
    });
    pruneThreadCache();
    return value;
  } finally {
    threadInFlight.delete(key);
  }
}
