// @vitest-environment jsdom

import fs from "fs";
import path from "path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderActions } from "@/app/all-accounts/order-actions/OrderActions";
import { RichOrderCard } from "@/app/all-accounts/RichOrderCard";
import { OrderDetailDrawerProvider } from "@/components/orders/OrderDetailDrawer";
import type { BookOrderListItem } from "@/lib/db";
import { emptyBookOrderRich } from "@/lib/supabase-book.server";

/** Order #13070 belongs to company 900319 — verified read-only in Harper. */
const NOCTURNAL = {
  accountId: "co-900319",
  accountName: "Apocalipsis Nocturnal",
  orderId: 13070,
};
/** Order #13078 belongs to company 16286 — a different, much smaller id. */
const BARSHA = {
  accountId: "co-16286",
  accountName: "Barsha Inc",
  orderId: 13078,
};

function order(
  harperOrderId: number,
  overrides: Partial<BookOrderListItem> = {},
): BookOrderListItem {
  return {
    id: `order-${harperOrderId}`,
    harperOrderId,
    label: `Order #${harperOrderId}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    orderedAt: "2026-08-01T00:00:00.000Z",
    eventAt: "2026-08-01T00:00:00.000Z",
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
    ...overrides,
  };
}

function renderActions(
  target: { accountId: string; accountName: string; orderId: number },
) {
  return render(
    <OrderActions
      order={order(target.orderId)}
      accountId={target.accountId}
      accountName={target.accountName}
      canEditOrders={false}
      bigBrotherBaseUrl="https://bigbrother.harperinsure.com"
    />,
  );
}

function bindTrigger(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    "button.order-bind-button",
  );
  if (!button) throw new Error("Bind Policy trigger not rendered");
  return button;
}

function openHandoff(): HTMLButtonElement {
  const trigger = bindTrigger();
  fireEvent.click(trigger);
  return trigger;
}

function handoffLink(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>("a.bind-handoff-action");
}

let fetchMock: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("Bind Policy handoff content", () => {
  it("explains the read-only handoff instead of a bind form", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Binding in Step Bro is coming soon");
    expect(dialog.textContent).toContain("read-only");
    expect(dialog.textContent).toContain("Continue in Big Brother");
    expect(dialog.textContent).toContain("Order #13070");
    expect(dialog.textContent).toContain("Apocalipsis Nocturnal");
  });

  it("renders no policy number, effective date or expiration date field", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("input")).toHaveLength(0);
    expect(dialog.querySelectorAll("select")).toHaveLength(0);
    expect(dialog.querySelectorAll("textarea")).toHaveLength(0);
    expect(dialog.querySelectorAll("form")).toHaveLength(0);
    for (const label of [
      /policy number/i,
      /effective date/i,
      /expiration date/i,
    ]) {
      expect(screen.queryByLabelText(label)).toBeNull();
      expect(screen.queryByText(label)).toBeNull();
    }
    // The only submit-style control left is the external handoff.
    expect(
      screen.queryByRole("button", { name: /^bind policy$/i }),
    ).toBeNull();
  });

  it("offers exactly Cancel and the external action", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(handoffLink()?.textContent).toContain("Bind in Big Brother");
  });
});

describe("Bind Policy performs no write", () => {
  it("never calls a bind endpoint on open, link click or close", () => {
    renderActions(NOCTURNAL);
    openHandoff();
    fireEvent.click(handoffLink() as HTMLAnchorElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no bind write route left in the application", () => {
    const root = path.join(__dirname, "..");
    expect(fs.existsSync(path.join(root, "src/app/api/orders/bind"))).toBe(
      false,
    );
    expect(
      fs.existsSync(
        path.join(root, "src/app/all-accounts/order-actions/BindPolicyModal.tsx"),
      ),
    ).toBe(false);
    const source = fs.readFileSync(
      path.join(root, "src/app/all-accounts/order-actions/OrderActions.tsx"),
      "utf8",
    );
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("/api/orders/bind");
  });

  it("leaves the order status untouched after the handoff is used", () => {
    renderActions(NOCTURNAL);
    openHandoff();
    fireEvent.click(handoffLink() as HTMLAnchorElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // No optimistic "Bound" anywhere; Step Bro waits for the live read.
    expect(document.body.textContent).not.toContain("Bound");
  });
});

describe("Big Brother destination", () => {
  it("links to the verified company's Orders tab in a secure new tab", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const link = handoffLink() as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "https://bigbrother.harperinsure.com/company/900319/transaction?tab=orders",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toBe(
      "Open Apocalipsis Nocturnal in Big Brother to bind policy (opens in a new tab)",
    );
  });

  it("uses the company id, never the order id", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const href = handoffLink()?.getAttribute("href") ?? "";
    expect(href).toContain("/company/900319/");
    expect(href).not.toContain("13070");
  });

  it("never reuses the previous company's id after switching records", () => {
    const first = renderActions(NOCTURNAL);
    openHandoff();
    expect(handoffLink()?.getAttribute("href")).toContain("/company/900319/");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    first.unmount();

    renderActions(BARSHA);
    openHandoff();
    const href = handoffLink()?.getAttribute("href") ?? "";
    expect(href).toBe(
      "https://bigbrother.harperinsure.com/company/16286/transaction?tab=orders",
    );
    expect(href).not.toContain("900319");
  });

  it("disables the action and explains it when the route id is unusable", () => {
    for (const accountId of ["acct-h-16286", "co-", "co-abc", "co-0"]) {
      renderActions({ ...NOCTURNAL, accountId });
      openHandoff();

      expect(handoffLink()).toBeNull();
      const action = screen.getByRole("button", {
        name: /bind in big brother/i,
      });
      expect(action).toHaveProperty("disabled", true);
      expect(screen.getByRole("status").textContent).toContain(
        "Big Brother company link unavailable",
      );
      // Cancel still works, and nothing links out.
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(
        screen.getByRole("dialog").querySelectorAll("a[href]"),
      ).toHaveLength(0);
      cleanup();
    }
  });

  it("reports the unavailable link without logging customer data", () => {
    renderActions({ ...NOCTURNAL, accountId: "acct-h-16286" });
    openHandoff();

    expect(warnSpy).toHaveBeenCalledWith(
      "bind_handoff_company_link_unavailable",
      { orderId: 13070, hasCompanyId: false },
    );
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain("Apocalipsis");
  });
});

describe("Bind Policy dialog behavior", () => {
  it("opens one dialog no matter how fast the trigger is clicked", () => {
    renderActions(NOCTURNAL);
    const trigger = bindTrigger();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.querySelectorAll("[data-bind-handoff-backdrop]")).toHaveLength(
      1,
    );
  });

  it("blurs, subdues and locks the application behind one backdrop", () => {
    const appRoot = renderActions(NOCTURNAL).container;
    openHandoff();

    const backdrop = document.querySelector<HTMLElement>(
      "[data-bind-handoff-backdrop]",
    ) as HTMLElement;
    expect(backdrop.className).toContain("bind-handoff-backdrop");
    expect(backdrop.className).toContain("z-[150]");
    expect(appRoot.getAttribute("inert")).toBe("");
    expect(appRoot.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    // The panel itself is never inside the blurred layer's subdued set.
    expect(
      backdrop.querySelector(".bind-handoff-panel")?.getAttribute("inert"),
    ).toBeNull();
  });

  it("leaves the idle brand overlay interactive if it takes over", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const idle = document.createElement("div");
    idle.setAttribute("data-idle-brand-overlay", "");
    document.body.appendChild(idle);

    // The MutationObserver runs on a microtask.
    return Promise.resolve().then(() => {
      expect(idle.hasAttribute("inert")).toBe(false);
      expect(idle.hasAttribute("aria-hidden")).toBe(false);
      idle.remove();
    });
  });

  it("releases the background on close", () => {
    const appRoot = renderActions(NOCTURNAL).container;
    openHandoff();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(appRoot.hasAttribute("inert")).toBe(false);
    expect(appRoot.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("names and describes the dialog and traps focus inside it", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    const dialog = screen.getByRole("dialog", {
      name: "Binding in Step Bro is coming soon",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const describedBy = dialog.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toContain(
      "read-only",
    );

    // Focus opens on the action the operator came for.
    expect(document.activeElement).toBe(handoffLink());

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(handoffLink());
  });

  it("falls back to Cancel for initial focus when the action is disabled", () => {
    renderActions({ ...NOCTURNAL, accountId: "co-abc" });
    openHandoff();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("closes on Escape, Cancel and backdrop, restoring trigger focus", () => {
    renderActions(NOCTURNAL);

    for (const close of [
      () => fireEvent.keyDown(document, { key: "Escape" }),
      () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
      () =>
        fireEvent.mouseDown(
          document.querySelector("[data-bind-handoff-backdrop]") as HTMLElement,
        ),
    ]) {
      const trigger = openHandoff();
      expect(screen.getByRole("dialog")).toBeTruthy();
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  });

  it("keeps a mousedown inside the panel from closing the dialog", () => {
    renderActions(NOCTURNAL);
    openHandoff();

    fireEvent.mouseDown(
      document.querySelector(".bind-handoff-panel") as HTMLElement,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Bind Policy trigger inside an order card", () => {
  it("does not open the order drawer or toggle the card", async () => {
    const cardClick = vi.fn();
    render(
      <OrderDetailDrawerProvider>
        <ul onClick={cardClick}>
          <RichOrderCard
            order={order(NOCTURNAL.orderId)}
            accountId={NOCTURNAL.accountId}
            accountName={NOCTURNAL.accountName}
            canEditOrders={false}
            bigBrotherBaseUrl="https://bigbrother.harperinsure.com"
            todayDay="2026-08-16"
            accountServiceNotesEmpty
          />
        </ul>
      </OrderDetailDrawerProvider>,
    );

    openHandoff();

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog").textContent,
    ).toContain("Binding in Step Bro is coming soon");
    // The card's own click handler never ran, so no drawer and no expansion.
    expect(cardClick).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-order-detail-backdrop]"),
    ).toBeNull();
    expect(
      document.querySelector('[data-order-id="13070"]')?.getAttribute(
        "data-order-active",
      ),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/orders/detail"),
      expect.anything(),
    );
  });
});
