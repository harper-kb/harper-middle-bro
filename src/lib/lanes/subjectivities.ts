import type { WorkItem } from "@/lib/types";

export type SubjectivityBucket = "pre_bind" | "post_bind";

export function subjectivityBucket(item: WorkItem): SubjectivityBucket {
  const hay = `${item.title} ${item.summary} ${item.homeLane}`.toLowerCase();
  if (/post.?bind|active service|cancellation risk/.test(hay)) return "post_bind";
  if (item.homeLane === "pending_cancels") return "post_bind";
  return "pre_bind";
}

export function subjectivityElevated(item: WorkItem): boolean {
  return subjectivityBucket(item) === "post_bind" && (
    item.isOnFire || /cancel/.test(`${item.title} ${item.summary}`.toLowerCase())
  );
}
