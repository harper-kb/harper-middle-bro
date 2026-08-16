import type { ThreadStatus } from "@/lib/types";

const LABELS: Record<ThreadStatus, string> = {
  drafting: "Drafting",
  waiting_uw: "Waiting UW",
  price_offered: "Terms Sent",
  auto_approved: "Auto-Approved",
  needs_human: "Needs Human",
  closed: "Closed",
};

const STYLES: Record<ThreadStatus, string> = {
  drafting: "status-neutral",
  waiting_uw: "status-warning",
  price_offered: "status-info",
  auto_approved: "status-success",
  needs_human: "status-danger",
  closed: "status-neutral opacity-75",
};

export function StatusPill({ status }: { status: ThreadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
