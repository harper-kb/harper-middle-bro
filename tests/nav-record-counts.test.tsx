import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavSections } from "@/components/Nav";
import { RecordsFilterProvider } from "@/app/all-accounts/RecordsFilterProvider";
import { parseRecordsFilterState } from "@/app/all-accounts/records-filter-state";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/pending-orders",
}));

describe("Records navigation counts", () => {
  it("renders formatted order counts for every Records child", () => {
    const html = renderToStaticMarkup(
      <NavSections
        path="/all-accounts"
        presence="active"
        recordCounts={{
          allOrders: 12_001,
          pendingOrders: 842,
          boundOrders: 9_120,
          lostOrders: 2_039,
        }}
        collapsed={{}}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain("12,001");
    expect(html).toContain("842");
    expect(html).toContain("9,120");
    expect(html).toContain("2,039");
  });

  it("keeps inactive counts hidden until hover or keyboard focus", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/\.nav-record-count\s*\{[^}]*opacity:\s*0/);
    expect(css).toContain(
      '.nav-record-link[aria-current="page"] .nav-record-count',
    );
    expect(css).toContain(".nav-record-link:hover .nav-record-count");
    expect(css).toContain(".nav-record-link:focus-visible .nav-record-count");
  });

  it("carries compatible canonical filters through every sidebar child", () => {
    const state = parseRecordsFilterState("pending", {
      source: "iq",
      iqStage: "bind_requested",
      range: "this-week",
      carrier: "hiscox ins co",
      state: "CA",
      q: "acme",
      page: "4",
    });
    const html = renderToStaticMarkup(
      <RecordsFilterProvider state={state}>
        <NavSections
          path="/pending-orders"
          presence="active"
          recordCounts={null}
          collapsed={{}}
          onToggle={() => {}}
        />
      </RecordsFilterProvider>,
    );

    expect(html).toContain(
      'href="/all-accounts?source=iq&amp;iqStage=bind_requested&amp;carrier=hiscox+ins+co&amp;state=CA&amp;q=acme"',
    );
    expect(html).toContain(
      'href="/bound-orders?source=iq&amp;range=this-week&amp;carrier=hiscox+ins+co&amp;state=CA&amp;q=acme"',
    );
    expect(html).toContain(
      'href="/lost-orders?source=iq&amp;carrier=hiscox+ins+co&amp;state=CA&amp;q=acme"',
    );
  });
});
