"use client";

import Link from "next/link";
import { memo } from "react";
import {
  issueTypeLabel,
  spineCohortOf,
  SPINE_COHORT_LABELS,
  type SpineIssueCard as SpineIssueCardModel,
} from "@/lib/service-spine/domain";
import {
  SpineDraftMark,
  SpinePriorityBadge,
  SpineSlaChip,
  SpineTaskProgress,
  spineRelativeTime,
} from "./spine-visuals";

function CompanyName({ issue }: { issue: SpineIssueCardModel }) {
  const name = issue.companyName ?? "No company on file";
  if (issue.accountId) {
    return (
      <Link
        href={`/accounts/${issue.accountId}`}
        onClick={(event) => event.stopPropagation()}
        className="pointer-events-auto relative min-w-0 truncate text-[13px] font-semibold text-[var(--ink)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        title={name}
      >
        {name}
      </Link>
    );
  }
  return (
    <span
      className={`min-w-0 truncate text-[13px] font-semibold ${
        issue.companyName ? "text-[var(--ink)]" : "text-[var(--muted)]"
      }`}
      title={name}
    >
      {name}
    </span>
  );
}

/**
 * Scan order is fixed for every card:
 * priority + company → type/work context → goal → SLA/tasks → updated/id.
 * The card intentionally omits the status pill (the column already supplies
 * it) and moves wave/id to the lowest-emphasis row.
 */
export const SpineCard = memo(function SpineCard({
  issue,
  nowMs,
  onOpen,
  selected = false,
  deemphasized = false,
}: {
  issue: SpineIssueCardModel;
  nowMs: number;
  onOpen: (issueId: number) => void;
  selected?: boolean;
  deemphasized?: boolean;
}) {
  const cohort = spineCohortOf(issue.pendingOrder);
  const updated = spineRelativeTime(
    issue.updatedAt ?? issue.lastEventAt,
    nowMs,
  );

  return (
    <article
      data-spine-card={issue.id}
      data-selected={selected || undefined}
      className={`spine-issue-card interactive-record-surface interactive-record-surface--clickable relative h-full overflow-hidden ${
        selected ? "interactive-record-surface--selected" : ""
      } ${
        deemphasized ? "interactive-record-surface--deemphasized" : ""
      }`}
    >
      <button
        type="button"
        data-spine-issue-trigger={issue.id}
        data-interactive-record-trigger
        onClick={() => onOpen(issue.id)}
        aria-label={`Open issue #${issue.id}: ${issue.goal}`}
        aria-pressed={selected}
        className="absolute inset-0 z-0 h-full w-full cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
      />

      <div className="pointer-events-none relative z-10 flex h-full min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <SpinePriorityBadge priority={issue.priority} />
          <CompanyName issue={issue} />
          {issue.blocking === "blocking" ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[var(--danger)]">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]"
              />
              Blocking
            </span>
          ) : null}
        </div>

        <p className="mt-2 min-w-0 truncate text-[10px] font-medium text-[var(--muted)]">
          <span className="uppercase tracking-[0.08em]">
            {issueTypeLabel(issue.issueType)}
          </span>
          {cohort !== "others" ? (
            <>
              <span aria-hidden="true"> · </span>
              {SPINE_COHORT_LABELS[cohort]}
            </>
          ) : null}
        </p>

        <p className="mt-2 line-clamp-3 min-h-0 flex-1 text-xs leading-[1.35rem] text-[var(--ink)]">
          {issue.goal}
        </p>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <SpineSlaChip
            slaDueAt={issue.slaDueAt}
            status={issue.status}
            nowMs={nowMs}
            compact
          />
          <SpineTaskProgress
            agentOpen={issue.agentOpen}
            agentTotal={issue.agentTotal}
            humanOpen={issue.humanOpen}
            humanTotal={issue.humanTotal}
            compact
          />
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-[var(--rule)] pt-2 text-[10px] text-[var(--muted)]">
          {issue.hasDraft ? <SpineDraftMark /> : null}
          {updated ? (
            <span className="whitespace-nowrap tabular-nums">
              Updated {updated}
            </span>
          ) : null}
          <span className="ml-auto whitespace-nowrap tabular-nums">
            #{issue.id}
            {issue.wave ? ` · ${issue.wave}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
});

export {
  SpinePriorityBadge as SpinePriorityTag,
  SpineSlaChip,
} from "./spine-visuals";
