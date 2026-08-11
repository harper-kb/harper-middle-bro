/**
 * Profile persistence.
 *
 * chrome.storage.local, never chrome.storage.sync: sync mirrors data through a Google
 * account, which is the wrong place for a bank account number. Local storage keeps the
 * values on this machine, in this browser profile, and nowhere else.
 */

import { emptyValues, newProfile } from "./fields.js";

const KEY = "harperAutofill";
const SCHEMA_VERSION = 1;

function fallbackState() {
  const profile = newProfile();
  return { version: SCHEMA_VERSION, activeProfileId: profile.id, profiles: [profile] };
}

/** Repair anything missing so a corrupted or partially-written store still opens. */
function normalize(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.profiles) || raw.profiles.length === 0) {
    return fallbackState();
  }
  const profiles = raw.profiles.map((profile, i) => ({
    id: typeof profile.id === "string" && profile.id ? profile.id : `p_${i}`,
    name: typeof profile.name === "string" && profile.name.trim() ? profile.name : `Profile ${i + 1}`,
    values: { ...emptyValues(), ...(profile.values || {}) },
    customFields: Array.isArray(profile.customFields)
      ? profile.customFields
          .filter((field) => field && typeof field === "object")
          .map((field) => ({
            match: String(field.match || ""),
            value: String(field.value || ""),
            kind: field.kind === "select" ? "select" : "text",
          }))
      : [],
  }));
  const activeProfileId = profiles.some((profile) => profile.id === raw.activeProfileId)
    ? raw.activeProfileId
    : profiles[0].id;
  return { version: SCHEMA_VERSION, activeProfileId, profiles };
}

export async function loadState() {
  const stored = await chrome.storage.local.get(KEY);
  return normalize(stored[KEY]);
}

export async function saveState(state) {
  await chrome.storage.local.set({ [KEY]: normalize(state) });
}

export async function clearState() {
  await chrome.storage.local.remove(KEY);
}

export function activeProfile(state) {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}

/** The payload shape src/inject/fill-engine.js expects. */
export function toPayload(profile) {
  return {
    values: profile.values,
    customFields: (profile.customFields || []).filter((field) => field.match && field.value),
  };
}
