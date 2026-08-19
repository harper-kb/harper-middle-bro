// @vitest-environment jsdom

/**
 * Opening an account by clicking the row itself.
 *
 * The chevron was the only way in, which made the largest target on the row —
 * the account's own summary — inert. Widening it has one real hazard: the row
 * carries a link and two controls that already mean something else, and a
 * click on any of them must keep meaning that, exactly once.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountRow,
  shouldToggleAccountFromHeader,
} from "@/app/all-accounts/AllAccountsList";
import type { BookAccountListItem, BookOrderListItem } from "@/lib/db";

function order(patch: Partial<BookOrderListItem> = {}): BookOrderListItem {
  return {
    id: "order-1",
    harperOrderId: 1,
    label: "Order #1",
    createdAt: "2026-08-14T20:00:00.000Z",
    orderedAt: "2026-08-14T20:00:00.000Z",
    eventAt: "2026-08-14T20:00:00.000Z",
    bindStatus: "pending",
    revenueCents: 50_610,
    revenueMicros: 506_100_000,
    policyNumbers: [],
    inconsistency: null,
    source: "broker",
    iqStageTag: null,
    brokerGate: null,
    brokerGateAt: null,
    rich: {
      deals: [],
      paymentType: null,
      pfaQuoteNumber: null,
      initialPaymentAt: null,
      documentCount: 0,
      policyCount: 0,
      totalPremiumCents: null,
      taxesCents: null,
      feesCents: null,
      totalCostCents: null,
      commissionRevenueCents: null,
      harperServiceFeeCents: null,
      taxes: [],
      fees: [],
      producerNote: null,
      producerNoteUpdatedAt: null,
      producerNoteUpdatedByName: null,
      serviceNote: null,
    },
    ...patch,
  };
}

function account(patch: Partial<BookAccountListItem> = {}): BookAccountListItem {
  return {
    id: "co-1",
    name: "Kat Haus",
    dba: null,
    state: "IL",
    orderCount: 1,
    orders: [order()],
    hasServiceNotes: false,
    ...patch,
  };
}

function renderRow(
  onToggle: (id: string) => void,
  patch: Partial<BookAccountListItem> = {},
) {
  render(
    <AccountRow
      account={account(patch)}
      canEditOrders={false}
      bigBrotherBaseUrl=""
      todayDay="2026-08-17"
      onToggle={onToggle}
    />,
  );
  const header = document.querySelector(".account-list-row-header");
  if (!(header instanceof HTMLElement)) throw new Error("row header missing");
  return header;
}

afterEach(cleanup);

describe("opening an account from the row", () => {
  it("uses the shared interactive record surface", () => {
    const header = renderRow(vi.fn());
    expect(header.classList.contains("interactive-record-surface")).toBe(true);
    expect(
      header.classList.contains("interactive-record-surface--clickable"),
    ).toBe(true);
  });

  it("opens when the row's own surface is clicked", () => {
    const onToggle = vi.fn();
    const header = renderRow(onToggle);

    fireEvent.click(header);

    expect(onToggle).toHaveBeenCalledWith("co-1");
  });

  it("opens from the row's text, not just the empty header", () => {
    const onToggle = vi.fn();
    renderRow(onToggle);

    // The state on the identity line is the kind of target an operator
    // actually lands on when aiming at the account rather than its name.
    fireEvent.click(screen.getByText("IL"));

    expect(onToggle).toHaveBeenCalledWith("co-1");
  });

  it("lets the account name navigate instead of opening the row", () => {
    const onToggle = vi.fn();
    renderRow(onToggle);
    const link = screen.getByRole("link", { name: "Kat Haus" });
    // Swallow the navigation jsdom cannot perform. Propagation is untouched,
    // so the row handler still sees the click and still has to decline it.
    link.addEventListener("click", (event) => event.preventDefault());

    fireEvent.click(link);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("toggles exactly once when the chevron is pressed", () => {
    const onToggle = vi.fn();
    renderRow(onToggle);

    // The click bubbles to the header too; only one toggle may survive it.
    fireEvent.click(screen.getByRole("button", { name: /Expand orders/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("co-1");
  });

  it("stays inert for an account with no orders to show", () => {
    const onToggle = vi.fn();
    const header = renderRow(onToggle, { orderCount: 0, orders: [] });

    fireEvent.click(header);

    expect(onToggle).not.toHaveBeenCalled();
    expect(header.className).not.toContain("account-list-row-header--clickable");
  });

  it("marks an expandable row as pressable", () => {
    const header = renderRow(vi.fn());
    expect(header.className).toContain("account-list-row-header--clickable");
  });
});

describe("hover affordance on a row that opens", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const ruleBody = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  const CLICKABLE_HOVER =
    "\\.account-list-row-header--clickable:not\\(\\.account-list-row-header--open\\):hover";

  it("answers at row scale with both a surface lift and the accent rail", () => {
    const body = ruleBody(CLICKABLE_HOVER);

    expect(body).toMatch(/background:\s*color-mix\([^;]*--surface-hover/);
    expect(body).toMatch(/box-shadow:\s*inset\s+3px\s+0\s+0/);
  });

  it("derives the hover from theme tokens, so it works in both themes", () => {
    // The regression this guards: a literal colour reads on paper and
    // disappears in the dark, or the reverse. --surface-hover and --accent
    // both flip with the theme, so one rule serves both.
    const body = ruleBody(CLICKABLE_HOVER);

    expect(body).toContain("var(--surface-hover)");
    expect(body).toContain("var(--accent)");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/\brgba?\(/);
  });

  it("keeps hover out of the way on touch, where it would stick", () => {
    // The nearest @media above the hover rule has to be the hover-capable
    // one, or a tap would leave the row lit until the next tap elsewhere.
    const at = css.indexOf(
      ".account-list-row-header--clickable:not(.account-list-row-header--open):hover",
    );
    expect(at).toBeGreaterThan(-1);
    const enclosing = css.slice(css.lastIndexOf("@media", at), at);

    expect(enclosing).toContain("(hover: hover)");
  });

  it("lights the chevron with the row it stands in for", () => {
    const body = ruleBody("\\.account-expand-button:not\\(:disabled\\)");

    expect(body).toMatch(/border-color:\s*var\(--accent\)/);
    expect(body).toMatch(/background:\s*color-mix\([^;]*--accent/);
  });

  it("fades the rail in rather than snapping it", () => {
    const body = ruleBody("\\.account-list-row-header");

    expect(body).toMatch(/transition:[^;]*box-shadow/);
  });

  it("leaves a row that cannot open with only the faint tracking tint", () => {
    // No orders means nothing happens on click, so the row must not promise.
    const body = ruleBody(
      "\\.account-list-row-header:not\\(\\.account-list-row-header--open\\):hover",
    );

    expect(body).toMatch(/background:\s*color-mix\([^;]*--sand/);
    expect(body).not.toMatch(/box-shadow/);
  });

  it("keeps the rail when the reader asks for more contrast", () => {
    const contrast = css.slice(css.indexOf("@media (prefers-contrast: more)"));
    expect(contrast).toContain("account-list-row-header--clickable");
  });
});

describe("shouldToggleAccountFromHeader", () => {
  function header(): HTMLElement {
    const node = document.createElement("div");
    node.innerHTML = `
      <span id="plain">Kat Haus</span>
      <a id="link" href="/accounts/co-1">Kat Haus</a>
      <button id="chevron"><span id="inside-chevron">v</span></button>
      <div role="button" id="pseudo"><span id="inside-pseudo">x</span></div>
      <div data-account-toggle-ignore id="opted-out"><span id="inside-optout">x</span></div>
    `;
    document.body.append(node);
    return node;
  }

  const pick = (root: HTMLElement, id: string) => {
    const node = root.querySelector(`#${id}`);
    if (!node) throw new Error(`missing ${id}`);
    return node;
  };

  it("accepts a plain element inside the header", () => {
    const root = header();
    expect(shouldToggleAccountFromHeader(pick(root, "plain"), root)).toBe(true);
    expect(shouldToggleAccountFromHeader(root, root)).toBe(true);
  });

  it("declines anything that already carries its own meaning", () => {
    const root = header();
    for (const id of [
      "link",
      "chevron",
      "inside-chevron",
      "pseudo",
      "inside-pseudo",
      "opted-out",
      "inside-optout",
    ]) {
      expect(shouldToggleAccountFromHeader(pick(root, id), root)).toBe(false);
    }
  });

  it("declines a target that is not in this header at all", () => {
    const root = header();
    const stranger = document.createElement("span");
    document.body.append(stranger);

    expect(shouldToggleAccountFromHeader(stranger, root)).toBe(false);
    expect(shouldToggleAccountFromHeader(null, root)).toBe(false);
    expect(shouldToggleAccountFromHeader({} as EventTarget, root)).toBe(false);
  });
});
