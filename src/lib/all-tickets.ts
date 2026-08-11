import type { WorkItem } from "@/lib/types";

/** Cross-lane resolve view defaults to the oldest work first. */
export function sortTicketsOldestFirst(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const ageOrder = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return ageOrder || a.id.localeCompare(b.id);
  });
}

