"use client";

import { useCallback, useRef, useState } from "react";
import type { SpineBoardResult } from "@/lib/service-spine/domain";
import { useSpineFilters } from "./SpineFilterProvider";
import { SpineColumn } from "./SpineColumn";

/**
 * The board face: a horizontally scrollable region of fixed-width columns in
 * the server result's order (the six known columns, then any unknown status
 * appended verbatim — the parity law lives in the read service, the board
 * just paints what it is handed).
 */
export function SpineBoard({
  result,
  rowsCap,
  nowMs,
}: {
  result: SpineBoardResult;
  rowsCap: number;
  nowMs: number;
}) {
  const { requested, update, isPending } = useSpineFilters();
  const [activeColumn, setActiveColumn] = useState(
    result.columns[0]?.id ?? "",
  );
  const columnRefs = useRef(new Map<string, HTMLDivElement>());

  const openIssue = useCallback(
    (issueId: number) => update({ issue: issueId }, { history: "push" }),
    [update],
  );
  const loadMore = useCallback(
    (nextRows: number) => update({ rows: nextRows }, { history: "push" }),
    [update],
  );

  const focusColumn = (columnId: string) => {
    setActiveColumn(columnId);
    columnRefs.current
      .get(columnId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  };

  return (
    <div>
      <label className="mb-2 flex min-h-10 items-center justify-between gap-3 rounded-xl border border-[var(--rule)] bg-[var(--surface)] px-3 md:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          Status column
        </span>
        <select
          value={activeColumn}
          onChange={(event) => focusColumn(event.target.value)}
          className="min-w-0 bg-transparent text-xs font-semibold text-[var(--ink)] focus:outline-none"
          aria-label="Jump to a status column"
        >
          {result.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.label} · {column.total.toLocaleString("en-US")}
            </option>
          ))}
        </select>
      </label>

      <div
        className="spine-board-scroll"
        role="group"
        aria-label="Service Spine issues board"
        tabIndex={0}
      >
        <div className="flex items-stretch gap-3 pr-8">
          {result.columns.map((column) => (
            <div
              key={column.id}
              ref={(element) => {
                if (element) columnRefs.current.set(column.id, element);
                else columnRefs.current.delete(column.id);
              }}
              className="shrink-0 snap-start"
            >
              <SpineColumn
                column={column}
                rowsCap={rowsCap}
                nowMs={nowMs}
                selectedIssueId={requested.issue}
                pending={isPending}
                onOpenIssue={openIssue}
                onLoadMore={loadMore}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
