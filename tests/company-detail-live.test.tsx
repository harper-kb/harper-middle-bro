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
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_OVERVIEW_REFRESH_MS,
  CompanyDetailOverview,
  CompanyIdCard,
  companyHeaderTone,
} from "@/app/accounts/[id]/CompanyDetailOverview";
import { CustomerLocalTime } from "@/app/accounts/[id]/CustomerLocalTime";
import { PaymentHistory } from "@/app/accounts/[id]/PaymentHistory";
import type {
  CompanyOverview,
  PaymentHistoryPage,
} from "@/lib/company-detail-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}));

const EMPTY_PAYMENTS: PaymentHistoryPage = {
  companyId: 919472,
  items: [],
  total: 0,
  settledAmountCents: 0,
  settledCurrency: "USD",
  settledCount: 0,
  offset: 0,
  limit: 20,
  fetchedAt: "2026-08-17T05:30:00.000Z",
  stale: false,
};

function overview(
  companyId: number,
  timeZone: string | null,
  overrides: Partial<CompanyOverview> = {},
): CompanyOverview {
  return {
    companyId,
    name:
      companyId === 919472
        ? "Loyalty Security Services"
        : "Mountain Example Company",
    dba: null,
    producer: { id: 49, name: "Khadija Gueye" },
    location: {
      address1: "5440 South 21st Street",
      address2: null,
      city: companyId === 919472 ? "Omaha" : "Denver",
      state: companyId === 919472 ? "Nebraska" : "Colorado",
      stateCode: companyId === 919472 ? "NE" : "CO",
      postalCode: companyId === 919472 ? "68107" : "80202",
      country: null,
    },
    timeZone: {
      id: timeZone,
      source: timeZone ? "stored_iana" : null,
      unavailableReason: timeZone ? null : "stored_timezone_missing",
    },
    contacts: [
      {
        id: 1,
        name: "Jesus Leal",
        role: null,
        email: "lealjr0519@gmail.com",
        phone: "+14025419217",
        isPrimary: false,
      },
      {
        id: 2,
        name: "Taylor Reed",
        role: null,
        email: "taylor@example.com",
        phone: "+14025551212",
        isPrimary: false,
      },
    ],
    fetchedAt: `2026-08-17T05:30:0${companyId % 10}.000Z`,
    stale: false,
    ...overrides,
  };
}

function detailProps(initialOverview: CompanyOverview) {
  return {
    companyId: initialOverview.companyId,
    fallbackCompanyName: initialOverview.name,
    initialOverview,
    // In the app this slot streams from the server behind Suspense; tests
    // pass the resolved subtree directly.
    paymentsSlot: (
      <PaymentHistory
        companyId={initialOverview.companyId}
        initial={{
          ...EMPTY_PAYMENTS,
          companyId: initialOverview.companyId,
        }}
      />
    ),
    source: "iq" as const,
    statusCounts: { bound: 0, pending: 2, lost: 0 },
    totalPremiumCents: 415_500,
    totalRevenueCents: 126_760,
    totalCommissionCents: 56_760,
    totalHarperFeeCents: 70_000,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("copyable company ID", () => {
  it("renders and copies the exact stable database ID with success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompanyIdCard companyId={919472} />);

    expect(screen.getByText("#919472")).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Copy company ID #919472",
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith("919472"),
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "Company ID copied",
    );
    expect(button.getAttribute("data-copy-state")).toBe("success");
  });

  it("announces clipboard failure without throwing or stealing focus", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompanyIdCard companyId={919472} />);
    const button = screen.getByRole("button", {
      name: "Copy company ID #919472",
    });
    button.focus();
    fireEvent.click(button);

    expect((await screen.findByRole("status")).textContent).toContain(
      "Copy failed",
    );
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("data-copy-state")).toBe("failure");
  });
});

describe("payment history summary", () => {
  it("keeps every record inside the expandable history", () => {
    const page: PaymentHistoryPage = {
      companyId: 919472,
      total: 2,
      settledAmountCents: 53_707,
      settledCurrency: "USD",
      settledCount: 2,
      offset: 0,
      limit: 20,
      fetchedAt: "2026-08-17T05:30:00.000Z",
      stale: false,
      items: [
        {
          id: "payment:latest",
          type: "payment_link",
          status: "settled",
          rawStatus: "settled",
          amountCents: 28_140,
          currency: "USD",
          occurredAt: "2026-08-15T12:41:46.000Z",
          createdAt: "2026-08-13T20:20:31.000Z",
          orderId: 62,
          createdBy: "producer@example.com",
          safeReference: "••••alpha6",
        },
        {
          id: "payment:older",
          type: "payment",
          status: "settled",
          rawStatus: "settled",
          amountCents: 25_567,
          currency: "USD",
          occurredAt: "2026-05-01T23:44:43.000Z",
          createdAt: "2026-05-01T23:43:50.000Z",
          orderId: 61,
          createdBy: null,
          safeReference: "••••bravo6",
        },
      ],
    };

    render(<PaymentHistory companyId={919472} initial={page} />);
    expect(screen.getByText("Total settled")).toBeTruthy();
    expect(screen.getByText("$537.07")).toBeTruthy();
    expect(screen.queryByText("$281.40")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "View payment history (2)" }),
    );
    expect(screen.getByText("$281.40")).toBeTruthy();
    expect(screen.getByText("$255.67")).toBeTruthy();
    expect(screen.getAllByText("Settled")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Hide payment history" }),
    ).toBeTruthy();
  });
});

describe("customer local-time behavior", () => {
  it("renders a hydration-stable placeholder instead of server wall-clock text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:40:12.000Z"));
    const html = renderToStaticMarkup(
      <CustomerLocalTime
        companyId={919472}
        location={overview(919472, "America/Chicago").location}
        timeZone={overview(919472, "America/Chicago").timeZone}
      />,
    );
    expect(html).toContain("Loading customer local time");
    expect(html).not.toContain("12:40 AM");
    expect(html).not.toContain("Monday, August 17");
    expect(html).toContain("IANA time zone: America/Chicago");
  });

  it("updates at the next minute boundary and then once per minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:40:12.000Z"));
    render(
      <CustomerLocalTime
        companyId={919472}
        location={overview(919472, "America/Chicago").location}
        timeZone={overview(919472, "America/Chicago").timeZone}
      />,
    );
    expect(screen.getByText("12:40 AM")).toBeTruthy();
    expect(
      document.querySelector(
        '[title*="IANA time zone: America/Chicago"]',
      ),
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(48_000);
    });
    expect(screen.getByText("12:41 AM")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("12:42 AM")).toBeTruthy();
  });

  it("uses the company state when no stored time zone exists", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:40:12.000Z"));
    render(
      <CustomerLocalTime
        companyId={919472}
        location={overview(919472, null).location}
        timeZone={overview(919472, null).timeZone}
      />,
    );
    expect(screen.getByText("12:40 AM")).toBeTruthy();
    expect(screen.getByText("Central Time · Omaha, NE")).toBeTruthy();
    expect(document.querySelector(".company-local-time-row")).toBeTruthy();
    expect(screen.queryByText("Local time unavailable")).toBeNull();
  });

  it("shows unavailable only when the company state is also missing", () => {
    const missingLocation = {
      ...overview(919472, null).location,
      state: null,
      stateCode: null,
    };
    render(
      <CustomerLocalTime
        companyId={919472}
        location={missingLocation}
        timeZone={overview(919472, null).timeZone}
      />,
    );
    expect(screen.getByText("Local time unavailable")).toBeTruthy();
    expect(
      screen.getByText("State is missing or unrecognized for this company."),
    ).toBeTruthy();
  });
});

describe("live company overview", () => {
  it("replaces the previous company's location and timezone on navigation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:40:12.000Z"));
    const { rerender } = render(
      <CompanyDetailOverview
        {...detailProps(overview(919472, "America/Chicago"))}
      />,
    );
    expect(screen.getByText("Central Time · Omaha, NE")).toBeTruthy();

    rerender(
      <CompanyDetailOverview
        {...detailProps(overview(920000, "America/Denver"))}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Mountain Example Company",
    );
    expect(screen.getByText("Mountain Time · Denver, CO")).toBeTruthy();
    expect(screen.queryByText("Central Time · Omaha, NE")).toBeNull();
  });

  it("applies a timezone change from the five-minute overview refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:40:12.000Z"));
    const refreshed = overview(919472, "America/Denver", {
      fetchedAt: "2026-08-17T05:35:00.000Z",
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CompanyDetailOverview
        {...detailProps(overview(919472, "America/Chicago"))}
      />,
    );
    expect(screen.getByText("Central Time · Omaha, NE")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANY_OVERVIEW_REFRESH_MS);
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/accounts/919472/overview",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByText("Mountain Time · Omaha, NE")).toBeTruthy();
  });

  it("retains verified summary, contacts, and payment content", () => {
    const html = renderToStaticMarkup(
      <CompanyDetailOverview
        {...detailProps(overview(919472, "America/Chicago"))}
      />,
    );
    expect(html).toContain("Khadija Gueye");
    expect(html).toContain("5440 South 21st Street");
    expect(html).toContain("Jesus Leal");
    expect(html).toContain("Taylor Reed");
    expect(html).toContain("$4,155.00");
    expect(html).toContain("$1,267.60");
    expect(html).toContain("$567.60");
    expect(html).toContain("$700.00");
    expect(html).toContain("company-revenue-row");
    expect(html).toContain("No payment history.");
    expect(html).toContain("Back to Accounts");
    expect(html).toContain("IQ");
    expect(html).toContain("2 Pending deals");
    expect(html).toContain('data-company-header-tone="pending"');
  });
});

describe("company grid presentation contract", () => {
  it("uses Pending, Bound, and Lost header tones in operational priority order", () => {
    expect(
      companyHeaderTone({ pending: 2, bound: 1, lost: 1 }),
    ).toBe("pending");
    expect(
      companyHeaderTone({ pending: 0, bound: 2, lost: 1 }),
    ).toBe("bound");
    expect(
      companyHeaderTone({ pending: 0, bound: 0, lost: 3 }),
    ).toBe("lost");
    expect(
      companyHeaderTone({ pending: 0, bound: 0, lost: 0 }),
    ).toBe("neutral");
  });

  it("defines one, two, and twelve-column spans with token-driven themes", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/\.company-summary-grid\s*\{[^}]*display:\s*grid/);
    expect(css).toContain("grid-template-columns: repeat(12, minmax(0, 1fr))");
    expect(css).toMatch(
      /\.company-summary-grid\s*\{[^}]*align-items:\s*stretch/,
    );
    expect(css).toMatch(
      /\.company-summary-card\s*\{[^}]*align-self:\s*stretch/,
    );
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toMatch(
      /@media \(min-width: 768px\)[\s\S]*?\.company-summary-card--location,[\s\S]*?grid-column: span 12/,
    );
    expect(css).toContain(".company-summary-card--time");
    expect(css).toContain(".company-summary-card--revenue");
    expect(css).toMatch(
      /\.company-page-sticky-region\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--company-header-offset/,
    );
    expect(css).toMatch(
      /\.company-page-header--pending\s*\{[^}]*var\(--warning\)/,
    );
    expect(css).toMatch(
      /\.company-page-header--bound\s*\{[^}]*var\(--success\)/,
    );
    expect(css).toMatch(
      /\.company-page-header--lost\s*\{[^}]*var\(--danger\)/,
    );
    expect(css).toContain("--order-card-accent: var(--info)");
    expect(css).toContain("--order-card-accent: var(--success)");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
