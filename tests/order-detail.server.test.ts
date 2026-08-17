import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("@/lib/supabase-management.server", () => ({
  runSupabaseManagementQuery: vi.fn(),
}));

vi.mock("@/lib/adapters/agent-tools", () => ({
  executeAgentToolsCommand: vi.fn(),
}));

// Detail payloads persist in SQLite keyed by the order's book digest; the
// module reads/writes through the mocked connection's in-memory database.
const mem = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => {
    if (!mem.db) {
      const db = new Database(":memory:");
      db.exec(
        `CREATE TABLE remote_cache (
           cache_key TEXT PRIMARY KEY,
           payload TEXT NOT NULL,
           fetched_at INTEGER NOT NULL
         );
         CREATE TABLE book_sync_digests (
           kind TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL,
           PRIMARY KEY (kind, id)
         )`,
      );
      mem.db = db;
    }
    return mem.db;
  },
  resetDatabase: () => {},
}));

import { executeAgentToolsCommand } from "@/lib/adapters/agent-tools";
import {
  _resetOrderDetailCacheForTests,
  decimalToCents,
  isEligibleInitialPayment,
  loadOrderDetail,
  mintOrderQuoteUrl,
  paymentMethodLabel,
  paymentPlanLabel,
  publicOrderDetail,
  quoteFileType,
  resolveBoundPolicies,
  selectInitialPayment,
  selectOrderQuote,
  type InitialPaymentCandidate,
  type QuoteCandidate,
} from "@/lib/order-detail.server";
import { runSupabaseManagementQuery } from "@/lib/supabase-management.server";

const query = vi.mocked(runSupabaseManagementQuery);
const execute = vi.mocked(executeAgentToolsCommand);

function quote(
  overrides: Partial<QuoteCandidate> = {},
): QuoteCandidate {
  return {
    source: "order_document",
    sourceRank: 100,
    sourcePrecedence: 0,
    designatedAt: null,
    documentAt: "2026-08-10T12:00:00.000Z",
    quoteId: null,
    originalQuoteId: null,
    isPrimary: false,
    artifactId: null,
    legacyDocumentId: 101,
    fileName: "quote.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1000,
    classificationType: "QUOTE",
    ...overrides,
  };
}

function payment(
  overrides: Partial<InitialPaymentCandidate> = {},
): InitialPaymentCandidate {
  return {
    orderId: 10617,
    paymentId: 1,
    status: "settled",
    paymentPurpose: "full_premium",
    amountCents: 45_816,
    currency: "USD",
    settledAt: "2026-07-08T23:44:51.000Z",
    postedAt: null,
    initiatedAt: "2026-07-08T12:13:14.000Z",
    failedAt: null,
    cancelledAt: null,
    invoiceCancelledAt: null,
    invoiceVoidedAt: null,
    invoiceSupersededById: null,
    hasCompletedRefund: false,
    orderCorroborated: true,
    instrumentType: "BANK_ACCOUNT",
    cardType: null,
    paymentMethod: "card",
    ...overrides,
  };
}

function rawQuote(candidate: QuoteCandidate) {
  return {
    source: candidate.source,
    sourceRank: candidate.sourceRank,
    sourcePrecedence: candidate.sourcePrecedence,
    designatedAt: candidate.designatedAt,
    documentAt: candidate.documentAt,
    quoteId: candidate.quoteId,
    originalQuoteId: candidate.originalQuoteId,
    isPrimary: candidate.isPrimary,
    artifactId: candidate.artifactId,
    legacyDocumentId: candidate.legacyDocumentId,
    fileName: candidate.fileName,
    mimeType: candidate.mimeType,
    sizeBytes: candidate.sizeBytes,
    classificationType: candidate.classificationType,
  };
}

function rawPayment(candidate: InitialPaymentCandidate) {
  return {
    orderId: candidate.orderId,
    paymentId: candidate.paymentId,
    status: candidate.status,
    paymentPurpose: candidate.paymentPurpose,
    amount:
      candidate.amountCents === null
        ? null
        : (candidate.amountCents / 100).toFixed(2),
    currency: candidate.currency,
    settledAt: candidate.settledAt,
    postedAt: candidate.postedAt,
    initiatedAt: candidate.initiatedAt,
    failedAt: candidate.failedAt,
    cancelledAt: candidate.cancelledAt,
    invoiceCancelledAt: candidate.invoiceCancelledAt,
    invoiceVoidedAt: candidate.invoiceVoidedAt,
    invoiceSupersededById: candidate.invoiceSupersededById,
    hasCompletedRefund: candidate.hasCompletedRefund,
    orderCorroborated: candidate.orderCorroborated,
    instrumentType: candidate.instrumentType,
    cardType: candidate.cardType,
    paymentMethod: candidate.paymentMethod,
  };
}

function boundPolicy(overrides: Record<string, unknown> = {}) {
  return {
    dealId: 15669,
    dealStage: "bound",
    policyId: 14146,
    policyNumber: "CSG-00532165-00",
    status: "bound",
    carrierName: "Spinnaker Insurance Company",
    wholesalerName: "Coterie",
    policyCoverageLines: [
      { coverage_type: "General Liability" },
      { coverage_type: "Property" },
    ],
    dealCoverageType: ["GL"],
    effectiveDate: "2026-08-11",
    expirationDate: "2027-08-11",
    policyPremiumCents: 30_000,
    dealPremium: "300.00",
    currency: "USD",
    boundAt: "2026-08-11T02:34:06.471Z",
    ...overrides,
  };
}

function responseRow({
  orderId = 10617,
  quoteCandidates = [],
  paymentCandidates = [],
  boundPolicyCandidates = [],
  clientInitialPayment = null,
  harperFee = null,
  paymentType = null,
}: {
  orderId?: number;
  quoteCandidates?: QuoteCandidate[];
  paymentCandidates?: InitialPaymentCandidate[];
  boundPolicyCandidates?: Record<string, unknown>[];
  clientInitialPayment?: string | null;
  harperFee?: string | null;
  paymentType?: string | null;
} = {}) {
  return {
    order_id: orderId,
    client_initial_payment: clientInitialPayment,
    harper_service_fee: harperFee,
    payment_type: paymentType,
    quote_candidates: quoteCandidates.map(rawQuote),
    payment_candidates: paymentCandidates.map(rawPayment),
    bound_policy_candidates: boundPolicyCandidates,
  };
}

beforeEach(() => {
  _resetOrderDetailCacheForTests();
  query.mockReset();
  execute.mockReset();
});

describe("order quote selection", () => {
  it("prefers an explicit canonical selection over a newer fallback document", () => {
    const selected = selectOrderQuote([
      quote({
        documentAt: "2026-08-15T12:00:00.000Z",
        legacyDocumentId: 202,
        fileName: "newer-unselected.pdf",
      }),
      quote({
        source: "deal_quote_selection",
        sourceRank: 500,
        sourcePrecedence: 100,
        designatedAt: "2026-08-12T12:00:00.000Z",
        quoteId: 54758,
        artifactId: "harper:artifact:canonical",
        legacyDocumentId: null,
        fileName: "selected.pdf",
      }),
    ]);

    expect(selected?.fileName).toBe("selected.pdf");
    expect(selected?.artifactId).toBe("harper:artifact:canonical");
  });

  it("uses the primary revision, then newest deterministic fallback", () => {
    const primary = quote({
      source: "deal_quote_selection",
      sourceRank: 500,
      quoteId: 12,
      originalQuoteId: 10,
      isPrimary: true,
      artifactId: "harper:artifact:primary",
      legacyDocumentId: null,
      documentAt: "2026-08-10T00:00:00.000Z",
    });
    const newer = quote({
      source: "deal_quote_selection",
      sourceRank: 500,
      quoteId: 13,
      originalQuoteId: 10,
      artifactId: "harper:artifact:newer",
      legacyDocumentId: null,
      documentAt: "2026-08-12T00:00:00.000Z",
    });
    expect(selectOrderQuote([newer, primary])?.artifactId).toBe(
      "harper:artifact:primary",
    );
    expect(
      selectOrderQuote([
        { ...primary, isPrimary: false },
        newer,
      ])?.artifactId,
    ).toBe("harper:artifact:newer");
  });

  it("keeps non-quote documents out and derives a compact file type", () => {
    expect(
      selectOrderQuote([
        quote({ classificationType: "BINDER", fileName: "binder.pdf" }),
      ]),
    ).toBeNull();
    expect(quoteFileType("application/pdf", "anything.bin")).toBe("PDF");
    expect(quoteFileType(null, "proposal.docx")).toBe("DOCX");
  });
});

describe("initial order payment selection", () => {
  it("excludes failed, voided, refunded, returned, link-only, and unrelated rows", () => {
    const valid = payment({
      paymentId: 9,
      paymentPurpose: "down_payment",
      instrumentType: "BANK_ACCOUNT",
    });
    const candidates = [
      payment({ paymentId: 2, orderId: 99999 }),
      payment({ paymentId: 3, failedAt: "2026-07-09T00:00:00Z" }),
      payment({ paymentId: 4, invoiceVoidedAt: "2026-07-09T00:00:00Z" }),
      payment({ paymentId: 5, hasCompletedRefund: true }),
      payment({ paymentId: 6, status: "returned" }),
      payment({ paymentId: 7, status: "initiated", settledAt: null }),
      payment({ paymentId: 8, orderCorroborated: false }),
      valid,
    ];

    expect(
      candidates.filter((candidate) =>
        isEligibleInitialPayment(candidate, 10617),
      ),
    ).toEqual([valid]);
    expect(selectInitialPayment(candidates, 10617, 45_816)).toEqual({
      paymentId: 9,
      amountCents: 45_816,
      currency: "USD",
      method: "ACH",
      status: "settled",
      statusLabel: "Settled",
    });
  });

  it("uses the designated down payment, otherwise the earliest valid payment", () => {
    const earlierFull = payment({
      paymentId: 10,
      amountCents: 100_000,
      settledAt: "2026-07-08T10:00:00Z",
    });
    const down = payment({
      paymentId: 11,
      paymentPurpose: "down_payment",
      amountCents: 30_000,
      settledAt: "2026-07-08T11:00:00Z",
    });
    expect(
      selectInitialPayment([earlierFull, down], 10617, null)?.paymentId,
    ).toBe(11);
    expect(
      selectInitialPayment(
        [earlierFull, { ...down, status: "returned" }],
        10617,
        null,
      )?.paymentId,
    ).toBe(10);
  });

  it("takes the method from the selected payment's normalized instrument", () => {
    expect(
      paymentMethodLabel({
        instrumentType: "PAYMENT_CARD",
        cardType: "DEBIT",
        paymentMethod: "ach",
      }),
    ).toBe("Debit card");
    expect(
      paymentMethodLabel({
        instrumentType: null,
        cardType: null,
        paymentMethod: "ach",
      }),
    ).toBe("ACH");
  });

  it("selects a registry-backed settlement when the CLS row is not corroborated for the order", () => {
    // Mirrors the reconciled live company: an invoice was stamped with this
    // order id during a later migration, so its CLS payment fails
    // corroboration, while the order's real down payment exists only in the
    // payment-link registry and matches the designated amount.
    const stampedClsPayment = payment({
      paymentId: 14_612,
      orderId: 13_070,
      paymentPurpose: "down_payment",
      amountCents: 9_817,
      settledAt: "2026-05-01T23:44:43.000Z",
      orderCorroborated: false,
    });
    const registrySettlement = payment({
      paymentId: 78_823,
      orderId: 13_070,
      paymentPurpose: null,
      amountCents: 28_140,
      settledAt: "2026-08-15T12:41:46.000Z",
      initiatedAt: "2026-08-13T20:20:31.000Z",
      orderCorroborated: true,
      instrumentType: null,
      cardType: null,
      paymentMethod: null,
    });

    expect(
      selectInitialPayment(
        [stampedClsPayment, registrySettlement],
        13_070,
        28_140,
      ),
    ).toEqual({
      paymentId: 78_823,
      amountCents: 28_140,
      currency: "USD",
      method: null,
      status: "settled",
      statusLabel: "Settled",
    });
  });
});

describe("order payment plan", () => {
  it("names the two plans the book actually carries", () => {
    expect(paymentPlanLabel("full_pay")).toBe("Full pay");
    expect(paymentPlanLabel("full")).toBe("Full pay");
    expect(paymentPlanLabel("financed")).toBe("Financed");
  });

  it("reads a plan regardless of casing or separator", () => {
    expect(paymentPlanLabel("Full Pay")).toBe("Full pay");
    expect(paymentPlanLabel("full-pay")).toBe("Full pay");
  });

  it("stays silent on anything it cannot name", () => {
    // An empty card beats inventing a plan the order never stated.
    expect(paymentPlanLabel(null)).toBeNull();
    expect(paymentPlanLabel("")).toBeNull();
    expect(paymentPlanLabel("   ")).toBeNull();
    expect(paymentPlanLabel("quarterly")).toBeNull();
    expect(paymentPlanLabel(7)).toBeNull();
  });
});

describe("bound policy composition", () => {
  it("keeps every active bound deal and prefers canonical policy values", () => {
    expect(
      resolveBoundPolicies([
        boundPolicy(),
        boundPolicy({
          dealId: 15670,
          policyId: null,
          policyNumber: "WC-200",
          carrierName: "Employers",
          policyCoverageLines: [],
          dealCoverageType: ["WC"],
          policyPremiumCents: null,
          dealPremium: "825.50",
        }),
      ]),
    ).toEqual([
      {
        dealId: 15669,
        policyId: 14146,
        policyNumber: "CSG-00532165-00",
        status: "bound",
        carrierName: "Spinnaker Insurance Company",
        wholesalerName: "Coterie",
        coverageLabels: ["General Liability", "Property"],
        effectiveDate: "2026-08-11",
        expirationDate: "2027-08-11",
        premiumCents: 30_000,
        currency: "USD",
        boundAt: "2026-08-11T02:34:06.471Z",
      },
      {
        dealId: 15670,
        policyId: null,
        policyNumber: "WC-200",
        status: "bound",
        carrierName: "Employers",
        wholesalerName: "Coterie",
        coverageLabels: ["Workers’ Compensation"],
        effectiveDate: "2026-08-11",
        expirationDate: "2027-08-11",
        premiumCents: 82_550,
        currency: "USD",
        boundAt: "2026-08-11T02:34:06.471Z",
      },
    ]);
  });

  it("rejects non-bound candidates, placeholder numbers, and duplicates", () => {
    const policies = resolveBoundPolicies([
      boundPolicy({ policyNumber: "pending" }),
      boundPolicy(),
      boundPolicy({ dealId: 99, dealStage: "sold" }),
    ]);
    expect(policies).toHaveLength(1);
    expect(policies[0]?.policyNumber).toBeNull();
  });
});

describe("live order-detail composition", () => {
  it("loads one exact order query and preserves explicit zero values", async () => {
    query.mockResolvedValue([
      responseRow({
        quoteCandidates: [
          quote({
            artifactId: "harper:artifact:quote",
            legacyDocumentId: null,
            fileName: "Quote.pdf",
          }),
        ],
        paymentCandidates: [payment()],
        boundPolicyCandidates: [boundPolicy()],
        clientInitialPayment: "458.16",
        harperFee: "0",
      }),
    ]);

    const detail = await loadOrderDetail({
      companyId: 917669,
      orderId: 10617,
    });
    expect(detail.orderId).toBe(10617);
    expect(detail.quote).toMatchObject({
      fileName: "Quote.pdf",
      fileType: "PDF",
      canView: true,
    });
    expect(detail.initialPayment?.paymentId).toBe(1);
    expect(detail.harperFeeCents).toBe(0);
    expect(detail.boundPolicies).toHaveLength(1);
    expect(detail.boundPolicies[0]?.policyNumber).toBe("CSG-00532165-00");
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("ot.id = 10617");
    expect(sql).toContain("ot.company_id = 917669");
    expect(sql).toContain("invoice.legacy_order_id");
    expect(sql).toContain("refund.payment_id = payment.id");
    expect(sql).toContain("policy.source_quote_id = deal.quote_id");
    expect(sql).toContain("deal.cancelled_date IS NULL");
    // Initial payment considers the payment-link registry alongside CLS,
    // deduplicated on the shared link ref and corroborated to this order.
    expect(sql).toContain("FROM all_payment_candidates candidate");
    expect(sql).toContain("JOIN public.payments registry");
    expect(sql).toContain(
      "cls.processor_reference_id = registry.payment_link_id",
    );
    expect(sql).toContain("deal.transfer_id = registry.transfer_id");
    expect(sql).toContain("registry.completed = true");
  });

  it("keeps unavailable finance fields null rather than manufacturing zero", async () => {
    query.mockResolvedValue([responseRow()]);
    const detail = await loadOrderDetail({
      companyId: 917669,
      orderId: 10617,
    });
    expect(detail.quote).toBeNull();
    expect(detail.initialPayment).toBeNull();
    expect(detail.paymentPlan).toBeNull();
    expect(detail.harperFeeCents).toBeNull();
    expect(detail.boundPolicies).toEqual([]);
  });

  it("carries the order's payment plan through the payload", async () => {
    query.mockResolvedValue([responseRow({ paymentType: "full_pay" })]);
    const detail = await loadOrderDetail({
      companyId: 917669,
      orderId: 10617,
    });
    expect(detail.paymentPlan).toBe("Full pay");
    expect(publicOrderDetail(detail).paymentPlan).toBe("Full pay");
  });

  it("reaches a payment through the order's deals, not only a stamped invoice", async () => {
    // Three quarters of invoices carry no legacy_order_id, so the deal's own
    // line item and quote have to be able to admit a payment candidate.
    query.mockResolvedValue([responseRow({ orderId: 13062 })]);
    await loadOrderDetail({ companyId: 927725, orderId: 13062 });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("payment_invoices AS (");
    expect(sql).toContain("JOIN payment_invoices invoice ON true");
    expect(sql).toContain("deal.invoice_line_item_id = line.id");
    expect(sql).toContain("deal.quote_id = line.quote_id");
    // Quote selection keeps reading the stamped-invoice CTE untouched.
    expect(sql).toContain("FROM order_invoices invoice");
  });

  it("deduplicates concurrent detail fetches", async () => {
    query.mockResolvedValue([responseRow({ harperFee: "500.00" })]);
    const [first, second] = await Promise.all([
      loadOrderDetail({ companyId: 917669, orderId: 10617 }),
      loadOrderDetail({ companyId: 917669, orderId: 10617 }),
    ]);
    expect(first).toEqual(second);
    expect(query).toHaveBeenCalledTimes(1);
    expect(first.harperFeeCents).toBe(50_000);
  });

  it("serves a digest-matching persisted payload without refetching", async () => {
    const db = mem.db as InstanceType<typeof Database>;
    db.prepare(
      `INSERT OR REPLACE INTO book_sync_digests (kind, id, digest)
       VALUES ('order', '10617', 'digest-aaa')`,
    ).run();
    query.mockResolvedValue([responseRow({ harperFee: "500.00" })]);

    const first = await loadOrderDetail({ companyId: 917669, orderId: 10617 });
    const second = await loadOrderDetail({ companyId: 917669, orderId: 10617 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // The payload is durable, stamped with the digest it was fetched under.
    const row = db
      .prepare(
        `SELECT payload FROM remote_cache
         WHERE cache_key = 'order-detail:v2:917669:10617'`,
      )
      .get() as { payload: string };
    expect(JSON.parse(row.payload).digest).toBe("digest-aaa");
  });

  it("refetches when the order's book digest has moved", async () => {
    const db = mem.db as InstanceType<typeof Database>;
    db.prepare(
      `INSERT OR REPLACE INTO book_sync_digests (kind, id, digest)
       VALUES ('order', '10617', 'digest-aaa')`,
    ).run();
    query.mockResolvedValue([responseRow({ harperFee: "500.00" })]);
    await loadOrderDetail({ companyId: 917669, orderId: 10617 });
    expect(query).toHaveBeenCalledTimes(1);

    // The two-minute refresh saw the order change.
    db.prepare(
      `UPDATE book_sync_digests SET digest = 'digest-bbb'
       WHERE kind = 'order' AND id = '10617'`,
    ).run();
    query.mockResolvedValue([responseRow({ harperFee: "700.00" })]);

    const updated = await loadOrderDetail({ companyId: 917669, orderId: 10617 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(updated.harperFeeCents).toBe(70_000);
  });

  it("mints quote access only through the server-side Agent Tools door", async () => {
    query.mockResolvedValue([
      responseRow({
        quoteCandidates: [
          quote({
            source: "invoice_selection",
            sourceRank: 400,
            artifactId: "harper:artifact:secure-quote",
            legacyDocumentId: null,
          }),
        ],
      }),
    ]);
    execute.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      sourceApi: "harper-agent-tools://execute",
      data: {
        artifact_id: "harper:artifact:secure-quote",
        classification_type: "QUOTE",
        signed_url: "https://example-bucket.s3.amazonaws.com/object?signed=1",
      },
    });

    await expect(
      mintOrderQuoteUrl({ companyId: 917669, orderId: 10617 }),
    ).resolves.toBe(
      "https://example-bucket.s3.amazonaws.com/object?signed=1",
    );
    expect(execute).toHaveBeenCalledWith("documents document get", {
      artifact_id: "harper:artifact:secure-quote",
      expires_in: 300,
      include_classification: true,
      include_entities: false,
    });
  });

  it("rejects a signed response for a different artifact", async () => {
    query.mockResolvedValue([
      responseRow({
        quoteCandidates: [
          quote({
            artifactId: "harper:artifact:expected",
            legacyDocumentId: null,
          }),
        ],
      }),
    ]);
    execute.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      sourceApi: "harper-agent-tools://execute",
      data: {
        artifact_id: "harper:artifact:different",
        classification_type: "QUOTE",
        signed_url: "https://example.test/wrong",
      },
    });

    await expect(
      mintOrderQuoteUrl({ companyId: 917669, orderId: 10617 }),
    ).rejects.toThrow("order_quote_access_mismatch");
  });
});

describe("money parsing", () => {
  it("rounds decimal database values to exact cents", () => {
    expect(decimalToCents("458.16")).toBe(45_816);
    expect(decimalToCents("1.005")).toBe(101);
    expect(decimalToCents(null)).toBeNull();
  });
});
