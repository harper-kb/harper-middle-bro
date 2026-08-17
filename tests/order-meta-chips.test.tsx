/**
 * Order preview metadata: what the chips actually claim about source, revenue
 * and deal age. The distinctions that matter are the honest ones — null source
 * is not Broker, and missing revenue is not $0.00.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderMetaChips } from "@/app/all-accounts/OrderMetaChips";

function render(props: Parameters<typeof OrderMetaChips>[0]) {
  return renderToStaticMarkup(<OrderMetaChips {...props} />);
}

const base = {
  source: "iq",
  bindStatus: "pending",
  revenueMicros: 400_600_000,
  createdAt: "2026-08-14T22:47:55.000Z",
  todayDay: "2026-08-16",
} as const;

describe("source chip", () => {
  it("labels an IQ order with the blue tone and an icon", () => {
    const html = render({ ...base, source: "iq" });
    expect(html).toContain(">IQ<");
    expect(html).toContain("meta-chip--iq");
    expect(html).toContain("meta-chip-icon");
    expect(html).toContain("IQ account");
  });

  it("labels a broker order with its own purple tone and an icon", () => {
    const html = render({ ...base, source: "broker" });
    expect(html).toContain(">Broker<");
    expect(html).toContain("meta-chip--broker");
    expect(html).toContain("meta-chip-icon");
    expect(html).not.toContain("meta-chip--iq");
    expect(html).toContain("Broker account");
  });

  it("keeps a mixed order out of both buckets", () => {
    const html = render({ ...base, source: "mixed" });
    expect(html).toContain(">Mixed<");
    expect(html).toContain("Mixed account");
    expect(html).not.toContain("meta-chip--broker");
    expect(html).not.toContain("meta-chip--iq");
  });

  it("never classifies a null source as Broker", () => {
    const html = render({ ...base, source: null });
    expect(html).toContain("Source unavailable");
    expect(html).not.toContain(">Broker<");
    expect(html).not.toContain(">IQ<");
    expect(html).not.toContain("meta-chip--iq");
  });
});

describe("revenue chip", () => {
  it("formats USD with commas and two decimals", () => {
    expect(render({ ...base, revenueMicros: 400_600_000 })).toContain(
      "$400.60",
    );
    expect(render({ ...base, revenueMicros: 12_450_000_000 })).toContain(
      "$12,450.00",
    );
  });

  it("converts micros to exact cents", () => {
    // 544.43 arrives from the database as 544430000 micros.
    expect(render({ ...base, revenueMicros: 544_430_000 })).toContain("$544.43");
  });

  it("labels the amount as Revenue", () => {
    expect(render(base)).toContain("Revenue");
  });

  it("distinguishes missing revenue from an authoritative zero", () => {
    const missing = render({ ...base, revenueMicros: null });
    expect(missing).toContain("Revenue unavailable");
    expect(missing).not.toContain("$0.00");

    const zero = render({ ...base, revenueMicros: 0 });
    expect(zero).toContain("$0.00");
    expect(zero).not.toContain("Revenue unavailable");
  });
});

describe("deal age chip", () => {
  it("shows the calendar-day age with the exact creation stamp in a tooltip", () => {
    const html = render(base);
    expect(html).toContain("2 Days");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Aug 14, 2026");
    expect(html).toContain("PDT");
    expect(html).not.toContain("meta-chip--attention");
  });

  it("stays neutral through five days", () => {
    for (const [todayDay, label] of [
      ["2026-08-14", "0 Day"],
      ["2026-08-15", "1 Day"],
      ["2026-08-19", "5 Days"],
    ] as const) {
      const html = render({ ...base, todayDay });
      expect(html).toContain(label);
      expect(html).not.toContain("meta-chip--attention");
    }
  });

  it("escalates at six days with red plus an icon and a labelled reason", () => {
    const html = render({ ...base, todayDay: "2026-08-20" });
    expect(html).toContain("6 Days");
    expect(html).toContain("meta-chip--attention");
    expect(html).toContain("Needs attention — deal created 6 days ago");
  });

  it("reports an unavailable age rather than guessing", () => {
    const html = render({ ...base, createdAt: null });
    expect(html).toContain("Age unavailable");
    expect(html).not.toContain("0 Day");
  });

  it("omits age entirely once the order is Bound", () => {
    const html = render({ ...base, bindStatus: "bound" });
    expect(html).not.toMatch(/\d+ Days?/);
    expect(html).not.toContain("Age unavailable");
    expect(html).not.toContain("Needs attention");
  });
});

describe("accessibility", () => {
  it("ties every tooltip to its focusable chip", () => {
    const html = render({ ...base, todayDay: "2026-08-20" });
    const describedBy = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(describedBy.length).toBeGreaterThan(0);
    for (const id of describedBy) expect(html).toContain(`id="${id}"`);
    // Chips carrying a tooltip take focus so keyboard users can reach it.
    expect(html.match(/tabindex="0"/g)?.length).toBe(describedBy.length);
  });

  it("hides decorative icons from assistive technology", () => {
    const html = render(base);
    const icons = html.match(/<svg/g) ?? [];
    expect(icons.length).toBeGreaterThan(0);
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(icons.length);
  });
});
