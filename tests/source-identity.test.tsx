/**
 * Broker's visual identity, checked where it can actually regress: the tone a
 * surface picks, the glyph it draws, and whether the word "Broker" survives.
 *
 * The load-bearing assertions are the negative ones — Broker must never fall
 * back to the neutral gray it used to share with mixed and unavailable, and
 * mixed/unavailable must never inherit Broker purple.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  sourceLabel,
  sourceTone,
  SOURCE_DESCRIPTIONS,
  type OrderSource,
} from "@/lib/account-source";
import {
  AccountSourceIdentity,
  SourceIcon,
} from "@/components/SourceIdentity";
import { OrderMetaChips } from "@/app/all-accounts/OrderMetaChips";
import { AccountRowSummary } from "@/app/all-accounts/AccountRowSummary";
import { buildAccountRowModel } from "@/lib/account-row-model";
import { BrokerGateRail } from "@/app/all-accounts/BrokerGateRail";
import type { BookOrderListItem } from "@/lib/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { AccountFilterToolbar } = await import(
  "@/app/all-accounts/AccountFilterToolbar"
);

const GLOBALS = readFileSync("src/app/globals.css", "utf8");

/** The generic person mark Broker used to wear, by its exact path data. */
const PERSON_ICON_ARC = "M2 10.5c0-1.9 1.8-3 4-3s4 1.1 4 3";

const SOURCES: (OrderSource | null)[] = ["iq", "broker", "mixed", null];

function order(patch: Partial<BookOrderListItem> = {}): BookOrderListItem {
  return {
    id: "order-1",
    harperOrderId: 1,
    label: "Order #1",
    createdAt: "2026-08-14T20:00:00.000Z",
    orderedAt: "2026-08-14T20:00:00.000Z",
    eventAt: "2026-08-14T20:00:00.000Z",
    bindStatus: "pending",
    revenueCents: 40060,
    revenueMicros: 400_600_000,
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

function chips(source: OrderSource | null) {
  return renderToStaticMarkup(
    <OrderMetaChips
      source={source}
      bindStatus="pending"
      revenueMicros={400_600_000}
      createdAt="2026-08-14T20:00:00.000Z"
      todayDay="2026-08-15"
    />,
  );
}

function row(source: OrderSource | null) {
  return renderToStaticMarkup(
    <AccountRowSummary
      model={buildAccountRowModel([order({ source })], "2026-08-15")}
    />,
  );
}

describe("source-to-identity mapping", () => {
  it("keeps one tone per source and never routes a non-Broker to Broker", () => {
    expect(sourceTone("iq")).toBe("iq");
    expect(sourceTone("broker")).toBe("broker");
    expect(sourceTone("mixed")).toBe("mixed");
    expect(sourceTone(null)).toBe("unavailable");
  });

  it("always has a visible word for every source", () => {
    expect(sourceLabel("iq")).toBe("IQ");
    expect(sourceLabel("broker")).toBe("Broker");
    expect(sourceLabel("mixed")).toBe("Mixed");
    expect(sourceLabel(null)).toBe("Source unavailable");
  });

  it("describes each tone in prose for the tooltip", () => {
    for (const tone of ["iq", "broker", "mixed", "unavailable"] as const) {
      expect(SOURCE_DESCRIPTIONS[tone].length).toBeGreaterThan(20);
    }
  });
});

describe("Broker glyph", () => {
  it("is a dedicated mark, not the old person icon", () => {
    const broker = renderToStaticMarkup(<SourceIcon source="broker" />);
    expect(broker).not.toContain(PERSON_ICON_ARC);
    expect(broker).toContain("<circle");
    expect(broker).toContain('aria-hidden="true"');
  });

  it("is not the IQ bolt", () => {
    const iq = renderToStaticMarkup(<SourceIcon source="iq" />);
    const broker = renderToStaticMarkup(<SourceIcon source="broker" />);
    expect(iq).toContain("M7 1 2.5 6.75");
    expect(broker).not.toContain("M7 1 2.5 6.75");
  });

  it("draws a different glyph for all four sources", () => {
    const drawn = SOURCES.map((source) =>
      renderToStaticMarkup(<SourceIcon source={source} />),
    );
    expect(new Set(drawn).size).toBe(SOURCES.length);
  });

  it("uses the shared 12x12 box every other Step Bro glyph uses", () => {
    for (const source of SOURCES) {
      expect(renderToStaticMarkup(<SourceIcon source={source} />)).toContain(
        'viewBox="0 0 12 12"',
      );
    }
  });
});

describe("order card and company header chips", () => {
  it("gives Broker its own tone and the visible word", () => {
    const html = chips("broker");
    expect(html).toContain("meta-chip--broker");
    expect(html).toContain(">Broker<");
    expect(html).toContain("Broker account");
  });

  it("leaves IQ blue and untouched", () => {
    const html = chips("iq");
    expect(html).toContain("meta-chip--iq");
    expect(html).toContain(">IQ<");
    expect(html).not.toContain("meta-chip--broker");
  });

  it("no longer lets mixed borrow the Broker tone", () => {
    const html = chips("mixed");
    expect(html).toContain("meta-chip--mixed");
    expect(html).not.toContain("meta-chip--broker");
    expect(html).toContain(">Mixed<");
  });

  it("keeps an unclassifiable order neutral and explicitly labelled", () => {
    const html = chips(null);
    expect(html).toContain("meta-chip--unavailable");
    expect(html).not.toContain("meta-chip--broker");
    expect(html).not.toContain("meta-chip--iq");
    expect(html).toContain("Source unavailable");
  });

  it("never draws the person icon for any source", () => {
    for (const source of SOURCES) {
      expect(chips(source)).not.toContain(PERSON_ICON_ARC);
    }
  });
});

describe("collapsed account rows", () => {
  it("tints the Broker source item and keeps the label", () => {
    const html = row("broker");
    expect(html).toContain("account-summary-item--broker");
    expect(html).toContain("Broker");
    expect(html).not.toContain(PERSON_ICON_ARC);
  });

  it("keeps IQ on its own tone", () => {
    const html = row("iq");
    expect(html).toContain("account-summary-item--iq");
    expect(html).not.toContain("account-summary-item--broker");
  });

  it("leaves mixed and unavailable in the row's neutral voice", () => {
    for (const source of ["mixed", null] as const) {
      const html = row(source);
      expect(html).not.toContain("account-summary-item--broker");
      expect(html).not.toContain("account-summary-item--iq");
    }
  });
});

describe("account source filter", () => {
  const html = renderToStaticMarkup(
    <AccountFilterToolbar
      basePath="/all-accounts"
      currentParams={{}}
      source="broker"
      range={undefined}
      rangeWindowLabel={undefined}
    />,
  );

  it("marks the Broker segment with its own variant and an icon", () => {
    expect(html).toContain("seg-option--broker");
    expect(html).toContain("seg-option-icon");
    expect(html).toContain(">Broker<");
  });

  it("keeps the selected segment readable without colour", () => {
    // The checkmark is the non-colour selected indicator.
    expect(html).toContain("seg-check");
    expect(html).toContain('aria-checked="true"');
  });

  it("leaves All with no source glyph and IQ with its own", () => {
    expect(html).toContain("seg-option--iq");
    expect(html).toContain(">All<");
    expect(html).not.toContain(PERSON_ICON_ARC);
  });
});

describe("Broker Gate rail", () => {
  const html = renderToStaticMarkup(
    <BrokerGateRail brokerGate="G3" brokerGateAt="2026-08-14T20:00:00.000Z" />,
  );

  it("names the rail with the shared Broker identity", () => {
    expect(html).toContain("source-identity--broker");
    expect(html).toContain(">Broker<");
  });

  it("accents only the current gate and leaves the rest neutral", () => {
    expect(html.match(/broker-gate-dot--current/g)).toHaveLength(1);
    expect(html.match(/class="broker-gate-dot"/g)).toHaveLength(5);
  });

  it("uses the standard identity size for a section heading", () => {
    expect(html).toContain("source-identity--md");
  });
});

describe("icon-only identity", () => {
  it("carries an accessible name and a tooltip when the label is hidden", () => {
    const html = renderToStaticMarkup(
      <AccountSourceIdentity source="broker" showLabel={false} />,
    );
    expect(html).toContain('aria-label="Broker"');
    expect(html).toContain('title="Broker"');
    expect(html).toContain('role="img"');
  });

  it("does not repeat the name to screen readers when the label shows", () => {
    const html = renderToStaticMarkup(
      <AccountSourceIdentity source="broker" />,
    );
    expect(html).not.toContain('aria-label="Broker"');
    expect(html).toContain(">Broker<");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("Broker colour comes only from shared tokens", () => {
  it("defines every requested Broker role", () => {
    for (const token of [
      "--broker",
      "--broker-ink",
      "--broker-icon",
      "--broker-surface",
      "--broker-border",
      "--broker-hover",
      "--broker-selected",
      "--broker-focus",
    ]) {
      expect(GLOBALS).toContain(`${token}:`);
    }
  });

  it("themes the base colour for light and dark", () => {
    const light = GLOBALS.slice(0, GLOBALS.indexOf('[data-theme="dark"]'));
    const dark = GLOBALS.slice(GLOBALS.indexOf('[data-theme="dark"]'));
    expect(light).toMatch(/--broker:\s*#[0-9a-f]{6}/i);
    expect(dark).toMatch(/--broker:\s*#[0-9a-f]{6}/i);
  });

  it("never hard-codes a colour in a Broker rule", () => {
    // Every declaration inside a .*--broker / broker-gate rule must resolve
    // through a token, so there is one place to retune the hue.
    const brokerRules = [
      ...GLOBALS.matchAll(/^\.[^{}]*broker[^{}]*\{([^}]*)\}/gim),
    ].map((match) => match[1]);
    expect(brokerRules.length).toBeGreaterThan(4);
    for (const body of brokerRules) {
      expect(body).not.toMatch(/:\s*#[0-9a-f]{3,8}\b/i);
      expect(body).not.toMatch(/\b(rgb|hsl)a?\(/i);
    }
  });
});
