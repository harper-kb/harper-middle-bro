/**
 * Autofill engine self-check — run with: npx tsx scripts/autofill-check.ts
 *
 * Exercises extension/src/inject/fill-engine.js against a jsdom replica of the Harper
 * checkout form, plus the failure modes that break naive form fillers:
 *
 *   - labels carried by plain <div>s while name/id are hashed build output
 *   - "Account number" sitting directly above "Confirm account number"
 *   - "Account type" sitting directly below "Account holder type"
 *   - React-controlled inputs that revert on the next render
 *   - a terms checkbox whose label wraps a live link
 *   - decoy fields (card, policy, search, first/last name) that must be left alone
 *
 * Exit 1 on any FAIL.
 */

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { PROFILE_FIELDS, emptyValues, isReady, newProfile, readyCount } from "../extension/src/lib/fields.js";
import { headline } from "../extension/src/lib/fill-runner.js";

const ENGINE_SOURCE = readFileSync(
  new URL("../extension/src/inject/fill-engine.js", import.meta.url),
  "utf8",
);

type FillResult = {
  key: string;
  label: string;
  status: "filled" | "already" | "not-found" | "failed" | "blocked";
  detail?: string;
  value?: string;
};

type FrameReport = { ok: boolean; results: FillResult[]; controlsScanned: number };

type EngineSpec = { key: string; kind: string; mirrors?: string };

type EngineWindow = {
  eval: (code: string) => unknown;
  __harperAutofill: {
    run: (payload: unknown) => Promise<FrameReport>;
    _internals: { SPECS: EngineSpec[] };
  };
};

type Payload = {
  values: Record<string, string | boolean | null>;
  customFields?: { match: string; value: string; kind?: string }[];
};

// ——— Harness ———

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeDom(body: string): JSDOM {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: "outside-only",
    url: "https://pay.harperinsure.example/checkout",
  });
}

async function runEngine(dom: JSDOM, payload: Payload): Promise<FrameReport> {
  const win = dom.window as unknown as EngineWindow;
  win.eval(ENGINE_SOURCE);
  return win.__harperAutofill.run(payload);
}

function statusOf(report: FrameReport, key: string): string {
  return report.results.find((result) => result.key === key)?.status ?? "missing";
}

function detailOf(report: FrameReport, key: string): string {
  const result = report.results.find((r) => r.key === key);
  return result ? `${result.status}${result.detail ? ` (${result.detail})` : ""}` : "no result";
}

/** A field group as the checkout renders it: label text in a div, control underneath. */
function group(label: string, control: string): string {
  return `<div class="fld"><div class="lbl">${label}</div>${control}</div>`;
}

/**
 * Replica of the payment page in the screenshot. Every `name` is deliberately meaningless,
 * so a match can only come from the visible label.
 */
function checkoutMarkup(): string {
  return `
    <main>
      <section class="pay">
        ${group("Card number", '<input type="text" name="f_2b7" />')}
        <div class="or">OR</div>
        ${group("Name of account holder", '<input type="text" name="f_9c1" />')}
        ${group(
          "Account holder type",
          '<select name="f_9c2"><option>Individual</option><option>Company</option></select>',
        )}
        ${group(
          "Account type",
          '<select name="f_9c3"><option>Checking</option><option>Savings</option></select>',
        )}
        ${group("Account number", '<input type="text" name="f_9c4" />')}
        ${group("Confirm account number", '<input type="text" name="f_9c5" />')}
        ${group("Routing number", '<input type="text" name="f_9c6" />')}

        <div class="switch-card">
          <div class="copy">
            <div class="t">Autopay</div>
            <div class="s">Make subsequent payments automatic</div>
          </div>
          <button type="button" role="switch" aria-checked="false" id="autopay"></button>
        </div>

        <div class="terms">
          <input type="checkbox" id="tos" name="f_9c9" />
          <span>By checking this box, I confirm that I have read and agree with the
            <a id="tos-link" href="https://harperinsure.example/terms">Terms of Use</a></span>
        </div>

        <button type="submit" id="submit">Pay $888.77</button>
      </section>

      <aside class="summary">
        <div>TOTAL</div><div>$888.77</div>
        <div>Commercial General Liability</div>
        <div>Maxum Indemnity Company • Pathpoint</div>
        <div>Downpayment</div>
      </aside>
    </main>`;
}

/** The switch is inert markup until something gives it behaviour, exactly like the real one. */
function wireSwitch(doc: Document) {
  const node = doc.getElementById("autopay");
  node?.addEventListener("click", () => {
    node.setAttribute("aria-checked", node.getAttribute("aria-checked") === "true" ? "false" : "true");
  });
}

const FULL_VALUES: Payload["values"] = {
  accountHolderName: "Greenleaf Landscape LLC",
  // Deliberately not the defaults shown on the page, so an unchanged select fails the test.
  accountHolderType: "Company",
  accountType: "Savings",
  accountNumber: "000123456789",
  routingNumber: "021000021",
  autopay: true,
  terms: true,
};

const value = (dom: JSDOM, name: string): string =>
  dom.window.document.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? "<missing>";

// ——— (a) The screenshot form, end to end ———

async function checkFullForm() {
  const dom = makeDom(checkoutMarkup());
  const doc = dom.window.document;
  wireSwitch(doc);

  let linkClicks = 0;
  doc.getElementById("tos-link")?.addEventListener("click", () => {
    linkClicks += 1;
  });
  let submits = 0;
  doc.getElementById("submit")?.addEventListener("click", () => {
    submits += 1;
  });

  const report = await runEngine(dom, { values: FULL_VALUES });

  const expected: Record<string, string> = {
    f_9c1: "Greenleaf Landscape LLC",
    f_9c2: "Company",
    f_9c3: "Savings",
    f_9c4: "000123456789",
    f_9c5: "000123456789",
    f_9c6: "021000021",
  };
  for (const [name, want] of Object.entries(expected)) {
    check(`(a) ${name} holds ${want}`, value(dom, name) === want, `got "${value(dom, name)}"`);
  }

  check(
    "(a) every configured field reports filled",
    report.results.every((result) => result.status === "filled"),
    report.results.map((r) => `${r.key}:${r.status}`).join(" "),
  );
  check(
    "(a) the confirmation box is filled without being asked for twice",
    value(dom, "f_9c5") === value(dom, "f_9c4") && value(dom, "f_9c4") !== "",
  );
  check(
    "(a) the card number above the OR divider is left empty",
    value(dom, "f_2b7") === "",
    `got "${value(dom, "f_2b7")}"`,
  );
  check(
    "(a) autopay switch is turned on",
    doc.getElementById("autopay")?.getAttribute("aria-checked") === "true",
    detailOf(report, "autopay"),
  );
  check(
    "(a) terms checkbox is checked",
    doc.querySelector<HTMLInputElement>("#tos")?.checked === true,
    detailOf(report, "terms"),
  );
  check("(a) the Terms of Use link is never clicked", linkClicks === 0, `${linkClicks} clicks`);
  check("(a) the form is never submitted", submits === 0, `${submits} clicks`);
}

// ——— (b) React-controlled inputs survive the next render ———

/**
 * Mirrors React's DOM bookkeeping: an instance-level `value` property that keeps a tracker in
 * sync, so a plain `el.value = x` assignment looks like "no change" and never reaches state.
 */
function makeControlled(input: HTMLInputElement) {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  const get = descriptor?.get as () => string;
  const set = descriptor?.set as (v: string) => void;

  const state = { committed: "" };
  let tracked = "";

  Object.defineProperty(input, "value", {
    configurable: true,
    enumerable: false,
    get(this: HTMLInputElement) {
      return get.call(this);
    },
    set(this: HTMLInputElement, next: string) {
      tracked = String(next);
      set.call(this, next);
    },
  });
  (input as unknown as { _valueTracker: { getValue(): string; setValue(v: string): void } })._valueTracker = {
    getValue: () => tracked,
    setValue: (v: string) => {
      tracked = String(v);
    },
  };

  input.addEventListener("input", () => {
    const current = get.call(input);
    // React bails out here when the tracker already agrees with the DOM.
    if (current === tracked) return;
    tracked = current;
    state.committed = current;
  });

  // What React does on its next render: force the DOM back to component state.
  return { state, render: () => set.call(input, state.committed) };
}

async function checkControlledInput() {
  const dom = makeDom(group("Account number", '<input type="text" name="ctrl" />'));
  const input = dom.window.document.querySelector<HTMLInputElement>('[name="ctrl"]')!;
  const react = makeControlled(input);

  const report = await runEngine(dom, { values: { accountNumber: "000123456789" } });
  react.render();

  check(
    "(b) a React-controlled input still holds the value after a re-render",
    input.value === "000123456789",
    `committed "${react.state.committed}", dom "${input.value}"`,
  );
  check("(b) the field reports filled", statusOf(report, "accountNumber") === "filled");

  // Proves the assertion above has teeth: the naive assignment loses the value.
  const naiveDom = makeDom(group("Account number", '<input type="text" name="ctrl" />'));
  const naiveInput = naiveDom.window.document.querySelector<HTMLInputElement>('[name="ctrl"]')!;
  const naiveReact = makeControlled(naiveInput);
  naiveInput.value = "000123456789";
  naiveInput.dispatchEvent(new naiveDom.window.Event("input", { bubbles: true }));
  naiveReact.render();
  check(
    "(b) control case: a plain value assignment is discarded on re-render",
    naiveInput.value === "",
    `got "${naiveInput.value}" — the harness would not catch a regression`,
  );
}

// ——— (c) Decoy fields are left alone ———

async function checkDecoys() {
  const dom = makeDom(`
    <form>
      ${group("Search accounts", '<input type="text" name="d1" />')}
      ${group("Policy number", '<input type="text" name="d2" />')}
      ${group("Company name", '<input type="text" name="d3" />')}
      ${group("First name", '<input type="text" name="d4" />')}
      ${group("Last name", '<input type="text" name="d5" />')}
      ${group("Email address", '<input type="email" name="d6" />')}
      ${group("Card number", '<input type="text" name="d7" />')}
      ${group("Confirm password", '<input type="password" name="d8" />')}
      ${group("Invoice number", '<input type="text" name="d9" />')}
    </form>`);

  const report = await runEngine(dom, { values: FULL_VALUES });
  const names = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"];
  const touched = names.filter((name) => value(dom, name) !== "");

  check("(c) no decoy field is written to", touched.length === 0, `touched: ${touched.join(", ")}`);
  check(
    "(c) every field reports not-found rather than claiming success",
    report.results.every((result) => result.status === "not-found"),
    report.results.map((r) => `${r.key}:${r.status}`).join(" "),
  );
}

// ——— (d) Alternate wordings ———

async function checkAlternateWordings() {
  const dom = makeDom(`
    <form>
      ${group("Bank account number", '<input type="text" name="w1" />')}
      ${group("Re-enter account number", '<input type="text" name="w2" />')}
      ${group("ABA routing number", '<input type="text" name="w3" />')}
      ${group("Name on account", '<input type="text" name="w4" />')}
    </form>`);

  await runEngine(dom, { values: FULL_VALUES });

  check("(d) 'Bank account number' matches", value(dom, "w1") === "000123456789", value(dom, "w1"));
  check("(d) 'Re-enter account number' matches", value(dom, "w2") === "000123456789", value(dom, "w2"));
  check("(d) 'ABA routing number' matches", value(dom, "w3") === "021000021", value(dom, "w3"));
  check("(d) 'Name on account' matches", value(dom, "w4") === "Greenleaf Landscape LLC", value(dom, "w4"));
}

/** The confirmation box above the account number must not swap the two. */
async function checkReversedOrder() {
  const dom = makeDom(`
    <form>
      ${group("Confirm account number", '<input type="text" name="r1" />')}
      ${group("Account number", '<input type="text" name="r2" />')}
    </form>`);

  await runEngine(dom, { values: { accountNumber: "000123456789" } });
  check(
    "(d) confirm/account are matched by label, not by document order",
    value(dom, "r1") === "000123456789" && value(dom, "r2") === "000123456789",
    `confirm "${value(dom, "r1")}", account "${value(dom, "r2")}"`,
  );
}

// ——— (e) Custom dropdowns ———

async function checkCustomDropdown() {
  const dom = makeDom(`
    <div class="fld">
      <div class="lbl">Account holder type</div>
      <div id="trigger" role="combobox" aria-expanded="false" tabindex="0">Individual</div>
      <div id="menu"></div>
    </div>`);
  const doc = dom.window.document;

  // A menu library: options only exist in the DOM once the trigger is opened.
  doc.getElementById("trigger")?.addEventListener("click", () => {
    const menu = doc.getElementById("menu")!;
    if (menu.childElementCount > 0) return;
    menu.innerHTML = `
      <div role="listbox">
        <div role="option">Individual</div>
        <div role="option">Company</div>
      </div>`;
    for (const option of Array.from(menu.querySelectorAll("[role='option']"))) {
      option.addEventListener("click", () => {
        doc.getElementById("trigger")!.textContent = option.textContent;
        menu.innerHTML = "";
      });
    }
  });

  const report = await runEngine(dom, { values: { accountHolderType: "Company" } });
  check(
    "(e) a custom dropdown is opened and the option is picked",
    doc.getElementById("trigger")?.textContent === "Company",
    detailOf(report, "accountHolderType"),
  );
}

// ——— (f) Idempotence and skipping ———

async function checkAlreadyCorrect() {
  const dom = makeDom(checkoutMarkup());
  wireSwitch(dom.window.document);
  await runEngine(dom, { values: FULL_VALUES });
  const second = await runEngine(dom, { values: FULL_VALUES });

  check(
    "(f) a second run reports every field already set",
    second.results.every((result) => result.status === "already"),
    second.results.map((r) => `${r.key}:${r.status}`).join(" "),
  );
  check(
    "(f) values are unchanged by the second run",
    value(dom, "f_9c4") === "000123456789" && value(dom, "f_9c6") === "021000021",
  );
}

async function checkSkippedFields() {
  const dom = makeDom(checkoutMarkup());
  const doc = dom.window.document;
  wireSwitch(doc);

  const report = await runEngine(dom, {
    values: { ...FULL_VALUES, autopay: null, terms: null },
  });

  check(
    "(f) fields set to Skip are not reported at all",
    !report.results.some((result) => result.key === "autopay" || result.key === "terms"),
  );
  check(
    "(f) a skipped toggle is left exactly as the page had it",
    doc.getElementById("autopay")?.getAttribute("aria-checked") === "false" &&
      doc.querySelector<HTMLInputElement>("#tos")?.checked === false,
  );
}

/** Turning autopay off when the page already has it on, as in the screenshot. */
async function checkToggleOff() {
  const dom = makeDom(checkoutMarkup());
  const doc = dom.window.document;
  doc.getElementById("autopay")?.setAttribute("aria-checked", "true");
  wireSwitch(doc);

  const report = await runEngine(dom, { values: { autopay: false } });
  check(
    "(f) autopay can be turned off from its default on state",
    doc.getElementById("autopay")?.getAttribute("aria-checked") === "false",
    detailOf(report, "autopay"),
  );
}

// ——— (g) Custom fields ———

async function checkCustomFields() {
  const dom = makeDom(`
    <form>
      ${group("Business name", '<input type="text" name="c1" />')}
      ${group("Billing email", '<input type="text" name="c2" />')}
    </form>`);

  await runEngine(dom, {
    values: {},
    customFields: [
      { match: "Business name", value: "Greenleaf Landscape LLC" },
      { match: "Billing email", value: "ap@greenleaf.example" },
    ],
  });

  check("(g) custom field by label fills", value(dom, "c1") === "Greenleaf Landscape LLC", value(dom, "c1"));
  check("(g) second custom field fills", value(dom, "c2") === "ap@greenleaf.example", value(dom, "c2"));
}

// ——— (h) Honest reporting ———

/** A field the page reformats as you type still counts as filled. */
async function checkFormattedInput() {
  const dom = makeDom(group("Account number", '<input type="text" name="fmt" />'));
  const input = dom.window.document.querySelector<HTMLInputElement>('[name="fmt"]')!;
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D+/g, "");
    const grouped = digits.replace(/(.{4})(?=.)/g, "$1 ");
    if (grouped !== input.value) input.value = grouped;
  });

  const report = await runEngine(dom, { values: { accountNumber: "000123456789" } });
  check(
    "(h) a self-formatting field is accepted on its digits",
    statusOf(report, "accountNumber") === "filled" && input.value === "0001 2345 6789",
    `${detailOf(report, "accountNumber")}, value "${input.value}"`,
  );
}

/** A field that refuses every write must be reported, not silently counted as done. */
async function checkRejectedInput() {
  const dom = makeDom(group("Routing number", '<input type="text" name="nope" />'));
  const input = dom.window.document.querySelector<HTMLInputElement>('[name="nope"]')!;
  input.addEventListener("input", () => {
    if (input.value !== "") input.value = "";
  });

  const report = await runEngine(dom, { values: { routingNumber: "021000021" } });
  check(
    "(h) a field that rejects the value reports failed",
    statusOf(report, "routingNumber") === "failed",
    detailOf(report, "routingNumber"),
  );
}

async function checkDisabledField() {
  const dom = makeDom(group("Routing number", '<input type="text" name="dis" disabled />'));
  const report = await runEngine(dom, { values: { routingNumber: "021000021" } });
  check(
    "(h) a disabled field is reported as blocked",
    statusOf(report, "routingNumber") === "blocked",
    detailOf(report, "routingNumber"),
  );
}

// ——— (i) The popup and the engine agree on field keys ———

function checkKeyContract(dom: JSDOM) {
  const win = dom.window as unknown as EngineWindow;
  win.eval(ENGINE_SOURCE);
  const specs = win.__harperAutofill._internals.SPECS;
  const specKeys = new Set(specs.map((spec) => spec.key));
  const uiKeys = PROFILE_FIELDS.map((field) => field.key);

  const missing = uiKeys.filter((key) => !specKeys.has(key));
  check("(i) every editable field has an engine spec", missing.length === 0, missing.join(", "));

  const confirm = specs.find((spec) => spec.key === "confirmAccountNumber");
  check(
    "(i) the confirmation box mirrors the account number",
    confirm?.mirrors === "accountNumber",
    `mirrors: ${confirm?.mirrors ?? "none"}`,
  );

  const unbacked = specs.filter(
    (spec) => !spec.mirrors && !uiKeys.includes(spec.key as (typeof uiKeys)[number]),
  );
  check(
    "(i) no engine spec is unreachable from the popup",
    unbacked.length === 0,
    unbacked.map((spec) => spec.key).join(", "),
  );
}

// ——— (j) Manifest ———

function checkManifest() {
  const root = new URL("../extension/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")) as {
    manifest_version: number;
    permissions: string[];
    host_permissions?: string[];
    background: { service_worker: string; type: string };
    action: { default_popup: string; default_icon: Record<string, string> };
    icons: Record<string, string>;
    commands: Record<string, unknown>;
  };

  check("(j) manifest is v3", manifest.manifest_version === 3, String(manifest.manifest_version));
  check(
    "(j) permissions stay minimal",
    [...manifest.permissions].sort().join(",") === "activeTab,scripting,storage",
    manifest.permissions.join(","),
  );
  check(
    "(j) no standing access to any site is requested",
    manifest.host_permissions === undefined,
    JSON.stringify(manifest.host_permissions),
  );
  check("(j) the service worker is an ES module", manifest.background.type === "module");

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
    // The engine is not in the manifest; it is injected by path at fill time.
    "src/inject/fill-engine.js",
    "src/popup/popup.css",
    "src/popup/popup.js",
    "src/lib/fields.js",
    "src/lib/storage.js",
    "src/lib/fill-runner.js",
  ];
  const missing = referenced.filter((path) => {
    try {
      readFileSync(new URL(path, root));
      return false;
    } catch {
      return true;
    }
  });
  check("(j) every referenced file exists", missing.length === 0, missing.join(", "));
  check("(j) a keyboard shortcut is registered", Boolean(manifest.commands["fill-now"]));
}

// ——— (k) Profile readiness and reporting ———

function checkProfilePlumbing() {
  const fresh = newProfile();
  check(
    "(k) a brand-new profile is not offered as ready to fill",
    isReady(fresh) === false,
    `readyCount ${readyCount(fresh)}`,
  );
  check(
    "(k) the dropdown defaults alone do not make a profile ready",
    emptyValues().accountType === "Checking" && isReady({ ...fresh, values: emptyValues() }) === false,
  );

  const filled = newProfile();
  filled.values = { ...emptyValues(), accountNumber: "000123456789", routingNumber: "021000021" };
  check("(k) entering an account number makes it ready", isReady(filled) === true);
  check(
    "(k) the count includes the confirmation box the popup never asks for",
    readyCount(filled) === 5,
    String(readyCount(filled)),
  );

  const custom = {
    ...newProfile(),
    customFields: [{ match: "Business name", value: "Greenleaf", kind: "text" }],
  };
  check("(k) a custom field alone makes it ready", isReady(custom) === true);

  check(
    "(k) the summary line reads as a sentence",
    headline({
      ok: true,
      summary: { filled: 7, already: 1, notFound: 0, problem: 0 },
    }) === "Filled 7 fields · 1 already correct.",
    headline({ ok: true, summary: { filled: 7, already: 1, notFound: 0, problem: 0 } }),
  );
  check(
    "(k) a page with nothing to fill says so",
    headline({ ok: true, summary: { filled: 0, already: 0, notFound: 3, problem: 0 } }) ===
      "No matching fields on this page.",
  );
  check(
    "(k) a failed run surfaces its reason",
    headline({ ok: false, error: "Chrome does not allow extensions to run here." }) ===
      "Chrome does not allow extensions to run here.",
  );
}

// ——— Run ———

async function main() {
  await checkFullForm();
  await checkControlledInput();
  await checkDecoys();
  await checkAlternateWordings();
  await checkReversedOrder();
  await checkCustomDropdown();
  await checkAlreadyCorrect();
  await checkSkippedFields();
  await checkToggleOff();
  await checkCustomFields();
  await checkFormattedInput();
  await checkRejectedInput();
  await checkDisabledField();
  checkKeyContract(makeDom("<div></div>"));
  checkManifest();
  checkProfilePlumbing();

  console.log("---");
  if (failures === 0) {
    console.log("Autofill engine green.");
  } else {
    console.log(`${failures} check(s) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
