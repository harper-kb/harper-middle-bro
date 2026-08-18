import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * Payment-history durable cache (stale-while-revalidate over SQLite's
 * remote_cache) and the company-overview local-first dispatch. These pin:
 *
 * - a fresh page is served from the durable cache (the SSR preview warms the
 *   exact offset-0 key the first expand reads) — including by a *new process*
 *   over the same database, which the old in-memory map always lost;
 * - any older page returns instantly flagged `stale: true` while a background
 *   refetch replaces it for the next read;
 * - concurrent identical requests share one in-flight fetch;
 * - a known quota refusal is never retried inside the same blocked window;
 * - the overview reads local SQLite once the book mirror has synced, and
 *   falls back to the legacy live read until then.
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

const PAYMENT_ROW = {
  event_id: "payment:1",
  event_kind: "payment",
  raw_status: "settled",
  link_completed: false,
  amount: "565.07",
  currency: "usd",
  payment_purpose: null,
  is_payment_link: true,
  occurred_at: "2026-08-14T20:10:00.000Z",
  created_at: "2026-08-14T20:00:00.000Z",
  order_id: 11368,
  safe_reference: "CLGj6B",
  created_by: null,
  total_count: 3,
  settled_count: 3,
  settled_amount: "537.07",
  settled_currency: "USD",
};

const COMPANY_ROW = {
  id: 925148,
  company_name: "Acqua Schools LLC",
  company_street_address_1: null,
  company_street_address_2: null,
  company_city: null,
  company_state: null,
  company_state_code: null,
  company_postal_code: null,
  company_timezone: null,
  producer_id: null,
  producer_first_name: null,
  producer_last_name: null,
};

function respondByQuery(sql: string): unknown[] {
  if (sql.includes("cpq.payment")) return [PAYMENT_ROW];
  if (sql.includes("companies_contacts")) return [];
  return [COMPANY_ROW];
}

async function loadModule(options: { reuseDb?: boolean } = {}) {
  vi.resetModules();
  if (!options.reuseDb || !mem.db) {
    const { migrate } = await import("@/lib/db/migrate");
    const db = new Database(":memory:");
    migrate(db);
    mem.db = db;
  }
  const management = await import("@/lib/supabase-management.server");
  const query = management.runSupabaseManagementQuery as unknown as QueryMock;
  query.mockReset();
  const mod = await import("@/lib/company-detail.server");
  return { db: mem.db as InstanceType<typeof Database>, module: mod, query };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-16T21:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("payment history cache", () => {
  it("serves a fresh page from cache without re-querying", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));

    const first = await module.loadPaymentHistory({ companyId: 925148 });
    expect(first.items).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(first.settledAmountCents).toBe(53_707);
    expect(first.settledCurrency).toBe("USD");
    expect(first.settledCount).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);

    const second = await module.loadPaymentHistory({ companyId: 925148 });
    expect(second).toEqual(first);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight fetch across concurrent identical requests", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));

    const [a, b] = await Promise.all([
      module.loadPaymentHistory({ companyId: 925148 }),
      module.loadPaymentHistory({ companyId: 925148 }),
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("caches offsets independently", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));

    await module.loadPaymentHistory({ companyId: 925148, offset: 0 });
    await module.loadPaymentHistory({ companyId: 925148, offset: 20 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retry a cold request inside a known quota window", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_429");
    });

    await expect(
      module.loadPaymentHistory({ companyId: 925148 }),
    ).rejects.toThrow("supabase_management_http_429");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("survives a process restart: a new module over the same database serves the persisted page", async () => {
    const first = await loadModule();
    first.query.mockImplementation(async (sql: string) => respondByQuery(sql));
    const page = await first.module.loadPaymentHistory({ companyId: 925148 });
    expect(first.query).toHaveBeenCalledTimes(1);

    // Fresh module state (in-memory maps gone), same SQLite file.
    const restarted = await loadModule({ reuseDb: true });
    restarted.query.mockImplementation(async () => {
      throw new Error("must_not_be_called");
    });
    const revived = await restarted.module.loadPaymentHistory({
      companyId: 925148,
    });
    expect(revived).toEqual(page);
    expect(restarted.query).not.toHaveBeenCalled();
  });

  it("serves a page inside the SWR window instantly and revalidates in the background", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));
    const fresh = await module.loadPaymentHistory({ companyId: 925148 });
    expect(query).toHaveBeenCalledTimes(1);

    // Past the 60s fresh TTL, inside the 30-minute SWR window.
    vi.setSystemTime(new Date("2026-08-16T21:15:00.000Z"));
    let resolveRefetch: (rows: unknown[]) => void = () => {};
    query.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          resolveRefetch = () => resolve(respondByQuery(sql));
        }),
    );

    const stale = await module.loadPaymentHistory({ companyId: 925148 });
    // Served immediately (no await on the live query), honestly flagged.
    expect(stale.items).toEqual(fresh.items);
    expect(stale.stale).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    resolveRefetch([]);
  });

  it("answers a failed refetch from the stale page inside the SWR window", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));
    const fresh = await module.loadPaymentHistory({ companyId: 925148 });

    // Past the fresh TTL; the live path now fails.
    vi.setSystemTime(new Date("2026-08-16T21:02:00.000Z"));
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_429");
    });

    const stale = await module.loadPaymentHistory({ companyId: 925148 });
    expect(stale.items).toEqual(fresh.items);
    expect(stale.total).toBe(fresh.total);
    expect(stale.stale).toBe(true);
  });

  it("serves any-age cached data instantly while it revalidates", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));
    const fresh = await module.loadPaymentHistory({ companyId: 925148 });

    // Well past the old 24h fallback ceiling.
    vi.setSystemTime(new Date("2026-08-18T21:30:00.000Z"));
    query.mockImplementation(async () => {
      throw new Error("supabase_management_http_502");
    });

    const stale = await module.loadPaymentHistory({ companyId: 925148 });
    expect(stale.items).toEqual(fresh.items);
    expect(stale.stale).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("company overview retry", () => {
  it("retries a transient failure once before resolving", async () => {
    const { module, query } = await loadModule();
    let failures = 1;
    query.mockImplementation(async (sql: string) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("supabase_management_http_502");
      }
      return respondByQuery(sql);
    });

    const overview = await module.loadCompanyOverview(925148);
    expect(overview.name).toBe("Acqua Schools LLC");
    expect(overview.stale).toBe(false);
  });

  it("reads the company-level IANA field and preserves the stable company ID", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("companies_contacts")) return [];
      return [
        {
          ...COMPANY_ROW,
          id: 919472,
          company_name: "Loyalty Security Services",
          company_timezone: "America/Chicago",
          company_city: "Omaha",
          company_state: "Nebraska",
          company_state_code: "NE",
          company_postal_code: "68107",
        },
      ];
    });

    const overview = await module.loadCompanyOverview(919472);
    expect(overview.companyId).toBe(919472);
    expect(overview.location.stateCode).toBe("NE");
    expect(overview.timeZone).toEqual({
      id: "America/Chicago",
      source: "stored_iana",
      unavailableReason: null,
    });
    const companySql = String(query.mock.calls[0]?.[0]);
    expect(companySql).toContain("c.company_timezone");
    expect(companySql).not.toContain("peer.company_postal_code");
  });

  it("keeps local time unavailable when location is incomplete", async () => {
    const { module, query } = await loadModule();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("companies_contacts")) return [];
      return [
        {
          ...COMPANY_ROW,
          id: 919472,
          company_name: "Loyalty Security Services",
          company_postal_code: "68107",
          company_timezone: null,
        },
      ];
    });

    const overview = await module.loadCompanyOverview(919472);
    expect(overview.timeZone).toEqual({
      id: null,
      source: null,
      unavailableReason: "state_missing",
    });
  });
});

describe("company overview local mirror", () => {
  it("serves the overview from SQLite without touching the network once synced", async () => {
    const { db, module, query } = await loadModule();
    db.prepare(
      `INSERT INTO underwriters (id, name, email, carrier)
       VALUES ('uw-x', 'X', 'x@example.com', 'X')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, name, dba, industry, state, primary_uw_id)
       VALUES ('co-919472', 'Loyalty Security Services', 'Loyalty Omaha', 'Security', 'NE', 'uw-x')`,
    ).run();
    db.prepare(
      `INSERT INTO book_company_details
         (account_id, address1, address2, city, state, state_code,
          postal_code, time_zone, producer_id, producer_name)
       VALUES ('co-919472', '5440 South 21st Street', NULL, 'Omaha',
               'Nebraska', 'NE', '68107', 'America/Chicago', 49, 'Khadija Gueye')`,
    ).run();
    const insertContact = db.prepare(
      `INSERT INTO book_contacts (account_id, contact_id, name, email, phone, position)
       VALUES ('co-919472', ?, ?, ?, ?, ?)`,
    );
    insertContact.run(2, "Taylor Reed", "taylor@example.com", null, 1);
    insertContact.run(1, "Jesus Leal", "lealjr0519@gmail.com", "+14025419217", 0);
    db.prepare(
      `INSERT INTO book_meta (key, value)
       VALUES ('company_details_synced_at', '2026-08-16T20:59:00.000Z')`,
    ).run();
    query.mockImplementation(async () => {
      throw new Error("must_not_be_called");
    });

    const overview = await module.loadCompanyOverview(919472);
    expect(query).not.toHaveBeenCalled();
    expect(overview).toMatchObject({
      companyId: 919472,
      name: "Loyalty Security Services",
      dba: "Loyalty Omaha",
      producer: { id: 49, name: "Khadija Gueye" },
      stale: false,
      fetchedAt: "2026-08-16T20:59:00.000Z",
    });
    expect(overview.location).toEqual({
      address1: "5440 South 21st Street",
      address2: null,
      city: "Omaha",
      state: "Nebraska",
      stateCode: "NE",
      postalCode: "68107",
      country: null,
    });
    expect(overview.timeZone).toEqual({
      id: "America/Chicago",
      source: "stored_iana",
      unavailableReason: null,
    });
    // Source ordering (position), not contact-id ordering.
    expect(overview.contacts.map((contact) => contact.name)).toEqual([
      "Jesus Leal",
      "Taylor Reed",
    ]);
  });

  it("falls back to the live read for an account outside the mirror", async () => {
    const { db, module, query } = await loadModule();
    // Mirror synced, but this account carries no detail row (left the book).
    db.prepare(
      `INSERT INTO book_meta (key, value)
       VALUES ('company_details_synced_at', '2026-08-16T20:59:00.000Z')`,
    ).run();
    query.mockImplementation(async (sql: string) => respondByQuery(sql));

    const overview = await module.loadCompanyOverview(925148);
    expect(overview.name).toBe("Acqua Schools LLC");
    expect(query).toHaveBeenCalled();
  });
});
