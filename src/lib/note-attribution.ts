import type { NoteThreadEntry } from "@/lib/note-thread-types";

/** Never let a missing authoritative relationship erase the attribution row. */
export function displayNoteAuthor(author: string | null | undefined): string {
  const normalized = author?.trim() ?? "";
  if (
    !normalized ||
    normalized === "Harper operator" ||
    normalized === "Unknown producer"
  ) {
    return "Unknown author";
  }
  return normalized;
}

/** Stable first-seen order follows the authorized, newest-first thread. */
export function visibleNoteParticipants(
  entries: readonly NoteThreadEntry[],
): string[] {
  const seen = new Set<string>();
  const participants: string[] = [];
  for (const entry of entries) {
    const author = displayNoteAuthor(entry.author);
    if (seen.has(author)) continue;
    seen.add(author);
    participants.push(author);
  }
  return participants;
}
