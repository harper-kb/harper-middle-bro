/**
 * Middle Bro memory — localStorage-backed, keyed per operator. Honest by
 * design: this browser is the only store (the sandbox has no synced profile
 * service), entries cap at 50 unpinned, and pinned answers survive the cap.
 *
 * Client-safe: no db, no server imports. In Node (the self-check) it works
 * against whatever `localStorage` the caller puts on globalThis.
 */

export interface BotMemoryEntry {
  id: string;
  question: string;
  /** Truncated answer text — enough to recognize, not a second record */
  answer: string;
  kind: "answer" | "refusal";
  scopeKind: "desk" | "account" | "ticket";
  /** Human chip text, e.g. "Desk-Wide" or "Meridian Reach" */
  scopeLabel: string;
  /** Query string that re-creates the scope: "" | "account=…" | "ticket=…" */
  scopeQuery: string;
  askedAt: string;
  pinned: boolean;
}

export const BOT_MEMORY_CAP = 50;

const ANSWER_SUMMARY_MAX = 240;

function storageKey(operatorId: string): string {
  return `middle-bro-memory:${operatorId}`;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Newest first; pinned and unpinned interleaved as asked. */
export function loadBotMemory(operatorId: string): BotMemoryEntry[] {
  const store = getStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(storageKey(operatorId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as BotMemoryEntry[];
  } catch {
    return [];
  }
}

function save(operatorId: string, entries: BotMemoryEntry[]): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(storageKey(operatorId), JSON.stringify(entries));
  } catch {
    // Storage full or blocked — memory is best-effort, never fatal.
  }
}

/** Keep every pinned entry; keep at most BOT_MEMORY_CAP newest unpinned. */
function applyCap(entries: BotMemoryEntry[]): BotMemoryEntry[] {
  let unpinned = 0;
  const kept: BotMemoryEntry[] = [];
  for (const e of entries) {
    if (e.pinned) {
      kept.push(e);
    } else if (unpinned < BOT_MEMORY_CAP) {
      kept.push(e);
      unpinned++;
    }
  }
  return kept;
}

export function rememberExchange(
  operatorId: string,
  input: {
    question: string;
    answer: string;
    kind: "answer" | "refusal";
    scopeKind: "desk" | "account" | "ticket";
    scopeLabel: string;
    scopeQuery: string;
    askedAt?: string;
  },
): BotMemoryEntry[] {
  const existing = loadBotMemory(operatorId);
  // Re-asking the same question in the same scope moves it to the top
  // (keeping a pin if it had one) instead of piling up duplicates.
  const prior = existing.find(
    (e) => e.question === input.question && e.scopeQuery === input.scopeQuery,
  );
  const rest = existing.filter((e) => e !== prior);
  const entry: BotMemoryEntry = {
    id:
      prior?.id ??
      `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    question: input.question,
    answer:
      input.answer.length <= ANSWER_SUMMARY_MAX
        ? input.answer
        : `${input.answer.slice(0, ANSWER_SUMMARY_MAX - 1)}…`,
    kind: input.kind,
    scopeKind: input.scopeKind,
    scopeLabel: input.scopeLabel,
    scopeQuery: input.scopeQuery,
    askedAt: input.askedAt ?? new Date().toISOString(),
    pinned: prior?.pinned ?? false,
  };
  const next = applyCap([entry, ...rest]);
  save(operatorId, next);
  return next;
}

export function toggleBotPin(
  operatorId: string,
  entryId: string,
): BotMemoryEntry[] {
  const next = loadBotMemory(operatorId).map((e) =>
    e.id === entryId ? { ...e, pinned: !e.pinned } : e,
  );
  save(operatorId, next);
  return next;
}

export function forgetBotEntry(
  operatorId: string,
  entryId: string,
): BotMemoryEntry[] {
  const next = loadBotMemory(operatorId).filter((e) => e.id !== entryId);
  save(operatorId, next);
  return next;
}

/** Clears unpinned history; pinned answers stay. */
export function clearBotRecent(operatorId: string): BotMemoryEntry[] {
  const next = loadBotMemory(operatorId).filter((e) => e.pinned);
  save(operatorId, next);
  return next;
}
