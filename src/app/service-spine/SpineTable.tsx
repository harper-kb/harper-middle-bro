"use client";

import Link from "next/link";
import {
  issueTypeLabel,
  spineCohortOf,
  SPINE_COHORT_LABELS,
  type SpineIssueCard,
  type SpineTableResult,
} from "@/lib/service-spine/domain";
import { useSpineFilters } from "./SpineFilterProvider";
import {
  SpinePriorityBadge,
  SpineSlaChip,
  SpineStatusPill,
  SpineTaskProgress,
  spineRelativeTime,
} from "./spine-visuals";

function CompanyLink({ issue }: { issue: SpineIssueCard }) {
  const name = issue.companyName ?? "No company on file";
  if (!issue.accountId) {
    return (
      <span className={issue.companyName ? "text-[var(--ink)]" : "text-[var(--muted)]"}>
        {name}
      </span>
    );
  }
  return (
    <Link
      href={`/accounts/${issue.accountId}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className="relative z-10 font-semibold text-[var(--ink)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      title={name}
    >
      {name}
    </Link>
  );
}

function IssueContext({ issue }: { issue: SpineIssueCard }) {
  const cohort = spineCohortOf(issue.pendingOrder);
  return (
    <div className="max-w-[30rem]">
      <p className="line-clamp-2 text-xs leading-5 text-[var(--ink)]">
        {issue.goal}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
        {issueTypeLabel(issue.issueType)}
        {cohort !== "others" ? ` · ${SPINE_COHORT_LABELS[cohort]}` : ""}
        {` · #${issue.id}`}
      </p>
    </div>
  );
}

const HEAD_CELL =
  "sticky top-0 z-10 border-b border-[var(--rule)] bg-[var(--surface)] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted)]";
const BODY_CELL = "border-b border-[var(--rule)] px-3 py-2.5 align-middle";

export function SpineTable({
  result,
  nowMs,
}: {
  result: SpineTableResult;
  nowMs: number;
}) {
  const { requested, update, hrefFor } = useSpineFilters();
  const openIssue = (issueId: number) =>
    update({ issue: issueId }, { history: "push" });
  const page = result.page;
  const pageCount = Math.max(1, result.pageCount);
  const from = result.filteredTotal === 0 ? 0 : (page - 1) * result.pageSize + 1;
  const to = Math.min(page * result.pageSize, result.filteredTotal);

  const goToPage = (
    event: React.MouseEvent<HTMLAnchorElement>,
    nextPage: number,
  ) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    update({ page: nextPage }, { history: "push" });
  };

  const activateRow = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    issueId: number,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openIssue(issueId);
  };

  return (
    <div>
      <div className="spine-table-shell">
        {result.rows.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center px-5 text-center">
            <p className="text-sm text-[var(--muted)]">
              No issues match the current filters.
            </p>
          </div>
        ) : (
          <>
            <table className="hidden w-full border-collapse text-xs lg:table">
              <thead>
                <tr>
                  <th className={HEAD_CELL}>Priority</th>
                  <th className={HEAD_CELL}>Company</th>
                  <th className={HEAD_CELL}>Issue</th>
                  <th className={HEAD_CELL}>Queue</th>
                  <th className={HEAD_CELL}>SLA</th>
                  <th className={HEAD_CELL}>Task progress</th>
                  <th className={HEAD_CELL}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((issue) => {
                  const updated = spineRelativeTime(
                    issue.updatedAt ?? issue.lastEventAt,
                    nowMs,
                  );
                  const selected = requested.issue === issue.id;
                  const deemphasized =
                    requested.issue !== null && requested.issue !== issue.id;
                  return (
                    <tr
                      key={issue.id}
                      tabIndex={0}
                      data-spine-issue-trigger={issue.id}
                      data-selected={selected || undefined}
                      aria-label={`Open issue #${issue.id}: ${issue.goal}`}
                      onClick={() => openIssue(issue.id)}
                      onKeyDown={(event) => activateRow(event, issue.id)}
                      className={`group interactive-record-surface interactive-record-surface--clickable focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                        selected ? "interactive-record-surface--selected" : ""
                      } ${
                        deemphasized
                          ? "interactive-record-surface--deemphasized"
                          : ""
                      }`}
                    >
                      <td className={`${BODY_CELL} whitespace-nowrap`}>
                        <SpinePriorityBadge priority={issue.priority} />
                      </td>
                      <td className={`${BODY_CELL} max-w-56 font-semibold`}>
                        <CompanyLink issue={issue} />
                      </td>
                      <td className={BODY_CELL}>
                        <IssueContext issue={issue} />
                      </td>
                      <td className={`${BODY_CELL} whitespace-nowrap`}>
                        <div className="flex flex-col items-start gap-1">
                          <SpineStatusPill status={issue.status} />
                          {issue.blocking === "blocking" ? (
                            <span className="text-[10px] font-semibold text-[var(--danger)]">
                              Blocking
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={`${BODY_CELL} whitespace-nowrap`}>
                        <SpineSlaChip
                          slaDueAt={issue.slaDueAt}
                          status={issue.status}
                          nowMs={nowMs}
                          compact
                        />
                      </td>
                      <td className={`${BODY_CELL} whitespace-nowrap`}>
                        <SpineTaskProgress
                          agentOpen={issue.agentOpen}
                          agentTotal={issue.agentTotal}
                          humanOpen={issue.humanOpen}
                          humanTotal={issue.humanTotal}
                        />
                      </td>
                      <td
                        className={`${BODY_CELL} whitespace-nowrap text-[11px] tabular-nums text-[var(--muted)]`}
                        title={issue.updatedAt ?? undefined}
                      >
                        {updated ? `Updated ${updated}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-[var(--rule)] lg:hidden">
              {result.rows.map((issue) => {
                const updated = spineRelativeTime(
                  issue.updatedAt ?? issue.lastEventAt,
                  nowMs,
                );
                const selected = requested.issue === issue.id;
                const deemphasized =
                  requested.issue !== null && requested.issue !== issue.id;
                return (
                  <li
                    key={issue.id}
                    className={`interactive-record-surface interactive-record-surface--clickable relative px-3.5 py-3 ${
                      selected ? "interactive-record-surface--selected" : ""
                    } ${
                      deemphasized
                        ? "interactive-record-surface--deemphasized"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      data-spine-issue-trigger={issue.id}
                      data-interactive-record-trigger
                      onClick={() => openIssue(issue.id)}
                      aria-label={`Open issue #${issue.id}: ${issue.goal}`}
                      className="absolute inset-0 z-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                    />
                    <div className="pointer-events-none relative z-10">
                      <div className="flex items-center gap-2">
                        <SpinePriorityBadge priority={issue.priority} />
                        <span className="pointer-events-auto min-w-0 flex-1 truncate">
                          <CompanyLink issue={issue} />
                        </span>
                        <SpineStatusPill status={issue.status} />
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--ink)]">
                        {issue.goal}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
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
                        {updated ? (
                          <span className="ml-auto text-[10px] tabular-nums text-[var(--muted)]">
                            {updated}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
        <span className="tabular-nums">
          Showing {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of{" "}
          {result.filteredTotal.toLocaleString("en-US")}
        </span>
        <nav aria-label="Issue table pagination" className="flex items-center gap-2">
          {page <= 1 ? (
            <span className="btn-ghost min-h-10 cursor-default px-3 text-xs opacity-40" aria-disabled="true">
              <span aria-hidden="true">←</span> Previous
            </span>
          ) : (
            <Link
              href={hrefFor({ page: page - 1 })}
              className="btn-ghost min-h-10 px-3 text-xs"
              aria-label={`Go to page ${page - 1}`}
              onClick={(event) => goToPage(event, page - 1)}
            >
              <span aria-hidden="true">←</span> Previous
            </Link>
          )}
          <span
            className="whitespace-nowrap text-xs tabular-nums"
            aria-label={`Page ${page} of ${pageCount}`}
          >
            Page {page} / {pageCount}
          </span>
          {page >= pageCount ? (
            <span className="btn-ghost min-h-10 cursor-default px-3 text-xs opacity-40" aria-disabled="true">
              Next <span aria-hidden="true">→</span>
            </span>
          ) : (
            <Link
              href={hrefFor({ page: page + 1 })}
              className="btn-ghost min-h-10 px-3 text-xs"
              aria-label={`Go to page ${page + 1}`}
              onClick={(event) => goToPage(event, page + 1)}
            >
              Next <span aria-hidden="true">→</span>
            </Link>
          )}
        </nav>
      </div>
    </div>
  );
}
