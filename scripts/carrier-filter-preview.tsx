/**
 * Static visual preview of the Accounts search row with the carrier filter —
 * search left, carrier multi-select far right, plus the open popover (the
 * popover is client-state, so its markup is mirrored here with the same
 * classes) and a narrow-width wrap scene.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/carrier-filter-preview.tsx
 * Then screenshot .tmp-preview/carrier-filter-{light,dark}.html
 */
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Module from "module";

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
  const { AccountSearchField } = await import(
    "../src/app/all-accounts/AccountSearchField"
  );
  const { CarrierMultiSelect } = await import(
    "../src/app/all-accounts/CarrierMultiSelect"
  );
  const { StateSortSelect } = await import(
    "../src/app/all-accounts/StateSortSelect"
  );

  const STATE_OPTIONS = [
    { id: "CA", code: "CA", label: "California", accountCount: 1003 },
    { id: "FL", code: "FL", label: "Florida", accountCount: 1182 },
    { id: "NY", code: "NY", label: "New York", accountCount: 494 },
    { id: "TX", code: "TX", label: "Texas", accountCount: 816 },
    { id: "state:none", code: null, label: "Unknown / Not set", accountCount: 39 },
  ];

  const OPTIONS = [
    { key: "coterie insurance", label: "Coterie Insurance", orderCount: 214 },
    { key: "hiscox ins co", label: "Hiscox Ins Co", orderCount: 356 },
    { key: "markel insurance company", label: "Markel Insurance Company", orderCount: 48 },
    { key: "next insurance us inc", label: "NEXT Insurance US Inc", orderCount: 1254 },
    { key: "spinnaker specialty insurance comp", label: "Spinnaker Specialty Insurance Comp", orderCount: 693 },
  ];

  const searchRow = (
    selected: string[],
    unavailable: { key: string; label: string }[] = [],
    states: string[] = [],
    sort: {
      date: "oldest" | "newest";
      revenue: "none" | "revenue-desc" | "revenue-asc";
    } = { date: "oldest", revenue: "none" },
  ) =>
    renderToStaticMarkup(
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <AccountSearchField
          basePath="/pending-orders"
          currentParams={{ range: "all-time" }}
          committedQuery=""
          resultCount={336}
        />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <CarrierMultiSelect
            basePath="/pending-orders"
            currentParams={{ range: "all-time" }}
            selected={selected}
            options={OPTIONS}
            unavailableSelected={unavailable}
            resultTotal={336}
          />
          <StateSortSelect
            basePath="/pending-orders"
            currentParams={{ range: "all-time" }}
            selectedStates={states}
            sort={sort}
            options={STATE_OPTIONS}
            unavailableSelected={[]}
            resultTotal={336}
          />
        </div>
      </div>,
    );

  // Popover mock: same classes and structure the component renders when open.
  const popover = renderToStaticMarkup(
    <div
      className="pipeline-select pipeline-select--carrier carrier-filter"
      style={{ width: "14rem", marginLeft: 0 }}
    >
      <button
        type="button"
        className="filter-select pipeline-trigger carrier-trigger carrier-trigger--active"
        aria-expanded
      >
        <svg viewBox="0 0 12 12" width={11} height={11} fill="none" aria-hidden className="pipeline-trigger-icon">
          <path d="M6 1.3 10.1 3v2.9c0 2.5-1.7 4.1-4.1 4.8C3.6 9.99 1.9 8.4 1.9 5.9V3L6 1.3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <span className="pipeline-trigger-label">2 carriers selected</span>
        <svg viewBox="0 0 12 12" width={12} height={12} fill="none" aria-hidden className="pipeline-chevron">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        className="pipeline-popover carrier-popover"
        role="dialog"
        style={{ position: "static", marginTop: "0.25rem" }}
      >
        <div className="carrier-popover-head">
          <span className="carrier-popover-label">Carriers</span>
          <button type="button" className="filter-clear">Clear</button>
        </div>
        <div className="carrier-search">
          <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-3 w-3 shrink-0 text-[var(--muted)]">
            <circle cx="7" cy="7" r="4.25" />
            <path d="m10.2 10.2 3 3" />
          </svg>
          <input type="text" className="carrier-search-input" placeholder="Search carriers…" readOnly />
        </div>
        <ul className="pipeline-popover-list carrier-popover-list">
          <li className="carrier-group-label" aria-hidden>Selected</li>
          <li>
            <label className="pipeline-option carrier-option">
              <input type="checkbox" defaultChecked readOnly />
              <span className="carrier-option-name">Hiscox Ins Co</span>
              <span className="carrier-option-count">356</span>
            </label>
          </li>
          <li>
            <label className="pipeline-option carrier-option carrier-option--unavailable">
              <input type="checkbox" defaultChecked readOnly />
              <span className="carrier-option-name">Lloyds c/o Maximum Insurance Brokerage</span>
              <span className="carrier-option-note">Unavailable</span>
            </label>
          </li>
          <li className="carrier-group-label" aria-hidden>All carriers</li>
          {OPTIONS.filter((option) => option.key !== "hiscox ins co").map((option) => (
            <li key={option.key}>
              <label className="pipeline-option carrier-option">
                <input type="checkbox" readOnly />
                <span className="carrier-option-name">{option.label}</span>
                <span className="carrier-option-count">{option.orderCount.toLocaleString()}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>,
  );

  // State & Sort popover mock: same classes/structure the component renders,
  // captured with the state dropdown expanded.
  const stateSortPopover = (statesOpen: boolean) =>
    renderToStaticMarkup(
      <div
        className="pipeline-select pipeline-select--carrier state-sort-select"
        style={{ width: "13rem", marginLeft: 0 }}
      >
        <button
          type="button"
          className="filter-select pipeline-trigger carrier-trigger carrier-trigger--active"
          aria-expanded
        >
          <svg viewBox="0 0 12 12" width={11} height={11} fill="none" aria-hidden className="pipeline-trigger-icon">
            <path d="M1.5 3.25h9M1.5 8.75h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="7.75" cy="3.25" r="1.45" stroke="currentColor" strokeWidth="1.2" fill="var(--surface-raised)" />
            <circle cx="4.25" cy="8.75" r="1.45" stroke="currentColor" strokeWidth="1.2" fill="var(--surface-raised)" />
          </svg>
          <span className="pipeline-trigger-label">2 states · Revenue high · Newest</span>
          <svg viewBox="0 0 12 12" width={12} height={12} fill="none" aria-hidden className="pipeline-chevron">
            <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div
          className="pipeline-popover carrier-popover state-sort-popover"
          role="dialog"
          style={{ position: "static", marginTop: "0.25rem" }}
        >
          <div className="carrier-popover-head">
            <span className="carrier-popover-label">Location State</span>
            <button type="button" className="filter-clear">Clear</button>
          </div>
          <button
            type="button"
            className="filter-select pipeline-trigger state-dropdown-trigger"
            aria-expanded={statesOpen}
          >
            <span className="pipeline-trigger-label">2 states</span>
            <svg
              viewBox="0 0 12 12"
              width={12}
              height={12}
              fill="none"
              aria-hidden
              className={`pipeline-chevron${statesOpen ? " state-dropdown-chevron--open" : ""}`}
            >
              <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {statesOpen ? (
            <div className="state-dropdown-panel">
              <div className="carrier-search">
                <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-3 w-3 shrink-0 text-[var(--muted)]">
                  <circle cx="7" cy="7" r="4.25" />
                  <path d="m10.2 10.2 3 3" />
                </svg>
                <input type="text" className="carrier-search-input" placeholder="Search states…" readOnly />
              </div>
              <ul className="pipeline-popover-list carrier-popover-list state-sort-state-list">
                {STATE_OPTIONS.map((option) => (
                  <li key={option.id}>
                    <label className={`pipeline-option carrier-option`}>
                      <input type="checkbox" defaultChecked={option.id === "CA" || option.id === "NY"} readOnly />
                      {option.code ? <span className="pipeline-option-code">{option.code}</span> : null}
                      <span className="carrier-option-name">{option.label}</span>
                      <span className="carrier-option-count">{option.accountCount.toLocaleString()}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="state-sort-sort">
            <span className="carrier-popover-label">Sort · Date</span>
            <div role="radiogroup" className="state-sort-radios">
              {["Oldest first", "Newest first"].map((label) => (
                <label key={label} className="pipeline-option state-sort-radio">
                  <input type="radio" name={`preview-date-${statesOpen}`} defaultChecked={label === "Newest first"} readOnly />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <span className="carrier-popover-label">Sort · Revenue</span>
            <div role="radiogroup" className="state-sort-radios">
              {["None", "High to low", "Low to high"].map((label) => (
                <label key={label} className="pipeline-option state-sort-radio">
                  <input type="radio" name={`preview-revenue-${statesOpen}`} defaultChecked={label === "High to low"} readOnly />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>,
    );

  function page(theme: "light" | "dark") {
    return `<!doctype html>
<html data-theme="${theme}">
<head><meta charset="utf-8"><link rel="stylesheet" href="preview.css"></head>
<body style="padding:24px;max-width:1080px">
  <p class="eyebrow">Search row — nothing selected (desktop)</p>
  ${searchRow([])}
  <p class="eyebrow" style="margin-top:24px">Search row — carrier + state + sort active</p>
  ${searchRow(["hiscox ins co"], [], ["CA"], { date: "newest", revenue: "none" })}
  <p class="eyebrow" style="margin-top:24px">Search row — several states, combined revenue + date sort</p>
  ${searchRow(
    ["hiscox ins co", "lloyds c/o maximum insurance brokerage", "next insurance us inc"],
    [{ key: "lloyds c/o maximum insurance brokerage", label: "Lloyds c/o Maximum Insurance Brokerage" }],
    ["CA", "FL", "NY"],
    { date: "newest", revenue: "revenue-desc" },
  )}
  <p class="eyebrow" style="margin-top:24px">Carrier popover open</p>
  ${popover}
  <p class="eyebrow" style="margin-top:24px">State &amp; Sort popover — state dropdown closed</p>
  ${stateSortPopover(false)}
  <p class="eyebrow" style="margin-top:24px">State &amp; Sort popover — state dropdown open</p>
  ${stateSortPopover(true)}
  <p class="eyebrow" style="margin-top:24px">Narrow width — intentional wrap</p>
  <div style="max-width:460px;border:1px dashed var(--rule);padding:12px">
    ${searchRow(["hiscox ins co", "coterie insurance"], [], ["CA"], { date: "oldest", revenue: "revenue-asc" })}
  </div>
</body>
</html>`;
  }

  const outDir = path.join(process.cwd(), ".tmp-preview");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "carrier-filter-light.html"), page("light"));
  fs.writeFileSync(path.join(outDir, "carrier-filter-dark.html"), page("dark"));
  console.log("wrote .tmp-preview/carrier-filter-{light,dark}.html");
}

void main();
