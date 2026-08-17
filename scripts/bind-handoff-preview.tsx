/**
 * Static visual preview of the Bind Policy → Big Brother handoff modal over a
 * mock application background, so the backdrop blur, the sharp panel and both
 * themes can be checked without a running server.
 *
 * The real component is mounted in jsdom (it portals to document.body and
 * subdues the background on mount), then the resulting DOM is serialised.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/bind-handoff-preview.tsx
 * Then screenshot .tmp-preview/bind-handoff-{light,dark}.html
 */
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://step-bro.test/pending-orders",
});
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.MutationObserver = dom.window.MutationObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;

const BACKGROUND = `
<div class="h-full bg-[var(--background)]">
  <header class="flex items-center justify-between border-b border-[var(--rule)] bg-[var(--surface)] px-6 py-3">
    <div class="flex items-center gap-3">
      <span class="text-base font-semibold text-[var(--ink)]">Step&nbsp;Bro</span>
      <span class="eyebrow">Pending Orders</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="rounded-lg border border-[var(--rule)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)]">336 accounts</span>
      <span class="rounded-lg border border-[var(--rule)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)]">All time</span>
    </div>
  </header>
  <div class="mx-auto max-w-5xl px-6 py-6">
    <h1 class="text-xl font-semibold text-[var(--ink)]">Apocalipsis Nocturnal</h1>
    <p class="mt-1 text-xs text-[var(--muted)]">Company #900319 · Nevada · 2 pending orders</p>
    <ul class="mt-4 space-y-3">
      ${[
        { id: 13070, premium: "$2,375.00", carrier: "Burlington Ins Co" },
        { id: 13061, premium: "$1,120.00", carrier: "Evanston Insurance Company" },
      ]
        .map(
          (o) => `
      <li class="step-bro-order-card rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] px-3 py-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[var(--ink)]">Order #${o.id}</h3>
            <p class="mt-1 text-[11px] text-[var(--muted)]">${o.carrier} · 1 policy · 1 document</p>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)]">✎ Edit</span>
            <span class="order-bind-button">◎ Bind Policy</span>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-4 gap-4 border-t border-[var(--rule)] pt-2.5">
          <div><p class="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Premium</p><p class="mt-0.5 text-sm font-semibold text-[var(--ink)]">${o.premium}</p></div>
          <div><p class="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Taxes</p><p class="mt-0.5 text-sm font-semibold text-[var(--ink)]">$0.00</p></div>
          <div><p class="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Fees</p><p class="mt-0.5 text-sm font-semibold text-[var(--ink)]">$85.00</p></div>
          <div><p class="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Total</p><p class="mt-0.5 text-sm font-semibold text-[var(--ink)]">${o.premium}</p></div>
        </div>
      </li>`,
        )
        .join("")}
    </ul>
  </div>
</div>`;

async function main() {
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { BindHandoffDialog } = await import(
    "../src/components/orders/BindHandoffDialog"
  );

  async function scene(target: {
    orderId: number;
    orderLabel: string;
    accountName: string;
    bigBrotherCompanyId: string | null;
  }) {
    const app = dom.window.document.createElement("div");
    app.innerHTML = BACKGROUND;
    dom.window.document.body.appendChild(app);

    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        React.createElement(BindHandoffDialog, { target, onClose: () => {} }),
      );
    });

    const html = dom.window.document.body.innerHTML;
    await act(async () => root.unmount());
    dom.window.document.body.innerHTML = "";
    return html;
  }

  const resolved = await scene({
    orderId: 13070,
    orderLabel: "Order #13070",
    accountName: "Apocalipsis Nocturnal",
    bigBrotherCompanyId: "900319",
  });
  const unavailable = await scene({
    orderId: 13078,
    orderLabel: "Order #13078",
    accountName: "Sunbeam Beauty Wellness, LLC",
    bigBrotherCompanyId: null,
  });

  function page(theme: "light" | "dark") {
    // `transform` makes each scene the containing block for the dialog's
    // fixed-position backdrop, so the scenes do not stack on the viewport.
    const scene = (html: string, style: string) =>
      `<section style="position:relative;transform:translate(0);overflow:hidden;background:var(--background);${style}">${html}</section>`;
    return `<!doctype html>
<html data-theme="${theme}" style="color-scheme:${theme}">
<head><meta charset="utf-8"><link rel="stylesheet" href="preview.css"></head>
<body style="margin:0;background:var(--surface-subtle)">
  <p class="eyebrow" style="padding:10px 16px 6px">Handoff available — desktop</p>
  ${scene(resolved, "height:520px")}
  <p class="eyebrow" style="padding:18px 16px 6px">Big Brother route id missing</p>
  ${scene(unavailable, "height:520px")}
  <p class="eyebrow" style="padding:18px 16px 6px">Mobile — 390px</p>
  ${scene(resolved, "height:520px;width:390px")}
</body>
</html>`;
  }

  const outDir = path.join(process.cwd(), ".tmp-preview");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "bind-handoff-light.html"), page("light"));
  fs.writeFileSync(path.join(outDir, "bind-handoff-dark.html"), page("dark"));
  console.log("wrote .tmp-preview/bind-handoff-{light,dark}.html");
}

void main();
