import {
  isTerminalIssueStatus,
  type SpineSummary,
} from "@/lib/service-spine/domain";
import {
  SpineStatusDot,
  spineStatusVisual,
} from "./spine-visuals";

function closedCount(summary: SpineSummary): number {
  return summary.issuesByStatus
    .filter((entry) => isTerminalIssueStatus(entry.status))
    .reduce((sum, entry) => sum + entry.n, 0);
}

export type SpineOperationalCounts = {
  open: number;
  blocked: number;
  waitingCustomer: number;
  waitingThirdParty: number;
  closureReview: number;
};

function QueueCard({
  status,
  label,
  value,
  note,
}: {
  status: string;
  label: string;
  value: number;
  note: string;
}) {
  const visual = spineStatusVisual(status);
  return (
    <div
      style={visual.style}
      className="spine-queue-metric"
      title={note}
    >
      <SpineStatusDot
        status={status}
        hollow={status === "closure-proposed"}
      />
      <strong className="text-xl font-semibold leading-none tabular-nums tracking-[-0.03em] text-[var(--ink)]">
        {value.toLocaleString("en-US")}
      </strong>
      <span className="min-w-0 text-[11px] font-semibold leading-4 text-[var(--muted)]">
        {label}
      </span>
    </div>
  );
}

function WorkloadRow({
  label,
  open,
  total,
  tone,
}: {
  label: string;
  open: number;
  total: number;
  tone: string;
}) {
  const percentage = total > 0 ? Math.min(100, (open / total) * 100) : 0;
  const copy = `${open.toLocaleString("en-US")} open of ${total.toLocaleString(
    "en-US",
  )}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-[var(--ink)]">{label}</span>
        <span
          className="text-[11px] tabular-nums text-[var(--muted)]"
          title={`${label}: ${copy}`}
        >
          {copy}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}: ${copy}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={open}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${percentage}%`, background: tone }}
        />
      </div>
    </div>
  );
}

export function ServiceHealthSummary({
  summary,
  counts,
}: {
  summary: SpineSummary;
  counts: SpineOperationalCounts;
}) {
  const queues = [
    {
      status: "open",
      label: "Open",
      value: counts.open,
      note: "Issues actively being worked, excluding closure review.",
    },
    {
      status: "blocked",
      label: "Blocked",
      value: counts.blocked,
      note: "Issues that need an unblock before work can continue.",
    },
    {
      status: "waiting_customer",
      label: "Waiting on customer",
      value: counts.waitingCustomer,
      note: "Issues whose next move belongs to the customer.",
    },
    {
      status: "waiting_third_party",
      label: "Waiting on third party",
      value: counts.waitingThirdParty,
      note: "Issues waiting on a carrier, underwriter, or other third party.",
    },
    {
      status: "closure-proposed",
      label: "Closure review",
      value: counts.closureReview,
      note: "Issues proposed for closure and awaiting confirmation.",
    },
  ] as const;

  return (
    <section
      aria-labelledby="spine-health-heading"
      aria-live="polite"
      className="spine-health-summary"
    >
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="spine-health-heading"
          className="text-sm font-semibold text-[var(--ink)]"
        >
          Operational health
        </h2>
        <p className="text-xs tabular-nums text-[var(--muted)]">
          <strong className="font-semibold text-[var(--ink)]">
            {summary.issuesTotal.toLocaleString("en-US")}
          </strong>{" "}
          total issues
        </p>
      </div>

      <div className="spine-health-grid">
        <div className="spine-queue-grid">
          {queues.map((queue) => (
            <QueueCard key={queue.status} {...queue} />
          ))}
        </div>

        <details className="spine-workload-card">
          <summary className="spine-workload-summary">
            <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted)]">
              Workload
            </span>
            <span className="min-w-0 truncate text-[11px] font-semibold tabular-nums text-[var(--ink)]">
              Agent {summary.agentTasks.open.toLocaleString("en-US")} · Human{" "}
              {summary.humanTasks.open.toLocaleString("en-US")}
            </span>
            <span
              aria-hidden="true"
              className="spine-workload-chevron text-base text-[var(--muted)]"
            >
              ›
            </span>
          </summary>

          <div className="spine-workload-popover">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[var(--ink)]">
                Workload health
              </h3>
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                Open / total
              </span>
            </div>
            <div className="mt-3 space-y-3">
              <WorkloadRow
                label="Agent tasks"
                open={summary.agentTasks.open}
                total={summary.agentTasks.total}
                tone="var(--info)"
              />
              <WorkloadRow
                label="Human tasks"
                open={summary.humanTasks.open}
                total={summary.humanTasks.total}
                tone="var(--accent)"
              />
            </div>

            <details className="spine-system-details mt-3 border-t border-[var(--rule)] pt-2.5">
              <summary className="flex min-h-8 cursor-pointer items-center justify-between gap-2 text-[11px] font-semibold text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                System activity
                <span aria-hidden="true" className="text-base leading-none">
                  ›
                </span>
              </summary>
              <dl className="grid grid-cols-3 gap-2 pt-2 text-[10px] text-[var(--muted)]">
                <div>
                  <dt>Closed</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-[var(--ink)]">
                    {closedCount(summary).toLocaleString("en-US")}
                  </dd>
                </div>
                <div title="All recorded issue events">
                  <dt>Events</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-[var(--ink)]">
                    {summary.events.total.toLocaleString("en-US")}
                  </dd>
                </div>
                <div title="Signals intentionally suppressed before becoming issue events">
                  <dt>Suppressed</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-[var(--ink)]">
                    {summary.events.suppressions.toLocaleString("en-US")}
                  </dd>
                </div>
              </dl>
            </details>
          </div>
        </details>
      </div>
    </section>
  );
}

/** Compatibility export for focused tests and downstream imports while the
 * file keeps its existing route-private name. */
export const SpineSummaryStrip = ServiceHealthSummary;
