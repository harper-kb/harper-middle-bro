"use client";

import {
  SPINE_BOARD_ROWS_STEPS,
  SPINE_COLUMNS,
  type SpineBoardColumn,
} from "@/lib/service-spine/domain";
import { SpineCard } from "./SpineCard";
import {
  SpineStatusDot,
  spineStatusVisual,
} from "./spine-visuals";
import { useWindowedList } from "./use-windowed-list";

export function SpineColumn({
  column,
  rowsCap,
  nowMs,
  selectedIssueId,
  pending,
  onOpenIssue,
  onLoadMore,
}: {
  column: SpineBoardColumn;
  rowsCap: number;
  nowMs: number;
  selectedIssueId: number | null;
  pending: boolean;
  onOpenIssue: (issueId: number) => void;
  onLoadMore: (nextRows: number) => void;
}) {
  const served = column.rows.length;
  const capped = served < column.total;
  const nextStep = SPINE_BOARD_ROWS_STEPS.find((step) => step > rowsCap);
  const note = SPINE_COLUMNS.find((candidate) => candidate.id === column.id)?.note;
  const visual = spineStatusVisual(column.id);
  const focusMode =
    selectedIssueId !== null &&
    column.rows.some((issue) => issue.id === selectedIssueId);
  const { containerRef, onScroll, start, end, totalHeight, rowHeight, offsetFor } =
    useWindowedList({ count: served });

  return (
    <section
      role="region"
      aria-label={`${column.label} — ${column.total.toLocaleString("en-US")} ${
        column.total === 1 ? "issue" : "issues"
      }`}
      aria-busy={pending || undefined}
      style={visual.style}
      className="spine-board-column"
    >
      <header className="relative shrink-0 overflow-hidden border-b border-[var(--rule)] px-3.5 py-3">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 bg-[var(--spine-tone)]"
        />
        <div className="flex items-center justify-between gap-2">
          <h3
            className="flex min-w-0 items-center gap-2 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink)]"
            title={note}
          >
            <SpineStatusDot
              status={column.id}
              hollow={column.id === "closure-proposed"}
            />
            {column.label}
          </h3>
          <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--ink)]">
            {column.total.toLocaleString("en-US")}
          </span>
        </div>
        {capped ? (
          <p className="mt-0.5 text-[10px] tabular-nums text-[var(--muted)]">
            {served.toLocaleString("en-US")} loaded of{" "}
            {column.total.toLocaleString("en-US")}
          </p>
        ) : null}
      </header>

      <div
        ref={containerRef}
        onScroll={onScroll}
        className="spine-column-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5"
      >
        {served === 0 ? (
          <div className="flex min-h-28 items-center justify-center px-4 text-center">
            <p className="text-xs text-[var(--muted)]">No matching issues</p>
          </div>
        ) : (
          <div className="relative" style={{ height: totalHeight }}>
            {column.rows.slice(start, end).map((issue, index) => (
              <div
                key={issue.id}
                className="absolute inset-x-0 pb-2.5"
                style={{ top: offsetFor(start + index), height: rowHeight }}
              >
                <SpineCard
                  issue={issue}
                  nowMs={nowMs}
                  selected={selectedIssueId === issue.id}
                  deemphasized={focusMode && selectedIssueId !== issue.id}
                  onOpen={onOpenIssue}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {capped && nextStep !== undefined ? (
        <div className="shrink-0 border-t border-[var(--rule)] p-2.5">
          <button
            type="button"
            className="btn-ghost min-h-10 w-full py-1.5 text-xs"
            onClick={() => onLoadMore(nextStep)}
            disabled={pending}
            aria-label={`Load more ${column.label} issues — raise the board cap to ${nextStep} per column`}
          >
            {pending ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
