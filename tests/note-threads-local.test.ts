import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * The local-first note thread path: once the book refresh has mirrored
 * Service Note threads into SQLite (marked by the `service_notes_synced_at`
 * book-meta key), `loadNoteThreads` answers entirely from local reads — no
 * Management API call, no TTL. These pin:
 *
 * - the dispatch: a ready mirror never touches the network, an unready one
 *   falls back to the legacy live path;
 * - thread content: service entries from `book_service_notes` (newest first,
 *   keeping their order anchors), the producer note from the order's synced
 *   `rich_json`;
 * - version parity: identical thread content hashes to the identical version
 *   on both paths, so AI summary cache keys survive the migration;
 * - the sync: `syncAccountsAndPolicies` mirrors snapshot entries wholesale
 *   and stamps the meta key, while pre-mirror snapshots leave both alone;
 * - the write-through primitive replaces exactly one account's thread.
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

const SCOPE = "operator:op-1";

const PRODUCER = {
  body: "Renewal – prioritize the binder request.",
  updatedAt: "2026-08-16T12:00:00.000Z",
  author: "Trace Dela Peña",
};

const NOTE_A = {
  id: "4658",
  orderId: 100,
  body: "Out for signature",
  author: "Ether Hammemi",
  createdAt: "2026-08-15T04:00:49.170Z",
};

const NOTE_B = {
  id: "4700",
  orderId: 200,
  body: "Carrier confirmed the endorsement",
  author: "Dakotah Rice",
  createdAt: "2026-08-16T09:30:00.000Z",
};

function richJson(producerNote: string | null): string {
  return JSON.stringify({
    producerNote,
    producerNoteUpdatedAt: producerNote ? PRODUCER.updatedAt : null,
    producerNoteUpdatedByName: producerNote ? PRODUCER.author : null,
    deals: [],
  });
}

async function loadModule() {
  vi.resetModules();
  const { migrate } = await import("@/lib/db/migrate");
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    `INSERT INTO underwriters (id, name, email, carrier)
     VALUES ('uw-x', 'X', 'x@example.com', 'X')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, name, industry, state, primary_uw_id)
     VALUES ('co-7', 'Local Notes Co', 'Testing', 'CA', 'uw-x')`,
  ).run();
  const insertOrder = db.prepare(
    `INSERT INTO book_orders (id, account_id, harper_order_id, rich_json, policy_numbers_json)
     VALUES (?, 'co-7', ?, ?, '[]')`,
  );
  insertOrder.run("order-100", 100, richJson(PRODUCER.body));
  insertOrder.run("order-200", 200, richJson(null));
  mem.db = db;

  const management = await import("@/lib/supabase-management.server");
  const query = management.runSupabaseManagementQuery as unknown as QueryMock;
  query.mockReset();
  const mod = await import("@/lib/note-threads.server");
  const meta = await import("@/lib/db/book-meta");
  return { db, module: mod, query, meta };
}

function insertNote(
  db: Database.Database,
  note: typeof NOTE_A,
  accountId = "co-7",
) {
  db.prepare(
    `INSERT INTO book_service_notes (id, account_id, order_id, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(note.id, accountId, note.orderId, note.body, note.author, note.createdAt);
}

function markMirrorReady(
  db: Database.Database,
  meta: typeof import("@/lib/db/book-meta"),
) {
  meta.writeBookMeta(
    db,
    meta.META_SERVICE_NOTES_SYNCED_AT,
    "2026-08-16T20:00:00.000Z",
  );
}

describe("local note threads", () => {
  it("serves both threads from SQLite without touching the network", async () => {
    const { db, module, query, meta } = await loadModule();
    insertNote(db, NOTE_A);
    insertNote(db, NOTE_B);
    markMirrorReady(db, meta);

    const result = await module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });

    expect(query.mock.calls.length).toBe(0);
    expect(result.producer.entries).toHaveLength(1);
    expect(result.producer.entries[0]).toMatchObject({
      id: "producer-100",
      body: PRODUCER.body,
      author: PRODUCER.author,
      createdAt: PRODUCER.updatedAt,
      orderId: 100,
    });
    // Account-scoped service thread, newest first, order anchors intact.
    expect(result.service.entries.map((entry) => entry.id)).toEqual([
      NOTE_B.id,
      NOTE_A.id,
    ]);
    expect(result.service.entries[0]).toMatchObject({
      body: NOTE_B.body,
      author: NOTE_B.author,
      orderId: 200,
      orderLabel: "Order #200",
    });
    expect(result.service.latestAt).toBe(NOTE_B.createdAt);
  });

  it("returns an empty producer thread when the order has no note", async () => {
    const { db, module, meta } = await loadModule();
    markMirrorReady(db, meta);

    const result = await module.loadNoteThreads({
      companyId: 7,
      orderId: 200,
      visibilityScope: SCOPE,
    });
    expect(result.producer.entries).toHaveLength(0);
    expect(result.service.entries).toHaveLength(0);
  });

  it("falls back to the live path while the mirror is not synced", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) =>
      sql.includes("service_note_entries")
        ? [
            {
              id: NOTE_A.id,
              order_id: NOTE_A.orderId,
              body: NOTE_A.body,
              created_at: NOTE_A.createdAt,
              author: NOTE_A.author,
            },
          ]
        : [],
    );

    const result = await module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });
    expect(query.mock.calls.length).toBeGreaterThan(0);
    expect(result.service.entries[0]?.id).toBe(NOTE_A.id);
  });

  it("hashes identical content to the identical version on both paths", async () => {
    // Live first: mirror not ready, Management API returns the same content
    // the mirror will later carry.
    const live = await loadModule();
    live.query.mockImplementation(async (sql: string) =>
      sql.includes("service_note_entries")
        ? [
            {
              id: NOTE_A.id,
              order_id: NOTE_A.orderId,
              body: NOTE_A.body,
              created_at: NOTE_A.createdAt,
              author: NOTE_A.author,
            },
          ]
        : [
            {
              id: "100",
              body: PRODUCER.body,
              updated_at: PRODUCER.updatedAt,
              author: PRODUCER.author,
            },
          ],
    );
    const liveResult = await live.module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });

    const local = await loadModule();
    insertNote(local.db, NOTE_A);
    markMirrorReady(local.db, local.meta);
    const localResult = await local.module.loadNoteThreads({
      companyId: 7,
      orderId: 100,
      visibilityScope: SCOPE,
    });

    expect(localResult.service.version).toBe(liveResult.service.version);
    expect(localResult.producer.version).toBe(liveResult.producer.version);
  });

  it("refuses an oversized thread exactly like the live path", async () => {
    const { db, module, meta } = await loadModule();
    const insert = db.prepare(
      `INSERT INTO book_service_notes (id, account_id, order_id, body, author, created_at)
       VALUES (?, 'co-7', 100, 'body', 'Author', '2026-08-01T00:00:00.000Z')`,
    );
    for (let i = 0; i < 500; i += 1) insert.run(`note-${i}`);
    markMirrorReady(db, meta);

    await expect(
      module.loadNoteThreads({ companyId: 7, orderId: 100, visibilityScope: SCOPE }),
    ).rejects.toThrow(/too large/);
  });

  it("write-through replaces exactly one account's thread", async () => {
    const { db, meta } = await loadModule();
    const { replaceAccountServiceNotes } = await import("@/lib/db/seed");
    insertNote(db, NOTE_A);
    insertNote(db, { ...NOTE_B, id: "9001", orderId: 900 }, "co-8");
    markMirrorReady(db, meta);

    replaceAccountServiceNotes(db, "co-7", [
      {
        id: "5000",
        accountId: "co-7",
        orderId: 100,
        body: "Fresh write-through note",
        author: "Ether Hammemi",
        createdAt: "2026-08-16T21:00:00.000Z",
      },
      // Foreign rows are ignored, never written under the wrong account.
      {
        id: "6000",
        accountId: "co-9",
        orderId: 901,
        body: "Wrong account",
        author: "X",
        createdAt: "2026-08-16T21:00:00.000Z",
      },
    ]);

    const rows = db
      .prepare(
        `SELECT id, account_id FROM book_service_notes ORDER BY account_id, id`,
      )
      .all() as { id: string; account_id: string }[];
    expect(rows).toEqual([
      { id: "5000", account_id: "co-7" },
      { id: "9001", account_id: "co-8" },
    ]);
  });
});

describe("service note mirror sync", () => {
  it("mirrors snapshot entries wholesale and stamps the meta key", async () => {
    const { db, meta } = await loadModule();
    const { setSupabaseBookCache } = await import("@/lib/supabase-book.server");
    const { syncAccountsAndPolicies } = await import("@/lib/db/seed");

    const account = {
      id: "co-7",
      name: "Local Notes Co",
      dba: null,
      industry: "Testing",
      addressLine1: null,
      city: null,
      state: "CA",
      zip: null,
      primaryUwId: "uw-unassigned",
      backupUwId: null,
      notes: "",
      status: "pre_bind" as const,
      paymentReceivedAt: null,
    };

    setSupabaseBookCache({
      fetchedAt: "2026-08-16T20:00:00.000Z",
      accounts: [account],
      policies: [],
      orders: [],
      contactKeys: [],
      serviceNoteEntries: [
        {
          id: NOTE_A.id,
          accountId: "co-7",
          orderId: NOTE_A.orderId,
          body: NOTE_A.body,
          author: NOTE_A.author,
          createdAt: NOTE_A.createdAt,
        },
        // Entries for accounts outside the book never land.
        {
          id: "7777",
          accountId: "co-unknown",
          orderId: 1,
          body: "orphan",
          author: "X",
          createdAt: NOTE_A.createdAt,
        },
      ],
      stageFieldsPresent: true,
      serviceNotesPresent: true,
      searchFieldsPresent: true,
      noteThreadsPresent: true,
    });
    syncAccountsAndPolicies(db);

    const rows = db
      .prepare(`SELECT id, account_id FROM book_service_notes`)
      .all() as { id: string; account_id: string }[];
    expect(rows).toEqual([{ id: NOTE_A.id, account_id: "co-7" }]);
    expect(meta.readBookMeta(db, meta.META_SERVICE_NOTES_SYNCED_AT)).toBe(
      "2026-08-16T20:00:00.000Z",
    );

    // A pre-mirror snapshot must not wipe the mirror nor unset the marker
    // while the forced full refresh is still in flight.
    setSupabaseBookCache({
      fetchedAt: "2026-08-16T20:05:00.000Z",
      accounts: [account],
      policies: [],
      orders: [],
      contactKeys: [],
      stageFieldsPresent: true,
      serviceNotesPresent: true,
      searchFieldsPresent: true,
      noteThreadsPresent: false,
    });
    syncAccountsAndPolicies(db);
    expect(
      db.prepare(`SELECT count(*) AS c FROM book_service_notes`).get(),
    ).toEqual({ c: 1 });
    expect(meta.readBookMeta(db, meta.META_SERVICE_NOTES_SYNCED_AT)).toBe(
      "2026-08-16T20:00:00.000Z",
    );
  });
});
