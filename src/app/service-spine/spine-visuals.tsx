import type { CSSProperties, ReactNode } from "react";
import {
  spineSlaDuration,
  spineSlaState,
  statusLabel,
} from "@/lib/service-spine/domain";

type ToneStyle = CSSProperties & { "--spine-tone": string };

export type SpineStatusVisual = {
  label: string;
  tone: string;
  style: ToneStyle;
};

const STATUS_TONES: Record<string, string> = {
  open: "var(--spine-open)",
  blocked: "var(--spine-blocked)",
  waiting_customer: "var(--spine-waiting-customer)",
  waiting_third_party: "var(--spine-waiting-third-party)",
  "closure-proposed": "var(--spine-closure-review)",
  resolved: "var(--spine-closed)",
  cancelled: "var(--spine-closed)",
  closed: "var(--spine-closed)",
};

export function spineStatusVisual(statusOrColumn: string): SpineStatusVisual {
  const label =
    statusOrColumn === "closure-proposed"
      ? "Closure review"
      : statusOrColumn === "closed"
        ? "Closed"
        : statusLabel(statusOrColumn);
  const tone = STATUS_TONES[statusOrColumn] ?? "var(--spine-closed)";
  return {
    label,
    tone,
    style: { "--spine-tone": tone },
  };
}

export function SpineStatusDot({
  status,
  hollow = false,
}: {
  status: string;
  hollow?: boolean;
}) {
  const visual = spineStatusVisual(status);
  return (
    <span
      aria-hidden="true"
      style={visual.style}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        hollow
          ? "border-[1.5px] border-[var(--spine-tone)] bg-transparent"
          : "bg-[var(--spine-tone)]"
      }`}
    />
  );
}

export function SpineStatusPill({ status }: { status: string }) {
  const visual = spineStatusVisual(status);
  return (
    <span
      style={visual.style}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--spine-tone)_10%,transparent)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)]"
    >
      <SpineStatusDot
        status={status}
        hollow={status === "closure-proposed"}
      />
      {visual.label}
    </span>
  );
}

export function SpinePriorityBadge({ priority }: { priority: string }) {
  const tone =
    priority === "P0"
      ? "var(--spine-danger-ink)"
      : priority === "P1"
        ? "var(--spine-warning-ink)"
        : priority === "P2"
          ? "var(--info)"
          : "var(--muted)";
  const strong = priority === "P0" || priority === "P1";
  return (
    <span
      style={{ "--spine-tone": tone } as ToneStyle}
      className={`inline-flex min-w-7 items-center justify-center rounded-md px-1.5 py-1 text-[10px] font-bold tabular-nums ${
        strong
          ? "bg-[color-mix(in_srgb,var(--spine-tone)_14%,transparent)] text-[var(--spine-tone)]"
          : "bg-[var(--surface-subtle)] text-[var(--spine-tone)]"
      }`}
      aria-label={`Priority ${priority}`}
    >
      {priority}
    </span>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <circle cx="8" cy="8" r="5.25" />
      <path d="M8 4.75V8l2.25 1.35" />
    </svg>
  );
}

export function SpineSlaChip({
  slaDueAt,
  status,
  nowMs,
  compact = false,
}: {
  slaDueAt: string | null;
  status: string;
  nowMs: number;
  compact?: boolean;
}) {
  const { state, dueMs } = spineSlaState(slaDueAt, status, nowMs);
  if (state === "none" || dueMs === null) return null;

  const duration = spineSlaDuration(dueMs - nowMs);
  const label =
    state === "breached"
      ? `SLA breached ${duration} ago`
      : state === "soon"
        ? `SLA due in ${duration}`
        : `SLA due in ${duration}`;
  const tone =
    state === "breached"
      ? "var(--spine-danger-ink)"
      : state === "soon"
        ? "var(--spine-warning-ink)"
        : "var(--muted)";

  return (
    <span
      data-sla-state={state}
      style={{ "--spine-tone": tone } as ToneStyle}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md font-semibold tabular-nums text-[var(--spine-tone)] ${
        state === "breached" || state === "soon"
          ? "bg-[color-mix(in_srgb,var(--spine-tone)_11%,transparent)]"
          : "bg-[var(--surface-subtle)]"
      } ${compact ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"}`}
      title={slaDueAt ? `Exact SLA: ${slaDueAt}` : undefined}
    >
      <ClockIcon />
      {label}
    </span>
  );
}

function TasksIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d="m3 4.25 1 1 1.75-2M7.25 4.5h5.5M3 8l1 1 1.75-2M7.25 8.25h5.5M3 11.75l1 1 1.75-2M7.25 12h5.5" />
    </svg>
  );
}

export function SpineTaskProgress({
  agentOpen,
  agentTotal,
  humanOpen,
  humanTotal,
  compact = false,
}: {
  agentOpen: number;
  agentTotal: number;
  humanOpen: number;
  humanTotal: number;
  compact?: boolean;
}) {
  const open = agentOpen + humanOpen;
  const total = agentTotal + humanTotal;
  const visible =
    total === 0 ? "No tasks" : `${open} open of ${total} tasks`;
  const detail = `Agent tasks: ${agentOpen} open of ${agentTotal}. Human tasks: ${humanOpen} open of ${humanTotal}.`;

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[var(--muted)] ${
        compact ? "text-[10px]" : "text-[11px]"
      }`}
      aria-label={detail}
      title={detail}
    >
      <TasksIcon />
      <span className="tabular-nums">{visible}</span>
    </span>
  );
}

export function SpineDraftMark() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--muted)]"
      title="A draft exists on this issue"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        <path d="M9.75 2.75 13.25 6.25 6 13.5H2.75V10.25zM8.5 4l3.5 3.5" />
      </svg>
      Draft
    </span>
  );
}

export function spineRelativeTime(
  at: string | null,
  nowMs: number,
): string | null {
  if (!at) return null;
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return null;
  if (then > nowMs) return "just now";
  return `${spineSlaDuration(nowMs - then)} ago`;
}

export function MetaIconLabel({
  icon,
  children,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]"
      title={title}
    >
      {icon}
      {children}
    </span>
  );
}
