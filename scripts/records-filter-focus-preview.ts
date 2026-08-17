/**
 * Visual regression scene for an open Records filter crossing the sticky
 * context bar. The page and pinned bar sit under the shared blur; the active
 * trigger and menu remain sharp above both.
 */
import fs from "node:fs";
import path from "node:path";

const css = fs
  .readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
  .replace('@import "tailwindcss";', "");

const rows = Array.from(
  { length: 7 },
  (_, index) => `
    <div class="preview-row">
      <span>Account ${index + 1}</span>
      <span>No service or producer note</span>
    </div>`,
).join("");

const carriers = [
  ["Accelerant National Insurance Company", 1],
  ["Amtrust Ins Co of Kansas", 2],
  ["CERTAIN U/W @ LLOYDS (RSI INTL)", 1],
  ["Evanston Insurance Company", 4],
  ["Hadron Specialty Insurance Company", 3],
  ["Markel Insurance Company", 4],
  ["MESA UNDERWRITERS INS CO (MUSIC)", 1],
];

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    ${css}
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; min-height: 100%; }
    body { background: var(--background); color: var(--ink); }
    .fixed { position: fixed; }
    .inset-0 { inset: 0; }
    .preview-page { position: relative; width: 980px; height: 525px; overflow: hidden; }
    .preview-topbar {
      height: 46px;
      border-bottom: 1px solid var(--rule);
      background: var(--paper);
    }
    .preview-filter-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      height: 53px;
      padding: 6px 24px;
    }
    .preview-filter-row > .filter-select { width: 12rem; }
    .preview-results { margin-left: 166px; border: 1px solid var(--rule); }
    .preview-context {
      position: relative;
      z-index: var(--z-records-context);
      height: 54px;
      border-bottom: 1px solid var(--rule);
      background: var(--account-header-surface-pinned, var(--surface-hover));
    }
    .preview-row {
      display: flex;
      min-height: 72px;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--rule);
      padding: 12px 16px;
      background: var(--surface-raised);
      font-size: 12px;
    }
    .preview-row span:last-child { color: var(--muted); }
    .preview-open-filter {
      position: absolute;
      top: 52px;
      right: 298px;
      width: 336px;
    }
    .preview-open-filter .carrier-trigger { width: 100%; }
    .preview-open-filter .carrier-popover { max-height: 385px; }
  </style>
</head>
<body>
  <div class="preview-page">
    <div class="preview-topbar"></div>
    <div class="preview-filter-row">
      <button class="filter-select pipeline-trigger carrier-trigger">All carriers⌄</button>
      <button class="filter-select pipeline-trigger carrier-trigger carrier-trigger--active">All states · Newest⌄</button>
    </div>
    <div class="preview-results">
      <div class="preview-context"></div>
      ${rows}
    </div>

    <div class="records-filter-focus-backdrop fixed inset-0" aria-hidden="true"></div>

    <div class="preview-open-filter records-filter-control--open pipeline-select pipeline-select--carrier carrier-filter">
      <button class="filter-select pipeline-trigger carrier-trigger" aria-expanded="true">
        <span class="pipeline-trigger-label">All carriers</span>
        <span class="pipeline-chevron">⌄</span>
      </button>
      <div class="pipeline-popover carrier-popover" role="dialog">
        <div class="carrier-popover-head">
          <span class="carrier-popover-label">Carriers</span>
        </div>
        <div class="carrier-search">
          <span aria-hidden="true">⌕</span>
          <input class="carrier-search-input" placeholder="Search carriers…" />
        </div>
        <ul class="pipeline-popover-list carrier-popover-list">
          ${carriers
            .map(
              ([name, count]) => `
                <li>
                  <label class="pipeline-option carrier-option">
                    <input type="checkbox" />
                    <span class="carrier-option-name">${name}</span>
                    <span class="carrier-option-count">${count}</span>
                  </label>
                </li>`,
            )
            .join("")}
        </ul>
      </div>
    </div>
  </div>
</body>
</html>`;

const output = path.join(process.cwd(), ".tmp-preview");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "records-filter-focus.html"), html);
console.log(`Wrote ${path.join(output, "records-filter-focus.html")}`);
