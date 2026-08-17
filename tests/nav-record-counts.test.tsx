import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavSections } from "@/components/Nav";

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
});
