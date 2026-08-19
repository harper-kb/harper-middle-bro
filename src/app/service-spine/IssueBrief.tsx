"use client";

import { LocalDateTime } from "@/components/LocalDateTime";
import {
  isOpenTaskStatus,
  issueTypeLabel,
  spineCohortOf,
  SPINE_COHORT_LABELS,
  type SpineIssueDetail,
} from "@/lib/service-spine/domain";
import {
  SpineSlaChip,
  SpineTaskProgress,
} from "./spine-visuals";

const ISO_IN_TEXT =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;

/** Source summaries occasionally contain machine ISO timestamps. Keep their
 * meaning while presenting them in the operator's local timezone. */
export function formatNarrativeDates(text: string): string {
  return text.replace(ISO_IN_TEXT, (raw) => {
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return raw;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  });
}

function BriefCard({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  return (
    <section className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </h3>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--ink)]">
        {formatNarrativeDates(text)}
      </p>
    </section>
  );
}

export function IssueBrief({
  detail,
  nowMs,
}: {
  detail: SpineIssueDetail;
  nowMs: number;
}) {
  const { issue, tasks } = detail;
  const cohort = spineCohortOf(issue.pendingOrder);
  const openTasks = tasks.filter((task) => isOpenTaskStatus(task.status));
  const nextTasks = openTasks.slice(0, 3);
  const hasSummary =
    Boolean(issue.latestSummary?.trim()) ||
    Boolean(issue.lastCommunicationSummary?.trim());

  return (
    <div className="space-y-4">
      <section aria-labelledby="issue-brief-heading">
        <h3
          id="issue-brief-heading"
          className="text-sm font-semibold text-[var(--ink)]"
        >
          Issue brief
        </h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink)]">
          {issue.goal}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted)]">
          <span className="font-semibold uppercase tracking-[0.08em]">
            {issueTypeLabel(issue.issueType)}
          </span>
          {cohort !== "others" ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{SPINE_COHORT_LABELS[cohort]}</span>
            </>
          ) : null}
          {issue.wave ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Wave {issue.wave}</span>
            </>
          ) : null}
          {issue.openedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Opened <LocalDateTime value={issue.openedAt} />
              </span>
            </>
          ) : null}
        </p>
      </section>

      <section
        aria-label="Urgency and task snapshot"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--rule)] bg-[var(--surface-subtle)] px-3.5 py-3"
      >
        {issue.blocking === "blocking" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--danger)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-[var(--danger)]"
            />
            Blocking issue
          </span>
        ) : null}
        <SpineSlaChip
          slaDueAt={issue.slaDueAt}
          status={issue.status}
          nowMs={nowMs}
        />
        <span className="ml-auto">
          <SpineTaskProgress
            agentOpen={issue.agentOpen}
            agentTotal={issue.agentTotal}
            humanOpen={issue.humanOpen}
            humanTotal={issue.humanTotal}
          />
        </span>
      </section>

      {hasSummary ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {issue.latestSummary?.trim() ? (
            <BriefCard label="Latest summary" text={issue.latestSummary} />
          ) : null}
          {issue.lastCommunicationSummary?.trim() ? (
            <BriefCard
              label="Last communication"
              text={issue.lastCommunicationSummary}
            />
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--rule)] px-3.5 py-3 text-xs text-[var(--muted)]">
          No latest summary or communication is on record yet.
        </p>
      )}

      {nextTasks.length > 0 ? (
        <section aria-labelledby="next-work-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h3
              id="next-work-heading"
              className="text-sm font-semibold text-[var(--ink)]"
            >
              Next work
            </h3>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">
              {openTasks.length.toLocaleString("en-US")} open
            </span>
          </div>
          <ul className="mt-2 divide-y divide-[var(--rule)] rounded-xl border border-[var(--rule)] bg-[var(--surface)]">
            {nextTasks.map((task) => (
              <li key={task.id} className="flex items-start gap-3 px-3.5 py-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    task.ownerKind === "human"
                      ? "bg-[var(--accent)]"
                      : "bg-[var(--info)]"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold leading-5 text-[var(--ink)]">
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    {task.ownerKind === "human" ? "Human" : "Agent"}
                    {task.assigneeLabel
                      ? ` · ${task.assigneeLabel}`
                      : ""}
                    {task.gateLabel ? ` · ${task.gateLabel}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {issue.resolutionSummary?.trim() ? (
        <BriefCard label="Resolution" text={issue.resolutionSummary} />
      ) : null}
    </div>
  );
}
