import type { WorkItem } from "@/lib/types";

export type CoiPath = "blanket_fast" | "scheduled_review" | "binder_to_coi" | "correction";

export function classifyCoiPath(item: WorkItem): CoiPath {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  if (/correct|amend|reissue/.test(hay)) return "correction";
  if (/binder/.test(hay)) return "binder_to_coi";
  if (/blanket/.test(hay)) return "blanket_fast";
  return "scheduled_review";
}

export const COI_PATH_LABELS: Record<CoiPath, string> = {
  blanket_fast: "Blanket Fast Path",
  scheduled_review: "Holder / Wording Review",
  binder_to_coi: "Binder → COI",
  correction: "Correction",
};

export function coiNextAction(path: CoiPath): string {
  if (path === "blanket_fast") return "Issue Blanket COI";
  if (path === "binder_to_coi") return "Generate From Binder";
  if (path === "correction") return "Correct & Reissue";
  return "Review Holder Wording";
}
