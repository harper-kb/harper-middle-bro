"use client";

import { LocalDateTime } from "@/components/LocalDateTime";
import {
  isOpenTaskStatus,
  statusLabel,
  type SpineTaskRow,
} from "@/lib/service-spine/domain";

function TaskCard({ task }: { task: SpineTaskRow }) {
  const open = isOpenTaskStatus(task.status);
  return (
    <li className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            open
              ? task.ownerKind === "human"
                ? "bg-[var(--accent)]"
                : "bg-[var(--info)]"
              : "bg-[var(--spine-closed)]"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-5 text-[var(--ink)]">
              {task.title}
            </p>
            <span className="rounded-md bg-[var(--surface-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">
              {statusLabel(task.status)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--ink)]">
              {task.ownerKind === "human" ? "Human" : "Agent"}
            </span>
            {task.assigneeLabel ?? task.assignee ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{task.assigneeLabel ?? task.assignee}</span>
              </>
            ) : null}
            {task.gateLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{task.gateLabel}</span>
              </>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tabular-nums text-[var(--muted)]">
            {task.slaDueAt ? (
              <span>
                Due <LocalDateTime value={task.slaDueAt} />
              </span>
            ) : null}
            {task.completedAt ? (
              <span>
                Completed <LocalDateTime value={task.completedAt} />
              </span>
            ) : task.createdAt ? (
              <span>
                Created <LocalDateTime value={task.createdAt} />
              </span>
            ) : null}
            <span className="ml-auto">Task #{task.id}</span>
          </div>
          {task.laneSkill ? (
            <details className="disclosure mt-2">
              <summary className="inline-flex min-h-7 cursor-pointer items-center gap-1 text-[10px] font-semibold text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                <span className="disclosure-caret" aria-hidden="true">
                  ›
                </span>
                System details
              </summary>
              <code className="mt-1 block overflow-x-auto rounded-lg bg-[var(--surface-subtle)] px-2.5 py-2 text-[10px] text-[var(--muted)]">
                {task.laneSkill}
              </code>
            </details>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TaskGroup({
  title,
  tasks,
}: {
  title: string;
  tasks: SpineTaskRow[];
}) {
  if (tasks.length === 0) return null;
  return (
    <section aria-labelledby={`task-group-${title.toLowerCase()}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3
          id={`task-group-${title.toLowerCase()}`}
          className="text-xs font-semibold text-[var(--ink)]"
        >
          {title}
        </h3>
        <span className="text-[10px] tabular-nums text-[var(--muted)]">
          {tasks.length.toLocaleString("en-US")}
        </span>
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}

export function IssueTasks({ tasks }: { tasks: SpineTaskRow[] }) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--rule)] px-4 py-5 text-sm text-[var(--muted)]">
        No tasks are recorded on this issue.
      </p>
    );
  }
  const open = tasks.filter((task) => isOpenTaskStatus(task.status));
  const completed = tasks.filter((task) => !isOpenTaskStatus(task.status));
  return (
    <div className="space-y-5">
      <TaskGroup title="Open" tasks={open} />
      <TaskGroup title="Completed" tasks={completed} />
    </div>
  );
}
