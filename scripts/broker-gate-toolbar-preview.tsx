/**
 * Static visual preview of the Accounts filter toolbar with the Broker Gate
 * multi-select — collapsed trigger and an open popover mock (the popover is
 * client-state, so its markup is mirrored here with the same classes).
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/broker-gate-toolbar-preview.tsx
 * Then screenshot .tmp-preview/broker-gate-toolbar-{light,dark}.html
 */
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Module from "module";

// The toolbar is a client component using useRouter; stub the module before
// the toolbar is loaded (hence the dynamic imports below).
const nextNavigation = {
  useRouter: () => ({ push: () => {}, replace: () => {} }),
};
const moduleLoader = Module as unknown as {
  _load: (...args: unknown[]) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (...args: unknown[]) {
  if (args[0] === "next/navigation") return nextNavigation;
  return originalLoad.apply(this, args);
};

async function main() {
const { AccountFilterToolbar } = await import(
  "../src/app/all-accounts/AccountFilterToolbar"
);
const { BROKER_GATE_FILTER_OPTIONS } = await import("../src/lib/broker-gate");
const { SourceIcon } = await import("../src/components/SourceIdentity");
const { KpiStrip } = await import("../src/app/all-accounts/KpiStrip");

const toolbarClosed = renderToStaticMarkup(
  <AccountFilterToolbar
    basePath="/pending-orders"
    currentParams={{ source: "broker", range: "all-time" }}
    source="broker"
    range="all-time"
    rangeWindowLabel="All available order history"
    showBrokerGate
    brokerGates={[]}
  />,
);

const toolbarSelected = renderToStaticMarkup(
  <AccountFilterToolbar
    basePath="/pending-orders"
    currentParams={{ source: "broker", range: "all-time", brokerGate: "G3,G4" }}
    source="broker"
    range="all-time"
    rangeWindowLabel="All available order history"
    showBrokerGate
    brokerGates={["G3", "G4"]}
  />,
);

// Popover mock: same classes and structure the component renders when open.
const popover = renderToStaticMarkup(
  <div className="pipeline-select pipeline-select--broker" style={{ width: "12rem" }}>
    <button type="button" className="filter-select pipeline-trigger" aria-expanded>
      <SourceIcon source="broker" className="pipeline-trigger-icon" />
      <span className="pipeline-trigger-label">2 gates selected</span>
      <svg viewBox="0 0 12 12" width={12} height={12} fill="none" aria-hidden className="pipeline-chevron">
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    <div className="pipeline-popover" style={{ position: "static", marginTop: "0.25rem" }} role="listbox">
      <div className="pipeline-popover-actions">
        <button type="button" className="filter-clear">Select all</button>
        <button type="button" className="filter-clear">Clear</button>
      </div>
      <ul className="pipeline-popover-list">
        {BROKER_GATE_FILTER_OPTIONS.map((option) => (
          <li key={option.id}>
            <label className="pipeline-option">
              <input type="checkbox" defaultChecked={option.id === "G3" || option.id === "G4"} readOnly />
              {option.code ? <span className="pipeline-option-code">{option.code}</span> : null}
              <span>{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  </div>,
);

// Stacking repro: busy toolbar with the popover open, KPI numbers behind it.
// `simulateOldBug` puts the opacity back on the container the way the old CSS
// did, recreating the stacking context that let the numbers paint over the
// open menu mid-update.
function busyScene(simulateOldBug: boolean) {
  return renderToStaticMarkup(
    <div>
      <div
        className="filter-toolbar"
        aria-busy="true"
        style={simulateOldBug ? { opacity: 0.7 } : undefined}
      >
        <div className="min-w-0">
          <span className="filter-group-label">
            <span>Broker Gate</span>
          </span>
          <div className="pipeline-select pipeline-select--broker">
            <button type="button" className="filter-select pipeline-trigger" aria-expanded>
              <SourceIcon source="broker" className="pipeline-trigger-icon" />
              <span className="pipeline-trigger-label">2 gates selected</span>
              <svg viewBox="0 0 12 12" width={12} height={12} fill="none" aria-hidden className="pipeline-chevron">
                <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="pipeline-popover" role="listbox">
              <div className="pipeline-popover-actions">
                <button type="button" className="filter-clear">Select all</button>
                <button type="button" className="filter-clear">Clear</button>
              </div>
              <ul className="pipeline-popover-list">
                {BROKER_GATE_FILTER_OPTIONS.map((option) => (
                  <li key={option.id}>
                    <label className="pipeline-option">
                      <input type="checkbox" defaultChecked={option.id === "G3" || option.id === "G4"} readOnly />
                      {option.code ? <span className="pipeline-option-code">{option.code}</span> : null}
                      <span>{option.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="filter-group-note" role="status">Updating…</span>
          <button type="button" className="filter-clear">Clear filters</button>
        </div>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <KpiStrip
          stats={[
            { label: "Accounts", value: 138 },
            { label: "Pending Orders", value: 139, tone: "pending" },
            { label: "Revenue", value: "$118,204.11" },
          ]}
        />
      </div>
    </div>,
  );
}

function page(theme: "light" | "dark") {
  return `<!doctype html>
<html data-theme="${theme}">
<head><meta charset="utf-8"><link rel="stylesheet" href="preview.css"></head>
<body style="padding:24px;max-width:960px">
  <p class="eyebrow">Collapsed — nothing selected</p>
  ${toolbarClosed}
  <p class="eyebrow" style="margin-top:24px">Collapsed — two gates selected</p>
  ${toolbarSelected}
  <p class="eyebrow" style="margin-top:24px">Popover open</p>
  ${popover}
  <div style="display:flex;gap:48px;margin-top:32px">
    <div style="flex:1">
      <p class="eyebrow">Mid-update — old CSS (bug: numbers paint over the menu)</p>
      ${busyScene(true)}
    </div>
    <div style="flex:1">
      <p class="eyebrow">Mid-update — fixed (menu stays on top)</p>
      ${busyScene(false)}
    </div>
  </div>
</body>
</html>`;
}

const outDir = path.join(process.cwd(), ".tmp-preview");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "broker-gate-toolbar-light.html"), page("light"));
fs.writeFileSync(path.join(outDir, "broker-gate-toolbar-dark.html"), page("dark"));
console.log("wrote .tmp-preview/broker-gate-toolbar-{light,dark}.html");
}

void main();
