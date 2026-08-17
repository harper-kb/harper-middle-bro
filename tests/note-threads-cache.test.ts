import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * Note-thread live-fallback cache resilience. Threads are normally served
 * from the SQLite mirror (see note-threads-local.test.ts); this suite pins
 * the legacy live path that covers the window before the first mirrored
 * snapshot lands — the fixture database deliberately carries no
 * `service_notes_synced_at` marker so every call takes that path:
 *
 * - the account-scoped Service thread is fetched once per account, not once
 *   per expanded order card;
 * - a transient Management API failure is retried once, then answered from
 *   the stale cache when possible;
 * - only a failure with nothing cached surfaces an error, and writes still
 *   invalidate hard so a fresh note is never answered with stale data.
 */

vi.mock("@/lib/supabase-management.server", () => ({
  runSupabaseManagementQuery: vi.fn(),
}));

const mem = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => mem.db,
  resetDatabase: () => {},
}));

type QueryMock = ReturnType<typeof vi.fn>;

const PRODUCER_ROW = {
  id: "11368",
  body: "Renewal – prioritize the binder request.",
  updated_at: "2026-08-16T12:00:00.000Z",
  author: "Trace Dela Peña",
};

const SERVICE_ROW = {
  id: "4658",
  order_id: 11368,
  body: "Out for signature",
  created_at: "2026-08-15T04:00:49.170Z",
  author: "Ether Hammemi",
};

function respondByQuery(sql: string): unknown[] {
  return sql.includes("service_note_entries") ? [SERVICE_ROW] : [PRODUCER_ROW];
}

async function loadModule() {
  vi.resetModules();
  const { migrate } = await import("@/lib/db/migrate");
  const db = new Database(":memory:");
  migrate(db);
  mem.db = db;
  const management = await import("@/lib/supabase-management.server");
  const query = management.runSupabaseManagementQuery as unknown as QueryMock;
  query.mockReset();
  const mod = await import("@/lib/note-threads.server");
  return { module: mod, query };
}

function callsByKind(query: QueryMock) {
  const sqls = query.mock.calls.map((call) => String(call[0]));
  return {
    producer: sqls.filter((sql) => sql.includes("orders_temp")).length,
    service: sqls.filter((sql) => sql.includes("service_note_entries")).length,
  };
}

const SCOPE = "operator:op-1";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-16T20:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("note thread cache", () => {
  it("fetches the account-scoped service thread once across order cards", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));

    const [a, b] = await Promise.all([
      module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE }),
      module.loadNoteThreads({ companyId: 7, orderId: 200, visibilityScope: SCOPE }),
    ]);

    const calls = callsByKind(query);
    expect(calls.service).toBe(1);
    expect(calls.producer).toBe(2);
    expect(a.service.version).toBe(b.service.version);
    expect(a.orderId).toBe(100);
    expect(b.orderId).toBe(200);
  });

  it("serves the fresh cache without re-querying", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));

    await module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE });
    const callsAfterFirst = query.mock.calls.length;
    await module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE });
    expect(query.mock.calls.length).toBe(callsAfterFirst);
  });

  it("retries a transient failure once before giving up", async () => {
    const { module, query } = await loadModule();
    let failures = 2; // both units fail their first attempt
    query.mockImplementation(async (sql: string) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("supabase_management_http_429");
      }
      return respondByQuery(sql);
    });

    const result = await module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });
    expect(result.producer.entries).toHaveLength(1);
    expect(result.service.entries).toHaveLength(1);
  });

  it("answers from the stale cache when the live fetch fails", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));
    const first = await module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });

    // Past the fresh TTL but inside the stale window; the live path now fails.
    vi.setSystemTime(new Date("2026-08-16T20:00:20.000Z"));
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_429");
    });

    const second = await module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });
    expect(second.producer.version).toBe(first.producer.version);
    expect(second.service.version).toBe(first.service.version);
    expect(second.service.entries[0]?.body).toBe(SERVICE_ROW.body);
  });

  it("fails when nothing is cached and the fetch keeps failing", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_502");
    });

    await expect(
      module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE }),
    ).rejects.toThrow("supabase_management_http_502");
  });

  it("never answers with stale data after a write invalidates the account", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));
    await module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE });

    module.invalidateNoteThreads(7);
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_502");
    });

    await expect(
      module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE }),
    ).rejects.toThrow("supabase_management_http_502");
  });

  it("keeps other accounts cached when one account is invalidated", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));
    await module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE });
    const other = await module.loadNoteThreads({
      companyId: 8,
      orderId: 300,
      visibilityScope: SCOPE,
    });

    module.invalidateNoteThreads(7);
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_502");
    });

    // Account 8 stays served from its fresh cache; account 7 must refetch.
    const cached = await module.loadNoteThreads({
      companyId: 8,
      orderId: 300,
      visibilityScope: SCOPE,
    });
    expect(cached.service.version).toBe(other.service.version);
    await expect(
      module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE }),
    ).rejects.toThrow();
  });
});
