import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SupabaseManagementRateLimitError } from "@/lib/supabase-management.server";

const mocks = vi.hoisted(() => ({
  getSessionOperator: vi.fn(),
  getAccountDetail: vi.fn(),
  isVisibleBookOrder: vi.fn(),
  loadPaymentHistory: vi.fn(),
  loadOrderDetail: vi.fn(),
  publicOrderDetail: vi.fn(),
  mintOrderQuoteUrl: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getSessionOperator: mocks.getSessionOperator,
}));
vi.mock("@/lib/db", () => ({
  getAccountDetail: mocks.getAccountDetail,
}));
vi.mock("@/lib/order-access.server", () => ({
  isVisibleBookOrder: mocks.isVisibleBookOrder,
}));
vi.mock("@/lib/company-detail.server", () => ({
  loadPaymentHistory: mocks.loadPaymentHistory,
}));
vi.mock("@/lib/order-detail.server", () => ({
  loadOrderDetail: mocks.loadOrderDetail,
  publicOrderDetail: mocks.publicOrderDetail,
  mintOrderQuoteUrl: mocks.mintOrderQuoteUrl,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSessionOperator.mockResolvedValue({ id: "operator" });
  mocks.getAccountDetail.mockReturnValue({ id: "co-925148" });
  mocks.isVisibleBookOrder.mockReturnValue(true);
});

describe("remote-loading route backpressure", () => {
  it("returns Retry-After for a quota-blocked payment-history cold miss", async () => {
    mocks.loadPaymentHistory.mockRejectedValue(
      new SupabaseManagementRateLimitError(17),
    );
    const { GET } = await import(
      "@/app/api/accounts/[id]/payment-history/route"
    );

    const response = await GET(
      new Request(
        "http://localhost/api/accounts/925148/payment-history?offset=0&limit=20",
      ),
      { params: Promise.resolve({ id: "925148" }) },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(mocks.loadPaymentHistory).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns Retry-After for a quota-blocked order-detail cold miss", async () => {
    mocks.loadOrderDetail.mockRejectedValue(
      new SupabaseManagementRateLimitError(23),
    );
    const { GET } = await import("@/app/api/orders/detail/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/orders/detail?companyId=925148&orderId=13177",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("23");
    expect(mocks.loadOrderDetail).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns Retry-After when quote detail is quota-blocked", async () => {
    mocks.mintOrderQuoteUrl.mockRejectedValue(
      new SupabaseManagementRateLimitError(31),
    );
    const { GET } = await import("@/app/api/orders/quote/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/orders/quote?companyId=925148&orderId=13177",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("31");
    expect(mocks.mintOrderQuoteUrl).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("gives quote tabs one automatic retry instead of raw JSON", async () => {
    mocks.mintOrderQuoteUrl.mockRejectedValue(
      new SupabaseManagementRateLimitError(12),
    );
    const { GET } = await import("@/app/api/orders/quote/route");

    const first = await GET(
      new NextRequest(
        "http://localhost/api/orders/quote?companyId=925148&orderId=13177",
        { headers: { Accept: "text/html" } },
      ),
    );
    const firstHtml = await first.text();
    expect(first.headers.get("Content-Type")).toContain("text/html");
    expect(firstHtml).toContain('http-equiv="refresh"');
    expect(firstHtml).toContain("quoteRetry=1");

    const second = await GET(
      new NextRequest(
        "http://localhost/api/orders/quote?companyId=925148&orderId=13177&quoteRetry=1",
        { headers: { Accept: "text/html" } },
      ),
    );
    const secondHtml = await second.text();
    expect(secondHtml).not.toContain('http-equiv="refresh"');
    expect(secondHtml).toContain("Close this tab and try again shortly.");
  });
});
