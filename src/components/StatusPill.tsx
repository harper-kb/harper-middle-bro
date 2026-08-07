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
  drafting: "bg-slate-100 text-slate-700",
  waiting_uw: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  price_offered: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  auto_approved: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  needs_human: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  closed: "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
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
