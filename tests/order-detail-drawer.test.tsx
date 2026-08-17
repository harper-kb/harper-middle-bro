// @vitest-environment jsdom

import fs from "fs";
import path from "path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichOrderCard, shouldOpenOrderFromCard } from "@/app/all-accounts/RichOrderCard";
import {
  ORDER_DETAIL_REFRESH_MS,
  OrderDetailDrawerProvider,
  useOrderDetailDrawer,
  type OrderDrawerSelection,
} from "@/components/orders/OrderDetailDrawer";
import type { BookOrderListItem } from "@/lib/db";
import type {
  OrderDetailBoundPolicy,
  OrderDetailResponse,
} from "@/lib/order-detail-types";
import { emptyBookOrderRich } from "@/lib/supabase-book.server";

const FIRST: OrderDrawerSelection = {
  companyId: 917669,
  accountId: "co-917669",
  accountName: "365 Business Solutions, LLC",
  orderId: 10617,
  orderLabel: "Order #10617",
  status: "pending",
};

const SECOND: OrderDrawerSelection = {
  companyId: 925148,
  accountId: "co-925148",
  accountName: "Charm City Kids Childcare LLC",
  orderId: 12594,
  orderLabel: "Order #12594",
  status: "bound",
};

const THIRD: OrderDrawerSelection = {
  companyId: 931001,
  accountId: "co-931001",
  accountName:
    "A Very Long Company Name for Responsive Drawer Truncation & Accessibility, LLC",
  orderId: 13001,
  orderLabel: "Order #13001",
  status: "lost",
};

function detail(
  orderId: number,
  overrides: Partial<OrderDetailResponse> = {},
): OrderDetailResponse {
  return {
    orderId,
    quote: {
      fileName: `Quote-${orderId}.pdf`,
      mimeType: "application/pdf",
      fileType: "PDF",
      sizeBytes: 1024,
      canView: true,
    },
    initialPayment: {
      paymentId: orderId + 100,
      amountCents: 45_816,
      currency: "USD",
      method: "ACH",
      status: "settled",
      statusLabel: "Settled",
    },
    harperFeeCents: 50_000,
    fetchedAt: `2026-08-16T21:00:${orderId % 60}.000Z`,
    ...overrides,
    boundPolicies: overrides.boundPolicies ?? [],
  };
}

function boundPolicy(
  overrides: Partial<OrderDetailBoundPolicy> = {},
): OrderDetailBoundPolicy {
  return {
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
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness() {
  const drawer = useOrderDetailDrawer();
  return (
    <div>
      <button
        type="button"
        onClick={(event) => drawer.openOrder(FIRST, event.currentTarget)}
      >
        Open first
      </button>
      <button
        type="button"
        onClick={(event) => drawer.openOrder(SECOND, event.currentTarget)}
      >
        Open second
      </button>
      <button
        type="button"
        onClick={(event) => drawer.openOrder(THIRD, event.currentTarget)}
      >
        Open lost
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <OrderDetailDrawerProvider>
      <Harness />
    </OrderDetailDrawerProvider>,
  );
}

const testOrder: BookOrderListItem = {
  id: "order-10617",
  harperOrderId: 10617,
  label: "Order #10617",
  createdAt: "2026-07-08T23:53:45.000Z",
  orderedAt: "2026-07-08T23:53:04.000Z",
  eventAt: "2026-07-08T23:53:04.000Z",
  bindStatus: "pending",
  revenueCents: 57_820,
  revenueMicros: 578_200_000,
  rich: {
    ...emptyBookOrderRich(),
    serviceNote: null,
    deals: [
      {
        dealId: 13425,
        dealStage: "sold",
        carrierName: "Burlington Ins Co",
        wholesalerName: null,
        premiumCents: 78_200,
        policyNumber: null,
        isInstantQuote: false,
        isBound: false,
        boundAt: null,
        effectiveDate: null,
        expirationDate: null,
      },
    ],
  },
  policyNumbers: [],
  inconsistency: null,
  source: "broker",
  iqStageTag: null,
  brokerGate: null,
  brokerGateAt: null,
};

function noteThreads(orderId: number) {
  const thread = (type: "producer" | "service") => ({
    type,
    scope: type === "producer" ? "order" : "account",
    entries: [],
    version: `${type}-empty`,
    latestAt: null,
  });
  return {
    accountId: 917669,
    orderId,
    producer: thread("producer"),
    service: thread("service"),
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("minimal order detail drawer interaction", () => {
  it("opens the selected stable order and applies active card treatment", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/orders/note-threads")) {
        return json(noteThreads(10617));
      }
      return json(detail(url.includes("orderId=10617") ? 10617 : 12594));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OrderDetailDrawerProvider>
        <ul>
          <RichOrderCard
            order={testOrder}
            accountId="co-917669"
            accountName="365 Business Solutions, LLC"
            canEditOrders={false}
            bigBrotherBaseUrl="https://example.test"
            todayDay="2026-08-16"
            accountServiceNotesEmpty
          />
        </ul>
      </OrderDetailDrawerProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "View details for Order #10617",
    });
    fireEvent.click(trigger);

    expect(
      await screen.findByRole("dialog", { name: "Order #10617" }),
    ).toBeTruthy();
    await screen.findByText("Quote-10617.pdf");
    const card = document.querySelector<HTMLElement>(
      '[data-order-id="10617"]',
    );
    expect(card?.dataset.orderActive).toBe("true");
    const detailCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith("/api/orders/detail"),
    );
    expect(String(detailCall?.[0])).toContain("companyId=917669");
    expect(String(detailCall?.[0])).toContain("orderId=10617");
  });

  it("presents the quote and three available financial values as a compact summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(FIRST.orderId))),
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));

    expect(
      await screen.findByRole("heading", { name: "Uploaded quote" }),
    ).toBeTruthy();
    expect(screen.getByText("Quote-10617.pdf")).toBeTruthy();
    expect(screen.getByText("$458.16")).toBeTruthy();
    expect(screen.getByText("ACH")).toBeTruthy();
    expect(screen.getByText("$500.00")).toBeTruthy();
    expect(screen.getByText("Settled")).toBeTruthy();
    expect(
      document.querySelectorAll(
        '[data-order-detail-card][data-value-state="available"]',
      ),
    ).toHaveLength(3);
    expect(
      document.querySelector(
        '.order-detail-quote-card[data-value-state="available"]',
      ),
    ).toBeTruthy();
  });

  it("shows every completed policy only for Bound orders", async () => {
    const policies = [
      boundPolicy(),
      boundPolicy({
        dealId: 15670,
        policyId: 14147,
        policyNumber: "WC-200",
        status: "active",
        carrierName: "Employers",
        wholesalerName: null,
        coverageLabels: ["Workers’ Compensation"],
        effectiveDate: "2026-09-01",
        expirationDate: "2027-09-01",
        premiumCents: 82_550,
        boundAt: null,
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const orderId = String(input).includes("orderId=12594")
          ? SECOND.orderId
          : FIRST.orderId;
        return json(detail(orderId, { boundPolicies: policies }));
      }),
    );
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    await screen.findByText("Quote-10617.pdf");
    expect(
      screen.queryByRole("heading", { name: "Bound policies" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    expect(
      await screen.findByRole("heading", { name: "Bound policies" }),
    ).toBeTruthy();
    expect(screen.getByText("2 policies")).toBeTruthy();
    expect(screen.getByText("CSG-00532165-00")).toBeTruthy();
    expect(screen.getByText("WC-200")).toBeTruthy();
    expect(screen.getByText("Spinnaker Insurance Company")).toBeTruthy();
    expect(screen.getByText("General Liability")).toBeTruthy();
    expect(screen.getByText("Property")).toBeTruthy();
    expect(screen.getByText("Workers’ Compensation")).toBeTruthy();
    expect(screen.getByText("Aug 11, 2026")).toBeTruthy();
    expect(screen.getByText("Sep 1, 2026")).toBeTruthy();
    expect(screen.getByText("$300.00")).toBeTruthy();
    expect(screen.getByText("$825.50")).toBeTruthy();
    expect(
      document.querySelectorAll("[data-bound-policy-deal]"),
    ).toHaveLength(2);
  });

  it("applies Pending, Bound, and Lost header treatments and preserves long labels", async () => {
    const longFileName =
      "2026-2027-Final-Client-Approved-Commercial-Package-Quote-With-Endorsements.pdf";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const orderId = Number(
          new URL(String(input), "https://step-bro.test").searchParams.get(
            "orderId",
          ),
        );
        return json(
          detail(orderId, {
            quote: {
              ...detail(orderId).quote!,
              fileName:
                orderId === THIRD.orderId
                  ? longFileName
                  : `Quote-${orderId}.pdf`,
            },
          }),
        );
      }),
    );
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    await screen.findByLabelText("Order status: Pending");
    expect(
      document.querySelector('[data-order-status="pending"]'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    await screen.findByLabelText("Order status: Bound");
    expect(document.querySelector('[data-order-status="bound"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open lost" }));
    await screen.findByLabelText("Order status: Lost");
    expect(document.querySelector('[data-order-status="lost"]')).toBeTruthy();
    expect((await screen.findByTitle(longFileName)).textContent).toBe(
      longFileName,
    );
    expect(screen.getByTitle(THIRD.accountName).textContent).toBe(
      THIRD.accountName,
    );
  });

  it("closes by button, Escape, and backdrop and restores trigger focus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(FIRST.orderId))),
    );
    renderHarness();
    const first = screen.getByRole("button", { name: "Open first" });

    first.focus();
    fireEvent.click(first);
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close order detail" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(first);
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(first);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(first);

    fireEvent.click(first);
    await screen.findByRole("dialog");
    const backdrop = document.querySelector<HTMLElement>(
      "[data-order-detail-backdrop]",
    );
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(first);
  });

  it("traps focus inside the open sheet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(FIRST.orderId))),
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    await screen.findByText("Quote-10617.pdf");
    const close = screen.getByRole("button", { name: "Close order detail" });
    const view = screen.getByRole("link", {
      name: "View quote Quote-10617.pdf",
    });

    view.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(view);
  });

  it("switches order content in one drawer without resetting focus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        json(detail(String(input).includes("orderId=12594") ? 12594 : 10617)),
      ),
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    await screen.findByText("Quote-10617.pdf");
    const close = screen.getByRole("button", { name: "Close order detail" });
    close.focus();

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    await screen.findByText("Quote-12594.pdf");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Order #12594" })).toBeTruthy();
    expect(document.activeElement).toBe(close);
  });

  it("refreshes live detail at five minutes without closing", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      return json(
        detail(FIRST.orderId, {
          harperFeeCents: requestCount === 1 ? 50_000 : 30_000,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open first" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("$500.00")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close order detail" });
    close.focus();
    const initialCalls = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORDER_DETAIL_REFRESH_MS);
    });
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 1);
    expect(screen.getByText("$300.00")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(close);
  });

  it("refreshes bound policy records without closing the drawer", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      return json(
        detail(SECOND.orderId, {
          boundPolicies: [
            boundPolicy({
              policyNumber: requestCount === 1 ? "POLICY-OLD" : "POLICY-NEW",
            }),
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open second" }));
      await Promise.resolve();
    });
    expect(screen.getByText("POLICY-OLD")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORDER_DETAIL_REFRESH_MS);
    });
    expect(screen.getByText("POLICY-NEW")).toBeTruthy();
    expect(screen.queryByText("POLICY-OLD")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("minimal order detail states", () => {
  it("shows all four honest empty states and preserves an explicit zero fee", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json(
            detail(FIRST.orderId, {
              quote: null,
              initialPayment: null,
              harperFeeCents: null,
            }),
          ),
        )
        .mockResolvedValueOnce(
          json(
            detail(SECOND.orderId, {
              quote: null,
              initialPayment: null,
              harperFeeCents: 0,
            }),
          ),
        ),
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));

    expect(await screen.findByText("No quote uploaded")).toBeTruthy();
    expect(screen.getByText("No initial payment recorded")).toBeTruthy();
    expect(screen.getByText("Payment type unavailable")).toBeTruthy();
    expect(screen.getByText("Harper fee unavailable")).toBeTruthy();
    expect(
      document.querySelectorAll(
        '[data-order-detail-card][data-value-state="unavailable"]',
      ),
    ).toHaveLength(3);
    expect(
      document.querySelector(
        '.order-detail-quote-card[data-value-state="unavailable"]',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    await screen.findByRole("heading", { name: "Order #12594" });
    expect(screen.getByText("$0.00")).toBeTruthy();
    expect(screen.getByText("Bound policy details unavailable")).toBeTruthy();
    expect(
      document.querySelector(
        '[data-order-detail-card="fee"][data-value-state="available"]',
      ),
    ).toBeTruthy();
  });

  it("renders a loading skeleton and a compact retryable error", async () => {
    let resolveRequest: ((response: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValueOnce(json(detail(FIRST.orderId)));
    vi.stubGlobal("fetch", fetchMock);
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    expect(
      await screen.findByLabelText("Loading order detail"),
    ).toBeTruthy();

    await act(async () => {
      resolveRequest?.(json({ error: "Temporary failure" }, 502));
      await Promise.resolve();
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Order detail unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Quote-10617.pdf")).toBeTruthy();
  });

  it("exposes only the authorized order route in the quote action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(FIRST.orderId))),
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    const link = await screen.findByRole("link", {
      name: "View quote Quote-10617.pdf",
    });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/api/orders/quote?");
    expect(href).toContain("companyId=917669");
    expect(href).toContain("orderId=10617");
    expect(href).not.toContain("artifact");
    expect(href).not.toContain("bucket");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("card event and presentation isolation", () => {
  it("does not open from nested actions but opens from ordinary card content", () => {
    const card = document.createElement("article");
    const action = document.createElement("button");
    const content = document.createElement("span");
    card.append(action, content);

    expect(shouldOpenOrderFromCard(action, card)).toBe(false);
    expect(shouldOpenOrderFromCard(content, card)).toBe(true);
  });

  it("keeps the grid responsive and token-driven in both themes and reduced motion", () => {
    const component = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/components/orders/OrderDetailDrawer.tsx",
      ),
      "utf8",
    );
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(component).toContain("w-full");
    expect(component).toContain("sm:w-[min(40rem,94vw)]");
    expect(component).toContain("var(--surface-raised)");
    expect(component).toContain("order-detail-summary-grid");
    expect(component).toContain("order-detail-financial-grid");
    expect(component).toContain('selection.status === "bound"');
    expect(component).toContain("BoundPolicySummary");
    expect(component).not.toContain("divide-y");
    expect(component).not.toContain("border-y");
    expect(css).toContain(".order-detail-drawer-backdrop");
    expect(css).toContain(".step-bro-order-card--active");
    expect(css).toMatch(
      /\.order-detail-summary-grid\s*\{[^}]*display:\s*grid/,
    );
    expect(css).toContain("grid-column: span 6");
    expect(css).toContain(".order-detail-policy-grid");
    expect(css).toContain("--order-card-accent: var(--success)");
    expect(css).toContain("@container order-detail (min-width: 34rem)");
    expect(css).toContain("@container order-detail (min-width: 39rem)");
    expect(css).toContain("--order-card-accent: var(--info)");
    expect(css).toContain("var(--broker)");
    expect(css).toContain("--order-card-accent: var(--accent)");
    expect(css).toContain(".order-detail-drawer-header--pending");
    expect(css).toContain(".order-detail-drawer-header--bound");
    expect(css).toContain(".order-detail-drawer-header--lost");
    expect(css).toMatch(
      /\.order-detail-drawer-header--pending\s*\{[^}]*var\(--warning\)/,
    );
    expect(css).toMatch(
      /\.order-detail-drawer-header--bound\s*\{[^}]*var\(--success\)/,
    );
    expect(css).toMatch(
      /\.order-detail-drawer-header--lost\s*\{[^}]*var\(--danger\)/,
    );
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
  });
});
