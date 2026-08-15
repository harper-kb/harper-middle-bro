/**
 * Service worker. Owns every fill so a run started from the popup finishes even if the popup
 * closes, and so the keyboard shortcut can fill without opening any UI at all.
 */

import { activeProfile, loadState } from "./lib/storage.js";
import { fillTab, headline } from "./lib/fill-runner.js";
import { isReady } from "./lib/fields.js";

const BADGE_CLEAR_MS = 4000;

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), BADGE_CLEAR_MS);
  }
}

async function runFill(tabId) {
  await chrome.action.setBadgeText({ text: "" });

  const state = await loadState();
  const profile = activeProfile(state);
  if (!isReady(profile)) {
    await setBadge("!", "#c45c4a");
    return { ok: false, error: "Nothing saved yet — open the extension and enter the details once." };
  }

  const report = await fillTab(tabId, profile);
  if (report.ok) {
    const { filled, already } = report.summary;
    const done = filled + already;
    await setBadge(done ? String(done) : "0", done ? "#2f9e6e" : "#c45c4a");
  } else {
    await setBadge("!", "#c45c4a");
  }
  return report;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-now") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && typeof tab.id === "number") await runFill(tab.id);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "fill") return undefined;

  runFill(message.tabId)
    .then((report) => sendResponse({ ...report, headline: headline(report) }))
    .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));

  // Keeps the message channel open for the async response above.
  return true;
});
