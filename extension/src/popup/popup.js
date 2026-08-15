/**
 * Popup: edit the saved details once, then press one button.
 *
 * Every edit auto-saves, so the profile is always ready and "Fill this page" is genuinely a
 * single click. The fill itself is run by the service worker (see src/background.js) so
 * closing this panel mid-run does not abandon it.
 */

import { PROFILE_FIELDS, isReady, newProfile, readyCount } from "../lib/fields.js";
import { activeProfile, clearState, loadState, saveState } from "../lib/storage.js";

const el = {
  profileSelect: document.getElementById("profile-select"),
  profileNew: document.getElementById("profile-new"),
  profileRename: document.getElementById("profile-rename"),
  profileDelete: document.getElementById("profile-delete"),
  renameRow: document.getElementById("rename-row"),
  renameInput: document.getElementById("rename-input"),
  renameSave: document.getElementById("rename-save"),
  renameCancel: document.getElementById("rename-cancel"),
  fill: document.getElementById("fill"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  fields: document.getElementById("fields"),
  customList: document.getElementById("custom-list"),
  customCount: document.getElementById("custom-count"),
  customAdd: document.getElementById("custom-add"),
  clear: document.getElementById("clear"),
  shortcutHint: document.getElementById("shortcut-hint"),
};

let state;
let saveTimer;

function profile() {
  return activeProfile(state);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 250);
}

function setStatus(text, tone) {
  el.status.textContent = text || "";
  el.status.className = `status${tone ? ` ${tone}` : ""}`;
}

// ——— Profiles ———

function renderProfiles() {
  el.profileSelect.replaceChildren(
    ...state.profiles.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      option.selected = item.id === state.activeProfileId;
      return option;
    }),
  );
  el.profileDelete.disabled = state.profiles.length < 2;
}

// ——— Field rows ———

function labelFor(field) {
  const span = document.createElement("span");
  span.className = "label";
  span.textContent = field.label;
  return span;
}

function hintFor(text, warn) {
  const p = document.createElement("p");
  p.className = `hint${warn ? " warn" : ""}`;
  p.textContent = text;
  return p;
}

function isValidAba(routing) {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function buildTextRow(field) {
  const row = document.createElement("div");
  row.className = "field";
  row.append(labelFor(field));

  const input = document.createElement("input");
  input.type = field.control === "secret" ? "password" : "text";
  input.value = profile().values[field.key] ?? "";
  input.placeholder = field.placeholder || "";
  input.autocomplete = "off";
  input.spellcheck = false;
  if (field.numeric) input.inputMode = "numeric";
  if (field.maxLength) input.maxLength = field.maxLength;

  const checksumHint = field.key === "routingNumber" ? hintFor("", true) : null;
  const refreshChecksum = () => {
    if (!checksumHint) return;
    const value = input.value;
    const bad = value.length === 9 && !isValidAba(value);
    checksumHint.textContent = bad ? "That is not a valid ABA routing number — check the digits." : "";
    checksumHint.hidden = !bad;
  };

  input.addEventListener("input", () => {
    let value = input.value;
    if (field.numeric) {
      const cleaned = value.replace(/\D+/g, "");
      if (cleaned !== value) {
        value = cleaned;
        input.value = cleaned;
      }
    }
    profile().values[field.key] = value;
    refreshChecksum();
    updateFillButton();
    scheduleSave();
  });

  if (field.control === "secret") {
    const wrap = document.createElement("div");
    wrap.className = "secret";
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "chip";
    reveal.textContent = "Show";
    reveal.addEventListener("click", () => {
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      reveal.textContent = hidden ? "Hide" : "Show";
    });
    wrap.append(input, reveal);
    row.append(wrap);
  } else {
    row.append(input);
  }

  if (field.hint) row.append(hintFor(field.hint));
  if (checksumHint) {
    checksumHint.hidden = true;
    row.append(checksumHint);
    refreshChecksum();
  }
  return row;
}

function buildChoiceRow(field) {
  const row = document.createElement("div");
  row.className = "field";
  row.append(labelFor(field));

  const select = document.createElement("select");
  for (const option of field.options) {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option;
    node.selected = profile().values[field.key] === option;
    select.append(node);
  }
  select.addEventListener("change", () => {
    profile().values[field.key] = select.value;
    updateFillButton();
    scheduleSave();
  });

  row.append(select);
  if (field.hint) row.append(hintFor(field.hint));
  return row;
}

function buildTristateRow(field) {
  const row = document.createElement("div");
  row.className = "field";
  row.append(labelFor(field));

  const group = document.createElement("div");
  group.className = "segments";
  const options = [
    { value: true, text: field.onLabel || "On" },
    { value: false, text: field.offLabel || "Off" },
    { value: null, text: "Skip" },
  ];

  const buttons = options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.text;
    button.setAttribute("aria-pressed", String(profile().values[field.key] === option.value));
    button.addEventListener("click", () => {
      profile().values[field.key] = option.value;
      for (const [i, other] of buttons.entries()) {
        other.setAttribute("aria-pressed", String(options[i].value === option.value));
      }
      updateFillButton();
      scheduleSave();
    });
    return button;
  });

  group.append(...buttons);
  row.append(group);
  if (field.hint) row.append(hintFor(field.hint));
  return row;
}

function renderFields() {
  el.fields.replaceChildren(
    ...PROFILE_FIELDS.map((field) => {
      if (field.control === "choice") return buildChoiceRow(field);
      if (field.control === "tristate") return buildTristateRow(field);
      return buildTextRow(field);
    }),
  );
}

// ——— Custom fields ———

function renderCustom() {
  const custom = profile().customFields;
  el.customCount.textContent = custom.length ? `(${custom.length})` : "";

  el.customList.replaceChildren(
    ...custom.map((field, index) => {
      const row = document.createElement("div");
      row.className = "custom-row";

      const match = document.createElement("input");
      match.type = "text";
      match.placeholder = "Label on the page";
      match.value = field.match;
      match.addEventListener("input", () => {
        custom[index].match = match.value;
        updateFillButton();
        scheduleSave();
      });

      const value = document.createElement("input");
      value.type = "text";
      value.placeholder = "Value";
      value.value = field.value;
      value.addEventListener("input", () => {
        custom[index].value = value.value;
        updateFillButton();
        scheduleSave();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = "Remove this field";
      remove.addEventListener("click", () => {
        custom.splice(index, 1);
        renderCustom();
        updateFillButton();
        scheduleSave();
      });

      row.append(match, value, remove);
      return row;
    }),
  );
}

// ——— Fill ———

function updateFillButton() {
  const ready = isReady(profile());
  el.fill.disabled = !ready;
  el.fill.textContent = ready ? `Fill this page (${readyCount(profile())})` : "Add details below to start";
}

function renderResults(results) {
  el.results.replaceChildren(
    ...results.map((result) => {
      const item = document.createElement("li");

      const left = document.createElement("div");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = result.label;
      left.append(name);
      if (result.detail) {
        const detail = document.createElement("span");
        detail.className = "detail";
        detail.textContent = result.detail;
        left.append(detail);
      }

      const tag = document.createElement("span");
      tag.className = `tag ${result.status}`;
      tag.textContent = { filled: "filled", already: "already set", "not-found": "not found" }[
        result.status
      ] || result.status;

      item.append(left, tag);
      return item;
    }),
  );
}

async function doFill() {
  el.fill.classList.add("busy");
  el.fill.disabled = true;
  setStatus("Filling…");
  el.results.replaceChildren();

  try {
    await saveState(state);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== "number") {
      setStatus("No page is open in this window.", "bad");
      return;
    }

    const report = await chrome.runtime.sendMessage({ type: "fill", tabId: tab.id });
    if (!report || !report.ok) {
      setStatus((report && report.error) || "The fill could not be started.", "bad");
      return;
    }

    renderResults(report.results);
    const good = report.summary.filled > 0 || report.summary.already > 0;
    setStatus(report.headline, good ? "good" : "bad");
  } catch (error) {
    setStatus(String((error && error.message) || error), "bad");
  } finally {
    el.fill.classList.remove("busy");
    updateFillButton();
  }
}

// ——— Wiring ———

/** Two-step destructive buttons; extension popups close themselves on confirm() dialogs. */
function armConfirm(button, armedText, action) {
  const original = button.textContent;
  let armed = false;
  let timer;
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.textContent = armedText;
      timer = setTimeout(() => {
        armed = false;
        button.textContent = original;
      }, 3000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = original;
    action();
  });
}

function showRename(show) {
  el.renameRow.hidden = !show;
  if (show) {
    el.renameInput.value = profile().name;
    el.renameInput.focus();
    el.renameInput.select();
  }
}

function rerenderAll() {
  renderProfiles();
  renderFields();
  renderCustom();
  updateFillButton();
}

function wire() {
  el.fill.addEventListener("click", doFill);

  el.profileSelect.addEventListener("change", () => {
    state.activeProfileId = el.profileSelect.value;
    showRename(false);
    rerenderAll();
    setStatus("");
    el.results.replaceChildren();
    scheduleSave();
  });

  el.profileNew.addEventListener("click", () => {
    const created = newProfile(`Profile ${state.profiles.length + 1}`);
    state.profiles.push(created);
    state.activeProfileId = created.id;
    rerenderAll();
    showRename(true);
    scheduleSave();
  });

  el.profileRename.addEventListener("click", () => showRename(el.renameRow.hidden));
  el.renameCancel.addEventListener("click", () => showRename(false));
  el.renameSave.addEventListener("click", () => {
    const name = el.renameInput.value.trim();
    if (name) profile().name = name;
    showRename(false);
    renderProfiles();
    scheduleSave();
  });
  el.renameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") el.renameSave.click();
    if (event.key === "Escape") showRename(false);
  });

  armConfirm(el.profileDelete, "Tap to confirm", () => {
    state.profiles = state.profiles.filter((item) => item.id !== state.activeProfileId);
    if (state.profiles.length === 0) state.profiles.push(newProfile());
    state.activeProfileId = state.profiles[0].id;
    rerenderAll();
    scheduleSave();
  });

  el.customAdd.addEventListener("click", () => {
    profile().customFields.push({ match: "", value: "", kind: "text" });
    renderCustom();
  });

  armConfirm(el.clear, "Tap to erase everything", async () => {
    clearTimeout(saveTimer);
    await clearState();
    state = await loadState();
    rerenderAll();
    setStatus("Erased.", "good");
    el.results.replaceChildren();
  });
}

async function renderShortcutHint() {
  const commands = await chrome.commands.getAll().catch(() => []);
  const command = commands.find((item) => item.name === "fill-now");
  if (command && command.shortcut) {
    el.shortcutHint.textContent = `${command.shortcut} fills without opening this panel.`;
    return;
  }
  el.shortcutHint.textContent = "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link";
  button.textContent = "Assign a keyboard shortcut";
  button.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  el.shortcutHint.append(button, document.createTextNode(" to fill without opening this panel."));
}

async function init() {
  state = await loadState();
  rerenderAll();
  wire();
  await renderShortcutHint();
}

init();
