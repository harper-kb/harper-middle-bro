/**
 * Static visual-regression scenes for the shared Records context bar.
 *
 * Run:
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json \
 *     scripts/records-context-bar-preview.tsx
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordsContextBar } from "../src/app/all-accounts/RecordsContextBar";
import type { RecordsFilterSummaryState } from "../src/app/all-accounts/records-filter-summary";

const FILTERS: RecordsFilterSummaryState = {
  source: "broker",
  iqStages: [],
  brokerGates: ["G3", "G4"],
  range: "this-week",
  carriers: [
    { key: "hiscox", label: "Hiscox Ins Co" },
    { key: "next", label: "NEXT Insurance US Inc" },
    { key: "markel", label: "Markel Insurance Company" },
    { key: "coterie", label: "Coterie Insurance" },
  ],
  locationStates: ["CA", "NY", "TX"],
  sort: { date: "newest", revenue: "revenue-desc" },
  search: "Loyalty",
};

const sourceCss = fs
  .readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
  .replace('@import "tailwindcss";', "");

function bar(pinned: boolean) {
  return renderToStaticMarkup(
    <RecordsContextBar
      pinned={pinned}
      viewMode="pending"
      viewTitle="Pending Orders"
      total={10_093}
      filterState={FILTERS}
      openCount={2}
      onCloseAll={() => {}}
      pagination={{
        currentPage: 4,
        totalPages: 101,
        currentParams: { source: "broker", range: "this-week" },
        basePath: "/pending-orders",
      }}
    />,
  );
}

function html({
  theme,
  width,
  navHeight,
  pinned,
}: {
  theme: "light" | "dark";
  width: number;
  navHeight: number;
  pinned: boolean;
}) {
  const rows = Array.from({ length: 7 }, (_, index) => `
    <div class="preview-row">
      <span>Account ${index + 1}</span>
      <span>${index % 2 === 0 ? "Broker" : "IQ"} · Revenue $${(
        4200 +
        index * 505
      ).toLocaleString("en-US")}</span>
    </div>`).join("");
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    ${sourceCss}
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body { padding: 24px; background: #707477; }
    .preview-viewport {
      --top-nav-height: ${navHeight}px;
      --top-nav-bottom: ${navHeight}px;
      width: ${width}px;
      max-width: 100%;
      height: 430px;
      overflow: hidden;
      border: 1px solid #0005;
      background: var(--background);
      box-shadow: 0 20px 60px #0004;
    }
    .preview-top-nav {
      display: flex;
      height: var(--top-nav-height);
      align-items: center;
      border-bottom: 1px solid var(--rule);
      background: var(--paper);
      padding-inline: 14px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .preview-main { padding: 0 12px 24px; }
    .account-results {
      overflow: clip;
      border: 1px solid var(--rule);
      border-top: 0;
      background: var(--surface-raised);
    }
    .account-pagination { display: flex; align-items: center; gap: .5rem; }
    .btn-ghost {
      border: 1px solid transparent;
      border-radius: .5rem;
      color: var(--muted);
      text-decoration: none;
    }
    .preview-row {
      display: flex;
      min-height: 52px;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--rule);
      padding: 10px 14px;
      color: var(--ink);
      font-size: 12px;
    }
    .preview-row span:last-child { color: var(--muted); font-size: 10px; }
  </style>
</head>
<body>
  <div class="preview-viewport">
    <div class="preview-top-nav">Step Bro · Operational stats</div>
    <main class="preview-main">
      <div class="account-results">
        ${bar(pinned)}
        ${rows}
      </div>
    </main>
  </div>
  <output id="geometry" hidden></output>
  <script>
    const nav = document.querySelector(".preview-top-nav").getBoundingClientRect();
    const header = document.querySelector(".account-results-header").getBoundingClientRect();
    const firstRow = document.querySelector(".preview-row").getBoundingClientRect();
    document.getElementById("geometry").textContent = JSON.stringify({
      gap: header.top - nav.bottom,
      headerHeight: header.height,
      headerWidth: header.width,
      rowWidth: firstRow.width,
      pinned: document.querySelector(".account-results-header").dataset.pinned
    });
  </script>
</body>
</html>`;
}

const output = path.join(process.cwd(), ".tmp-preview");
fs.mkdirSync(output, { recursive: true });
for (const scene of [
  { name: "light", theme: "light", width: 1152, navHeight: 46, pinned: true },
  { name: "dark", theme: "dark", width: 1152, navHeight: 46, pinned: true },
  {
    name: "mobile",
    theme: "dark",
    width: 390,
    navHeight: 102.4,
    pinned: true,
  },
  {
    name: "safe-area",
    theme: "dark",
    width: 390,
    navHeight: 122.4,
    pinned: true,
  },
  { name: "normal", theme: "light", width: 900, navHeight: 46, pinned: false },
] as const) {
  fs.writeFileSync(
    path.join(output, `records-context-${scene.name}.html`),
    html(scene),
  );
}

console.log(`Wrote Records context previews to ${output}`);
