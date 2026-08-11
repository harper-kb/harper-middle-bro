/**
 * Drives a fill: inject the engine into the tab, run it, and merge the per-frame reports.
 *
 * Injection happens on demand rather than through a declared content script so the extension
 * can ship with `activeTab` alone. Nothing is read from any page until the moment you ask for
 * a fill, and the extension has no standing access to any site.
 */

import { toPayload } from "./storage.js";

const ENGINE_FILE = "src/inject/fill-engine.js";

/** Best-outcome ordering when the same field is reported by more than one frame. */
const STATUS_RANK = {
  filled: 5,
  already: 4,
  failed: 3,
  blocked: 3,
  "not-found": 1,
};

const RESTRICTED_HINT =
  "Chrome does not allow extensions to run here. Open the payment page in a normal tab and try again.";

function isRestrictedUrl(url) {
  // An unreadable URL is not proof of a restricted page; let the injection decide.
  if (!url) return false;
  return (
    /^(chrome|edge|about|devtools|view-source|chrome-extension|moz-extension):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com/i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore/i.test(url)
  );
}

async function injectAndRun(tabId, payload, allFrames) {
  const target = { tabId, allFrames };
  await chrome.scripting.executeScript({ target, files: [ENGINE_FILE] });
  return chrome.scripting.executeScript({
    target,
    func: (arg) => globalThis.__harperAutofill.run(arg),
    args: [payload],
  });
}

/**
 * @param {number} tabId
 * @param {{ values: object, customFields: object[] }} profile
 */
export async function fillTab(tabId, profile) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && isRestrictedUrl(tab.url)) return { ok: false, error: RESTRICTED_HINT };

  const payload = toPayload(profile);

  let injections;
  try {
    injections = await injectAndRun(tabId, payload, true);
  } catch (error) {
    // Cross-origin child frames (a hosted card widget, for instance) are not covered by
    // activeTab. Fall back to the main document rather than failing the whole run.
    try {
      injections = await injectAndRun(tabId, payload, false);
    } catch (fallbackError) {
      return { ok: false, error: describeError(fallbackError) || describeError(error) };
    }
  }

  const frames = injections.map((injection) => injection.result).filter(Boolean);
  if (frames.length === 0) return { ok: false, error: "The page did not respond. Reload it and try again." };

  return { ok: true, ...merge(frames) };
}

function describeError(error) {
  const message = String((error && error.message) || error || "");
  if (/cannot be scripted|Extension manifest must request permission|Cannot access contents/i.test(message)) {
    return RESTRICTED_HINT;
  }
  if (/No tab with id/i.test(message)) return "That tab is gone. Open the payment page and try again.";
  return message || "The fill could not be started.";
}

/** Collapse per-frame reports into one row per field, keeping the best outcome seen. */
function merge(frames) {
  const byKey = new Map();
  for (const frame of frames) {
    for (const result of frame.results || []) {
      const existing = byKey.get(result.key);
      if (!existing || STATUS_RANK[result.status] > STATUS_RANK[existing.status]) {
        byKey.set(result.key, result);
      }
    }
  }

  const results = Array.from(byKey.values());
  const summary = { filled: 0, already: 0, notFound: 0, problem: 0 };
  for (const result of results) {
    if (result.status === "filled") summary.filled += 1;
    else if (result.status === "already") summary.already += 1;
    else if (result.status === "not-found") summary.notFound += 1;
    else summary.problem += 1;
  }

  return {
    results,
    summary,
    frameCount: frames.length,
    controlsScanned: frames.reduce((total, frame) => total + (frame.controlsScanned || 0), 0),
  };
}

/** One-line outcome, used for the toolbar badge and the popup's status line. */
export function headline(report) {
  if (!report.ok) return report.error;
  const { filled, already, notFound, problem } = report.summary;
  if (filled === 0 && already === 0) {
    return "No matching fields on this page.";
  }
  const parts = [`Filled ${filled} field${filled === 1 ? "" : "s"}`];
  if (already) parts.push(`${already} already correct`);
  if (notFound) parts.push(`${notFound} not found`);
  if (problem) parts.push(`${problem} needs a look`);
  return `${parts.join(" · ")}.`;
}
