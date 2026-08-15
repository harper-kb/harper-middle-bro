/**
 * Fill engine — injected into the page as a classic script by src/lib/fill-runner.js.
 *
 * Injected once per frame; re-injection with the same VERSION is a no-op. Exposes
 * globalThis.__harperAutofill.run(payload) which resolves to a FrameReport.
 *
 * Two things make checkout forms hostile to scripted filling, and both are handled here:
 *
 *   1. React (and Vue/Svelte) install their own `value` setter on the input instance and
 *      cache the last value in a tracker. Assigning `el.value = x` updates the DOM but the
 *      framework never learns about it, so the field blanks on the next render and submits
 *      empty. setNativeValue() writes through the *prototype* setter and desyncs the tracker
 *      so the framework's onChange sees a real change.
 *   2. Field identity lives in visual labels, not in `name`/`id`, which are usually hashed
 *      build output. Matching is therefore label-driven with required/rejected keywords, so
 *      "Account number" and "Confirm account number" can never be confused for each other.
 */
(function () {
  "use strict";

  const VERSION = 3;
  if (globalThis.__harperAutofill && globalThis.__harperAutofill.version === VERSION) return;

  /** A control must out-score this to be filled. Tuned so a partial keyword overlap loses. */
  const MATCH_THRESHOLD = 55;
  const MAX_LABEL_CHARS = 200;
  const MAX_SCANNED_NODES = 25000;

  // ——— Field specifications ———
  //
  // require: array of OR-groups, ALL of which must be satisfied (AND of ORs).
  // reject:  any hit disqualifies the control outright.
  // phrases: longest-wins scoring; an exact label match is the strongest possible signal.
  // tokens:  weak fallback used only when no phrase matched at all.

  const SPECS = [
    {
      key: "accountHolderName",
      label: "Name of account holder",
      kind: "text",
      order: 10,
      require: [["name", "holder"]],
      reject: [
        "type", "kind", "confirm", "routing", "email", "phone", "address", "city",
        "state", "zip", "postal", "first", "last", "middle", "search", "coupon", "promo",
        "user", "username", "company name", "business name",
      ],
      phrases: [
        "name of account holder", "account holder name", "accountholder name",
        "name on account", "bank account holder", "account holder", "holder name",
        "name on bank account", "full name", "legal name",
      ],
      tokens: ["account", "holder"],
      autocomplete: ["name", "cc-name"],
    },
    {
      key: "accountHolderType",
      label: "Account holder type",
      kind: "select",
      order: 20,
      require: [["holder", "owner", "entity", "ownership"], ["type", "kind"]],
      reject: ["card"],
      phrases: [
        "account holder type", "accountholder type", "holder type",
        "account owner type", "ownership type", "entity type", "type of account holder",
      ],
      tokens: ["holder", "type"],
    },
    {
      key: "accountType",
      label: "Account type",
      kind: "select",
      order: 30,
      require: [["account", "bank"], ["type", "kind"]],
      reject: ["holder", "owner", "entity", "ownership", "card", "payment"],
      phrases: ["account type", "bank account type", "type of account", "checking or savings"],
      tokens: ["account", "type"],
    },
    {
      key: "accountNumber",
      label: "Account number",
      kind: "text",
      numeric: true,
      order: 40,
      require: [["account"], ["number", "no", "num", "#"]],
      reject: [
        "confirm", "confirmation", "re enter", "reenter", "verify", "repeat", "retype",
        "again", "routing", "aba", "transit", "holder", "type", "card", "policy", "invoice",
      ],
      phrases: [
        "account number", "bank account number", "account no", "account num", "account #",
        "checking account number", "savings account number", "dda number",
      ],
      tokens: ["account", "number"],
    },
    {
      key: "confirmAccountNumber",
      label: "Confirm account number",
      kind: "text",
      numeric: true,
      order: 50,
      // Filled from accountNumber; the popup never asks for it twice.
      mirrors: "accountNumber",
      require: [
        ["account"],
        ["number", "no", "num", "#"],
        ["confirm", "confirmation", "re enter", "reenter", "verify", "repeat", "retype", "again"],
      ],
      reject: ["routing", "aba", "transit", "holder", "type", "card"],
      phrases: [
        "confirm account number", "confirm bank account number", "re enter account number",
        "reenter account number", "verify account number", "repeat account number",
        "retype account number", "account number again", "confirm account",
      ],
      tokens: ["confirm", "account"],
    },
    {
      key: "routingNumber",
      label: "Routing number",
      kind: "text",
      numeric: true,
      order: 60,
      require: [["routing", "aba", "transit", "rtn"]],
      reject: ["confirm", "re enter", "reenter", "verify", "swift", "iban", "bic"],
      phrases: [
        "routing number", "aba routing number", "bank routing number",
        "routing transit number", "aba number", "transit number", "routing",
      ],
      tokens: ["routing"],
    },
    {
      key: "autopay",
      label: "Autopay",
      kind: "toggle",
      order: 70,
      require: [["autopay", "auto pay", "automatic", "automatically", "recurring", "subsequent"]],
      reject: ["terms", "conditions"],
      phrases: [
        "autopay", "auto pay", "automatic payments", "make subsequent payments automatic",
        "recurring payments", "enroll in autopay", "pay automatically", "automatic",
      ],
      tokens: ["auto"],
    },
    {
      key: "terms",
      label: "Terms of Use",
      kind: "checkbox",
      order: 80,
      require: [["terms", "agree", "conditions", "consent", "authorize", "authorization"]],
      reject: ["autopay", "auto pay", "subsequent"],
      phrases: [
        "terms of use", "terms and conditions", "terms of service", "i agree",
        "i confirm that i have read and agree", "read and agree", "agree with the terms",
        "accept the terms", "i authorize", "terms",
      ],
      tokens: ["terms"],
    },
  ];

  /** Alternate wordings a site may use for a select option we were asked to pick. */
  const OPTION_SYNONYMS = {
    accountHolderType: {
      individual: ["individual", "personal", "person", "consumer", "sole proprietor", "sole proprietorship"],
      company: ["company", "business", "corporate", "commercial", "entity", "organization", "corporation", "llc"],
    },
    accountType: {
      checking: ["checking", "chequing", "current", "checking account", "dda"],
      savings: ["savings", "saving", "savings account"],
    },
  };

  /**
   * How well a control kind can serve a spec kind. `null` means never — this is what stops
   * a routing number from being typed into the terms checkbox.
   */
  const KIND_FIT = {
    text: { text: 6, select: -20, checkbox: null, switch: null, radio: null },
    select: { select: 8, text: -10, checkbox: null, switch: null, radio: null },
    toggle: { switch: 10, checkbox: 6, text: null, select: null, radio: null },
    checkbox: { checkbox: 10, switch: 6, text: null, select: null, radio: null },
  };

  // ——— Text normalisation ———

  /** Lowercase, split camelCase, and reduce punctuation to single spaces. */
  function norm(raw) {
    if (raw == null) return "";
    return String(raw)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_\-./\\]+/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9# ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const tokenRegexCache = new Map();

  /**
   * Whole-word containment. Substring matching would let "no" hit "none" and "type" hit
   * "typed", which is how naive fillers put a routing number in the wrong box.
   */
  function hasToken(text, token) {
    if (!text || !token) return false;
    if (token.includes(" ") || token.includes("#")) return text.includes(token);
    let re = tokenRegexCache.get(token);
    if (!re) {
      re = new RegExp(`(^| )${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
      tokenRegexCache.set(token, re);
    }
    return re.test(text);
  }

  function digitsOnly(value) {
    return String(value == null ? "" : value).replace(/\D+/g, "");
  }

  // ——— Scoring ———

  function scoreText(text, spec) {
    if (!text) return 0;
    if (spec.reject && spec.reject.some((token) => hasToken(text, token))) return 0;
    if (spec.require && !spec.require.every((group) => group.some((token) => hasToken(text, token)))) {
      return 0;
    }

    let best = 0;
    for (const phrase of spec.phrases) {
      if (text === phrase) {
        best = Math.max(best, 100);
      } else if (text.includes(phrase)) {
        // Longer phrases are more specific, so they earn a little more confidence.
        best = Math.max(best, 72 + Math.min(18, phrase.length / 2));
      } else if (text.length >= 4 && phrase.includes(text)) {
        best = Math.max(best, 62);
      }
    }
    if (best === 0 && spec.tokens && spec.tokens.every((token) => hasToken(text, token))) {
      best = 58;
    }
    return best;
  }

  function scoreControl(spec, control) {
    const fit = KIND_FIT[spec.kind][control.kind];
    if (fit == null) return 0;

    let best = 0;
    for (const source of control.sources) {
      const score = scoreText(source.text, spec) * source.weight;
      if (score > best) best = score;
    }
    if (best === 0) return 0;

    let total = best + fit;
    if (spec.autocomplete && control.autocomplete && spec.autocomplete.includes(control.autocomplete)) {
      total += 6;
    }
    return total;
  }

  // ——— Control discovery ———

  const CONTROL_SELECTOR =
    "input,select,textarea,[role='switch'],[role='checkbox'],[role='combobox']," +
    "[contenteditable='true'],[aria-haspopup='listbox']";

  const ANY_CONTROL_SELECTOR = `${CONTROL_SELECTOR},button,a[role='button']`;

  const SKIPPED_INPUT_TYPES = new Set([
    "hidden", "submit", "button", "image", "reset", "file", "range", "color",
  ]);

  function controlKind(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "select") return "select";
    if (role === "switch") return "switch";
    if (role === "checkbox") return "checkbox";
    if (role === "radio") return "radio";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return role === "combobox" ? "select" : "text";
    }
    if (role === "combobox" || el.getAttribute("aria-haspopup") === "listbox") return "select";
    if (tag === "textarea") return "text";
    if (el.isContentEditable) return "text";
    return "text";
  }

  function isRendered(el) {
    if (el.hidden) return false;
    // checkVisibility walks the ancestor chain for display:none / visibility:hidden.
    // Opacity is deliberately ignored: real checkboxes are routinely opacity:0 behind a
    // styled span, and those still need to be clicked.
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  /** Text of a node, ignoring nodes that are themselves controls. */
  function textOf(node) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    return text && text.length <= MAX_LABEL_CHARS ? text : "";
  }

  function containsControl(node) {
    if (typeof node.matches !== "function") return false;
    return node.matches(ANY_CONTROL_SELECTOR) || !!node.querySelector(ANY_CONTROL_SELECTOR);
  }

  function parentOf(node) {
    return node.parentElement || (node.parentNode && node.parentNode.host) || null;
  }

  /**
   * Labels in modern checkout markup are frequently plain <div>s stacked above the input
   * rather than real <label for>. Walk outward looking for the closest sibling text, and
   * stop the moment another control is in the way so we cannot steal a neighbour's label.
   */
  function siblingLabel(el, forward) {
    const direction = forward ? "nextElementSibling" : "previousElementSibling";
    let node = el;
    for (let depth = 0; node && depth < 4; depth += 1, node = parentOf(node)) {
      for (let sibling = node[direction]; sibling; sibling = sibling[direction]) {
        if (containsControl(sibling)) return null;
        const text = textOf(sibling);
        if (text) return text;
      }
    }
    return null;
  }

  function labelSources(el) {
    const sources = [];
    const add = (raw, weight) => {
      const text = norm(raw);
      if (text && text.length <= MAX_LABEL_CHARS) sources.push({ text, weight });
    };
    const root = el.getRootNode();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy && typeof root.getElementById === "function") {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => root.getElementById(id))
        .filter(Boolean)
        .map((node) => node.textContent || "");
      if (parts.length) add(parts.join(" "), 1);
    }
    add(el.getAttribute("aria-label"), 1);

    if (el.id && typeof root.querySelectorAll === "function") {
      const selector = `label[for="${globalThis.CSS && CSS.escape ? CSS.escape(el.id) : el.id}"]`;
      let labels = [];
      try {
        labels = root.querySelectorAll(selector);
      } catch {
        labels = [];
      }
      for (const label of labels) add(textOf(label), 1);
    }

    const wrapper = typeof el.closest === "function" ? el.closest("label") : null;
    if (wrapper) add(textOf(wrapper), 0.98);

    const before = siblingLabel(el, false);
    if (before) add(before, 0.96);

    const kind = controlKind(el);
    if (kind === "checkbox" || kind === "switch" || kind === "radio") {
      // A checkbox's label sits to its right, not above it.
      const after = siblingLabel(el, true);
      if (after) add(after, 0.94);
    }

    add(el.getAttribute("placeholder"), 0.9);
    add(el.getAttribute("title"), 0.88);
    add(el.getAttribute("name"), 0.86);
    add(el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-qa"), 0.86);
    add(el.getAttribute("id"), 0.84);

    return sources;
  }

  function collectControls(root, out, seen, budget) {
    if (typeof root.querySelectorAll !== "function") return out;

    for (const el of root.querySelectorAll(CONTROL_SELECTOR)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.tagName === "INPUT" && SKIPPED_INPUT_TYPES.has((el.getAttribute("type") || "text").toLowerCase())) {
        continue;
      }
      if (!isRendered(el)) continue;
      out.push({
        el,
        index: out.length,
        kind: controlKind(el),
        sources: labelSources(el),
        autocomplete: norm(el.getAttribute("autocomplete")) || null,
      });
    }

    // Open shadow roots host their own controls; closed roots are unreachable by design.
    for (const el of root.querySelectorAll("*")) {
      if (budget.count++ > MAX_SCANNED_NODES) break;
      if (el.shadowRoot) collectControls(el.shadowRoot, out, seen, budget);
    }
    return out;
  }

  // ——— Value writing ———

  /**
   * Write through the prototype setter so framework-installed instance setters are bypassed,
   * then desync React's value tracker so the following `input` event is seen as a real change.
   */
  function setNativeValue(el, value) {
    const previous = el.value;
    const prototype = Object.getPrototypeOf(el);
    const prototypeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const ownSetter = Object.getOwnPropertyDescriptor(el, "value")?.set;

    if (prototypeSetter && ownSetter !== prototypeSetter) {
      prototypeSetter.call(el, value);
    } else if (ownSetter) {
      ownSetter.call(el, value);
    } else {
      el.value = value;
    }

    const tracker = el._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(String(previous ?? ""));
  }

  function fire(el, type, init) {
    el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
  }

  function fireInput(el, value) {
    let event;
    try {
      event = new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: value == null ? null : String(value),
      });
    } catch {
      event = new Event("input", { bubbles: true, composed: true });
    }
    el.dispatchEvent(event);
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function valueMatches(actual, expected, spec) {
    if (spec && spec.numeric) return digitsOnly(actual) === digitsOnly(expected);
    return norm(actual) === norm(expected);
  }

  /** Character-by-character fallback for inputs driven by keystroke-level masking libraries. */
  function typeInto(el, value) {
    setNativeValue(el, "");
    fireInput(el, "");
    for (const char of String(value)) {
      const init = { key: char, bubbles: true, composed: true };
      el.dispatchEvent(new KeyboardEvent("keydown", init));
      setNativeValue(el, `${el.value}${char}`);
      fireInput(el, char);
      el.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    fire(el, "change");
  }

  async function applyText(el, value, spec) {
    if (el.disabled) return { status: "blocked", detail: "field is disabled" };
    if (el.readOnly) return { status: "blocked", detail: "field is read-only" };
    if (valueMatches(el.value, value, spec)) return { status: "already", detail: "already correct" };

    if (typeof el.focus === "function") el.focus({ preventScroll: true });

    if (el.value) {
      setNativeValue(el, "");
      fireInput(el, "");
    }
    setNativeValue(el, value);
    fireInput(el, value);
    fire(el, "change");

    await pause(0);

    if (!valueMatches(el.value, value, spec)) {
      typeInto(el, value);
      await pause(0);
    }
    if (typeof el.blur === "function") el.blur();

    return valueMatches(el.value, value, spec)
      ? { status: "filled" }
      : { status: "failed", detail: "the page rejected the value" };
  }

  // ——— Select handling ———

  function optionCandidates(value, specKey) {
    const wanted = norm(value);
    const group = OPTION_SYNONYMS[specKey];
    if (group) {
      for (const synonyms of Object.values(group)) {
        if (synonyms.some((synonym) => norm(synonym) === wanted)) {
          return Array.from(new Set([wanted, ...synonyms.map(norm)]));
        }
      }
    }
    return [wanted];
  }

  function pickOption(items, candidates) {
    for (const candidate of candidates) {
      const exact = items.find((item) => item.text === candidate || item.value === candidate);
      if (exact) return exact;
    }
    for (const candidate of candidates) {
      const startsWith = items.find((item) => item.text.startsWith(candidate));
      if (startsWith) return startsWith;
    }
    for (const candidate of candidates) {
      const contains = items.find((item) => item.text.includes(candidate) || item.value.includes(candidate));
      if (contains) return contains;
    }
    return null;
  }

  async function applyNativeSelect(el, value, specKey) {
    if (el.disabled) return { status: "blocked", detail: "field is disabled" };

    const candidates = optionCandidates(value, specKey);
    const items = Array.from(el.options).map((option) => ({
      option,
      text: norm(option.textContent),
      value: norm(option.value),
    }));
    const match = pickOption(items, candidates);
    if (!match) {
      const available = items.map((item) => item.option.textContent.trim()).filter(Boolean).join(", ");
      return { status: "failed", detail: `no option matching "${value}"${available ? ` (has: ${available})` : ""}` };
    }
    if (el.value === match.option.value) return { status: "already", detail: "already correct" };

    setNativeValue(el, match.option.value);
    fireInput(el, match.option.value);
    fire(el, "change");
    await pause(0);

    return el.value === match.option.value
      ? { status: "filled" }
      : { status: "failed", detail: "the page reverted the selection" };
  }

  function pointerClick(el) {
    const init = { bubbles: true, composed: true, cancelable: true, view: el.ownerDocument.defaultView };
    // Menu libraries variously open on pointerdown, mousedown, or click.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try {
        el.dispatchEvent(new PointerEvent(type, init));
      } catch {
        el.dispatchEvent(new MouseEvent(type.replace("pointer", "mouse"), init));
      }
    }
    el.click();
  }

  function currentTriggerText(el) {
    return norm(el.value || el.textContent || "");
  }

  const LIST_ITEM_SELECTOR =
    "[role='option'],[role='listbox'] li,[role='menuitemradio'],[role='menuitem']";

  /**
   * The popup this trigger owns, when it says so. Falls back to the whole document, which is
   * why callers must also discard anything that was on screen before the trigger was clicked.
   */
  function listScope(el) {
    const owned = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    const root = el.getRootNode();
    if (owned && typeof root.getElementById === "function") {
      const node = root.getElementById(owned);
      if (node) return node;
    }
    return el.ownerDocument;
  }

  function listItems(scope) {
    return Array.from(scope.querySelectorAll(LIST_ITEM_SELECTOR))
      .filter((node) => isRendered(node))
      .map((node) => ({
        node,
        text: norm(node.textContent),
        value: norm(node.getAttribute("data-value") || node.getAttribute("value") || ""),
      }));
  }

  function closeList(el) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  }

  /** Custom dropdown: open it, wait for the popup list, click the matching option. */
  async function applyCustomSelect(el, value, specKey) {
    const candidates = optionCandidates(value, specKey);
    if (candidates.some((candidate) => currentTriggerText(el) === candidate)) {
      return { status: "already", detail: "already correct" };
    }

    const scope = listScope(el);
    // Anything already on screen belongs to the page — a site nav is full of [role='menuitem']
    // and one of them could easily read "Company". Only options that appear in response to the
    // click are ours, and clicking a nav item would navigate away from a half-filled form.
    const preexisting = new Set(listItems(scope).map((item) => item.node));

    pointerClick(el);

    let items = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await pause(40);
      items = listItems(scope).filter((item) => !preexisting.has(item.node));
      if (items.length) break;
    }
    if (!items.length) {
      closeList(el);
      return { status: "failed", detail: "the dropdown did not open" };
    }

    const match = pickOption(items, candidates);
    if (!match) {
      closeList(el);
      const available = items.map((item) => item.node.textContent.trim()).filter(Boolean).slice(0, 8).join(", ");
      return { status: "failed", detail: `no option matching "${value}"${available ? ` (has: ${available})` : ""}` };
    }

    pointerClick(match.node);
    await pause(80);

    const shown = currentTriggerText(el);
    if (candidates.some((candidate) => shown === candidate || shown.includes(candidate))) {
      return { status: "filled" };
    }
    closeList(el);
    return { status: "failed", detail: "the dropdown did not take the selection" };
  }

  async function applySelect(el, value, specKey) {
    if (el.tagName === "SELECT") return applyNativeSelect(el, value, specKey);
    return applyCustomSelect(el, value, specKey);
  }

  // ——— Toggles and checkboxes ———

  function checkedState(el) {
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) return el.checked;
    const aria = el.getAttribute("aria-checked");
    if (aria === "true") return true;
    if (aria === "false") return false;
    const state = el.getAttribute("data-state");
    if (state === "checked" || state === "on") return true;
    if (state === "unchecked" || state === "off") return false;
    const pressed = el.getAttribute("aria-pressed");
    if (pressed === "true") return true;
    if (pressed === "false") return false;
    // A styled switch usually wraps a real checkbox that carries the truth.
    const inner = typeof el.querySelector === "function"
      ? el.querySelector("input[type='checkbox'],input[type='radio']")
      : null;
    if (inner) return inner.checked;
    return null;
  }

  async function applyToggle(el, desired) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") {
      return { status: "blocked", detail: "control is disabled" };
    }

    const before = checkedState(el);
    if (before === desired) return { status: "already", detail: desired ? "already on" : "already off" };
    if (before === null) {
      // A click here is a coin flip: it could just as easily turn autopay off, or tick a
      // terms box the run was told to leave alone. Leave it and say so.
      return { status: "blocked", detail: "the page does not report this control's state — set it yourself" };
    }

    // Click the control itself rather than its label: the terms label wraps a "Terms of Use"
    // link, and clicking that would navigate away from a half-filled form.
    if (el.tagName === "INPUT") {
      el.click();
    } else {
      pointerClick(el);
    }
    await pause(30);

    const after = checkedState(el);
    if (after === desired) return { status: "filled" };
    if (after === null) return { status: "filled", detail: "clicked, but the page stopped reporting its state" };
    return { status: "failed", detail: "the control did not change state" };
  }

  // ——— Orchestration ———

  function buildSpecs(payload) {
    const values = payload && payload.values ? payload.values : {};
    const specs = [];

    for (const spec of SPECS) {
      const source = spec.mirrors ? values[spec.mirrors] : values[spec.key];
      if (source == null || source === "") continue;
      specs.push({ ...spec, value: source });
    }

    const custom = (payload && payload.customFields) || [];
    custom.forEach((field, i) => {
      const match = norm(field.match);
      if (!match || field.value == null || field.value === "") return;
      specs.push({
        key: `custom:${i}`,
        label: field.match,
        kind: field.kind === "select" || field.kind === "checkbox" || field.kind === "toggle" ? field.kind : "text",
        order: 100 + i,
        custom: true,
        require: [],
        reject: [],
        phrases: [match],
        tokens: match.split(" "),
        value: field.value,
      });
    });

    return specs.sort((a, b) => a.order - b.order);
  }

  /**
   * Global greedy assignment: every (spec, control) pair is scored, then the strongest pairs
   * claim their control first. A per-spec "best match" loop would let "Account number" grab
   * the confirmation box whenever it happened to be scanned first.
   */
  function assign(specs, controls) {
    const pairs = [];
    for (const spec of specs) {
      for (const control of controls) {
        const score = scoreControl(spec, control);
        if (score >= MATCH_THRESHOLD) pairs.push({ spec, control, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score || a.control.index - b.control.index);

    const bySpec = new Map();
    const usedControls = new Set();
    for (const pair of pairs) {
      if (bySpec.has(pair.spec.key) || usedControls.has(pair.control.el)) continue;
      bySpec.set(pair.spec.key, pair);
      usedControls.add(pair.control.el);
    }
    return bySpec;
  }

  function describeValue(spec) {
    if (spec.kind === "toggle" || spec.kind === "checkbox") return spec.value ? "on" : "off";
    if (spec.numeric && String(spec.value).length > 4) return `••••${String(spec.value).slice(-4)}`;
    return String(spec.value);
  }

  async function run(payload) {
    const startedAt = Date.now();
    const specs = buildSpecs(payload || {});
    const controls = collectControls(document, [], new Set(), { count: 0 });
    const assignments = assign(specs, controls);
    const results = [];

    for (const spec of specs) {
      const pair = assignments.get(spec.key);
      if (!pair) {
        results.push({ key: spec.key, label: spec.label, status: "not-found" });
        continue;
      }

      let outcome;
      try {
        if (spec.kind === "select") {
          outcome = await applySelect(pair.control.el, spec.value, spec.key);
        } else if (spec.kind === "toggle" || spec.kind === "checkbox") {
          outcome = await applyToggle(pair.control.el, Boolean(spec.value));
        } else {
          outcome = await applyText(pair.control.el, String(spec.value), spec);
        }
      } catch (error) {
        outcome = { status: "failed", detail: String((error && error.message) || error) };
      }

      results.push({
        key: spec.key,
        label: spec.label,
        value: describeValue(spec),
        score: Math.round(pair.score),
        ...outcome,
      });

      // Let the framework re-render between fields; some forms reveal or re-validate
      // later fields in response to earlier ones.
      await pause(20);
    }

    return {
      ok: true,
      frameUrl: location.href,
      isTopFrame: window.top === window,
      controlsScanned: controls.length,
      results,
      ms: Date.now() - startedAt,
    };
  }

  globalThis.__harperAutofill = {
    version: VERSION,
    run,
    // Exposed for scripts/autofill-check.ts.
    _internals: { norm, hasToken, scoreText, scoreControl, collectControls, assign, buildSpecs, SPECS, MATCH_THRESHOLD },
  };
})();
