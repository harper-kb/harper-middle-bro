import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * Canonical payment read model. These pin the merge of the payment-link
 * registry (public.payments), CLS (cpq.payment), legacy Ascend, and refunds
 * into one deduplicated history:
 *
 * - the regression fixture mirrors the reconciled live company that Big
 *   Brother showed 7 link records for while Step Bro showed 1 CLS row
 *   (anonymized IDs, real shape: mixed sources, two equal-amount links,
 *   registry-only settlements, one merged CLS row);
 * - status normalization is deliberate per raw vocabulary, and the registry's
 *   completed flag upgrades a lagging CLS initiated/processing row without
 *   ever overriding a terminal CLS state;
 * - link-sent records never count toward settled money;
 * - the SQL keeps every company account (no primary-only filter), reads all
 *   provider tables, and collapses duplicate CLS rows per link+transfer.
 */

vi.mock("@/lib/supabase-management.server", () => ({
  runSupabaseManagementQuery: vi.fn(),
}));

// Payment pages persist in SQLite (remote_cache); each loadModule gets a
// fresh in-memory database so fixtures never serve each other from cache.
const mem = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => mem.db,
  resetDatabase: () => {},
}));

type QueryMock = ReturnType<typeof vi.fn>;

interface FixtureRow {
  event_id: string;
  event_kind: "payment" | "refund";
  raw_status: string | null;
  link_completed: boolean;
  amount: string | null;
  currency: string | null;
  payment_purpose: string | null;
  is_payment_link: boolean;
  occurred_at: string | null;
  created_at: string | null;
  order_id: number | null;
  safe_reference: string | null;
  created_by: string | null;
  total_count: number;
}

function row(overrides: Partial<FixtureRow>): FixtureRow {
  return {
    event_id: "link:payment_link_fixture",
    event_kind: "payment",
    raw_status: "pending",
    link_completed: false,
    amount: "100.00",
    currency: "USD",
    payment_purpose: null,
    is_payment_link: true,
    occurred_at: "2026-08-01T00:00:00+00",
    created_at: "2026-08-01T00:00:00+00",
    order_id: null,
    safe_reference: "abc123",
    created_by: null,
    total_count: 1,
    ...overrides,
  };
}

/**
 * Anonymized reconstruction of the reconciled example company: 7 canonical
 * link records across three producer surfaces, two orders, three settled and
 * four link-sent, including two legitimately separate $1,241.00 links.
 */
const RECONCILED_COMPANY_ROWS: FixtureRow[] = [
  row({
    event_id: "link:payment_link_alpha",
    raw_status: "completed",
    link_completed: true,
    amount: "281.40",
    occurred_at: "2026-08-15T12:41:46+00",
    created_at: "2026-08-13T20:20:31+00",
    order_id: 62,
    safe_reference: "alpha6",
    created_by: "producer.a@example.com",
    total_count: 7,
  }),
  row({
    event_id: "link:payment_link_bravo",
    raw_status: "pending",
    amount: "941.00",
    occurred_at: "2026-07-31T15:55:30+00",
    created_at: "2026-07-31T15:55:30+00",
    safe_reference: "bravo6",
    created_by: "producer.a@example.com",
    total_count: 7,
  }),
  row({
    event_id: "link:payment_link_charlie",
    raw_status: "pending",
    amount: "326.40",
    occurred_at: "2026-05-27T23:04:50+00",
    created_at: "2026-05-27T23:04:50+00",
    safe_reference: "charl6",
    created_by: "producer.b@example.com",
    total_count: 7,
  }),
  row({
    event_id: "link:payment_link_delta",
    raw_status: "pending",
    amount: "1241.00",
    occurred_at: "2026-05-27T23:04:31+00",
    created_at: "2026-05-27T23:04:31+00",
    safe_reference: "delta6",
    created_by: "producer.b@example.com",
    total_count: 7,
  }),
  row({
    // Merged with its CLS row: raw status comes from cpq.payment.
    event_id: "link:payment_link_echo",
    raw_status: "settled",
    link_completed: true,
    amount: "98.17",
    occurred_at: "2026-05-01T23:44:43+00",
    created_at: "2026-05-01T23:43:50+00",
    order_id: 62,
    safe_reference: "echo66",
    created_by: "U0EXAMPLE",
    total_count: 7,
  }),
  row({
    event_id: "link:payment_link_foxtrot",
    raw_status: "completed",
    link_completed: true,
    amount: "157.50",
    occurred_at: "2026-03-26T20:54:41+00",
    created_at: "2026-03-25T21:47:51+00",
    order_id: 61,
    safe_reference: "foxtr6",
    created_by: "producer.c@example.com",
    total_count: 7,
  }),
  row({
    event_id: "link:payment_link_golf",
    raw_status: "pending",
    amount: "1241.00",
    occurred_at: "2026-03-25T21:44:48+00",
    created_at: "2026-03-25T21:44:48+00",
    safe_reference: "golf66",
    created_by: "producer.c@example.com",
    total_count: 7,
  }),
];

async function loadModule() {
  vi.resetModules();
  const { migrate } = await import("@/lib/db/migrate");
  const db = new Database(":memory:");
  migrate(db);
  mem.db = db;
  const management = await import("@/lib/supabase-management.server");
  const query = management.runSupabaseManagementQuery as unknown as QueryMock;
  query.mockReset();
  const mod = await import("@/lib/company-detail.server");
  return { module: mod, query };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-16T21:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reconciled company regression fixture", () => {
  it("keeps all seven canonical link records with truthful statuses and totals", async () => {
    const { module, query } = await loadModule();
    query.mockResolvedValue(RECONCILED_COMPANY_ROWS);

    const page = await module.loadPaymentHistory({ companyId: 987654 });
    expect(page.total).toBe(7);
    expect(page.items).toHaveLength(7);
    expect(page.items.map((item) => item.status)).toEqual([
      "settled",
      "link_sent",
      "link_sent",
      "link_sent",
      "settled",
      "settled",
      "link_sent",
    ]);

    // Settled money comes only from settled records; link-sent rows never
    // contribute to it.
    const settledCents = page.items
      .filter((item) => item.status === "settled")
      .reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
    const pendingCents = page.items
      .filter((item) => item.status === "link_sent")
      .reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
    expect(settledCents).toBe(53_707);
    expect(pendingCents).toBe(374_940);
    expect(page.settledAmountCents).toBe(53_707);
    expect(page.settledCurrency).toBe("USD");
    expect(page.settledCount).toBe(3);

    // Two legitimately separate equal-amount links stay separate rows.
    const equalAmount = page.items.filter(
      (item) => item.amountCents === 124_100,
    );
    expect(equalAmount).toHaveLength(2);
    expect(new Set(equalAmount.map((item) => item.id)).size).toBe(2);

    // The most-recent preview is the canonical latest record.
    expect(page.items[0]).toMatchObject({
      id: "link:payment_link_alpha",
      status: "settled",
      amountCents: 28_140,
      orderId: 62,
      createdBy: "producer.a@example.com",
    });

    // Order attribution stays null when no evidence exists, rather than
    // being guessed.
    expect(page.items[1]?.orderId).toBeNull();
    expect(page.items[5]?.orderId).toBe(61);
  });
});

describe("status normalization", () => {
  async function statusesFor(rows: FixtureRow[]) {
    const { module, query } = await loadModule();
    query.mockResolvedValue(rows);
    const page = await module.loadPaymentHistory({ companyId: 424242 });
    return page.items;
  }

  it("maps every raw vocabulary deliberately and keeps unknowns unknown", async () => {
    const items = await statusesFor([
      row({ event_id: "link:a", raw_status: "pending", total_count: 9 }),
      row({ event_id: "link:b", raw_status: "completed", link_completed: true, total_count: 9 }),
      row({ event_id: "payment:1", raw_status: "initiated", total_count: 9 }),
      row({ event_id: "payment:2", raw_status: "processing", total_count: 9 }),
      row({ event_id: "payment:3", raw_status: "returned", total_count: 9 }),
      row({ event_id: "payment:4", raw_status: "cancelled", total_count: 9 }),
      row({ event_id: "ascend:1", raw_status: "paid", is_payment_link: false, total_count: 9 }),
      row({ event_id: "ascend:2", raw_status: "void", is_payment_link: false, total_count: 9 }),
      row({
        event_id: "ascend:3",
        raw_status: "processing_payment",
        is_payment_link: false,
        total_count: 9,
      }),
    ]);
    expect(items.map((item) => item.status)).toEqual([
      "link_sent",
      "settled",
      "link_sent",
      "processing",
      "returned",
      "voided",
      "settled",
      "voided",
      "processing",
    ]);
    expect(items[6]?.type).toBe("payment");
    expect(items[0]?.type).toBe("payment_link");
  });

  it("upgrades a lagging CLS row when the registry settled, but never a terminal state", async () => {
    const items = await statusesFor([
      row({
        event_id: "link:lagging",
        raw_status: "initiated",
        link_completed: true,
        total_count: 4,
      }),
      row({
        event_id: "link:lagging-processing",
        raw_status: "processing",
        link_completed: true,
        total_count: 4,
      }),
      row({
        event_id: "link:terminal",
        raw_status: "cancelled",
        link_completed: true,
        total_count: 4,
      }),
      row({
        event_id: "link:strange",
        raw_status: "mystery_state",
        link_completed: false,
        total_count: 4,
      }),
    ]);
    expect(items.map((item) => item.status)).toEqual([
      "settled",
      "settled",
      "voided",
      "unknown",
    ]);
    // Raw statuses are preserved for diagnostics.
    expect(items.map((item) => item.rawStatus)).toEqual([
      "initiated",
      "processing",
      "cancelled",
      "mystery_state",
    ]);
  });

  it("normalizes refund lifecycle states separately", async () => {
    const items = await statusesFor([
      row({
        event_id: "refund:1",
        event_kind: "refund",
        raw_status: "completed",
        is_payment_link: false,
        total_count: 3,
      }),
      row({
        event_id: "refund:2",
        event_kind: "refund",
        raw_status: "pending",
        is_payment_link: false,
        total_count: 3,
      }),
      row({
        event_id: "refund:3",
        event_kind: "refund",
        raw_status: "failed",
        is_payment_link: false,
        total_count: 3,
      }),
    ]);
    expect(items.map((item) => item.status)).toEqual([
      "refunded",
      "refund_pending",
      "refund_failed",
    ]);
    expect(items.every((item) => item.type === "refund")).toBe(true);
  });
});

describe("field handling", () => {
  it("parses decimal dollar amounts exactly once and keeps optional fields honest", async () => {
    const { module, query } = await loadModule();
    query.mockResolvedValue([
      row({
        event_id: "link:amounts",
        amount: "1241.00",
        created_by: null,
        order_id: null,
        total_count: 2,
      }),
      row({
        event_id: "link:no-amount",
        amount: null,
        created_by: "  spaced@example.com  ",
        total_count: 2,
      }),
    ]);

    const page = await module.loadPaymentHistory({ companyId: 313131 });
    expect(page.items[0]?.amountCents).toBe(124_100);
    expect(page.items[0]?.createdBy).toBeNull();
    expect(page.items[0]?.orderId).toBeNull();
    expect(page.items[1]?.amountCents).toBeNull();
    expect(page.items[1]?.createdBy).toBe("spaced@example.com");
  });

  it("drops rows without any usable timestamp instead of fabricating one", async () => {
    const { module, query } = await loadModule();
    query.mockResolvedValue([
      row({ event_id: "link:ok", total_count: 2 }),
      row({
        event_id: "link:broken",
        occurred_at: null,
        created_at: null,
        total_count: 2,
      }),
    ]);
    const page = await module.loadPaymentHistory({ companyId: 515151 });
    expect(page.items.map((item) => item.id)).toEqual(["link:ok"]);
    expect(page.total).toBe(2);
  });
});

describe("canonical query shape", () => {
  it("reads every provider table, keeps all company accounts, and dedupes lifecycle rows", async () => {
    const { module, query } = await loadModule();
    query.mockResolvedValue([]);
    await module.loadPaymentHistory({ companyId: 616161 });

    const sql = String(query.mock.calls[0]?.[0]);
    // The payment-link registry is the source Big Brother lists; keyed by the
    // stable company id.
    expect(sql).toContain("FROM public.payments pp");
    expect(sql).toContain("pp.company_id = 616161");
    // CLS joins by every mapped account and by link ref — never only the
    // primary account.
    expect(sql).not.toContain("is_primary");
    expect(sql).toContain("FULL JOIN cls_primary");
    // One canonical row per link+transfer; duplicate CLS rows collapse while
    // genuine repeat transfers survive.
    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain("IS DISTINCT FROM canonical_reference");
    // Legacy provider and refunds stay part of the history.
    expect(sql).toContain("public.payments_ascend");
    expect(sql).toContain("cpq.refund");
    // Order attribution requires unambiguous evidence.
    expect(sql).toContain("HAVING COUNT(DISTINCT order_id) = 1");
    // Account-level settled totals are computed before pagination.
    expect(sql).toContain("payment_summary AS");
    expect(sql).toContain("COUNT(*) FILTER (WHERE is_settled)");
    expect(sql).toContain("CROSS JOIN payment_summary");
    expect(sql).toContain("ORDER BY events.occurred_at_ts DESC NULLS LAST");
  });
});
