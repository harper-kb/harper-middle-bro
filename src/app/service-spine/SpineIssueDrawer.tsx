"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { SpineIssueApiResponse } from "@/app/api/service-spine/issue/[id]/route";
import { IssueBrief } from "./IssueBrief";
import { IssueConnections } from "./IssueConnections";
import { IssueTasks } from "./IssueTasks";
import {
  IssueTimeline,
  SPINE_TIMELINE_TRUNCATION_COPY,
  splitSpinePayload,
} from "./IssueTimeline";
import {
  SpinePriorityBadge,
  SpineSlaChip,
  SpineStatusPill,
} from "./spine-visuals";
import { useSpineFilters } from "./SpineFilterProvider";

export { SPINE_TIMELINE_TRUNCATION_COPY, splitSpinePayload };

export const ACTIONS_WORKBENCH_URL =
  "https://actions-parallel.bigbrother.harperinsure.com/?lane=service-spine";
export const SPINE_ISSUE_DETAIL_FAILED_COPY =
  "Issue detail is temporarily unavailable.";
export const SPINE_ISSUE_NOT_FOUND_COPY =
  "This issue is not in the spine mirror.";
export const SPINE_TIMELINE_FAILED_COPY =
  "The issue timeline is temporarily unavailable.";

type DrawerTab = "overview" | "tasks" | "timeline" | "connections";
type DrawerViewState = {
  data: SpineIssueApiResponse | null;
  loading: boolean;
  error: string | null;
};

const TABS: ReadonlyArray<{ id: DrawerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "timeline", label: "Timeline" },
  { id: "connections", label: "Connections" },
];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M9.25 3.25h3.5v3.5m-.25-3.25-5 5" />
      <path d="M7 4.25H4.5c-.69 0-1.25.56-1.25 1.25v6c0 .69.56 1.25 1.25 1.25h6c.69 0 1.25-.56 1.25-1.25V9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 4 8 8m0-8-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DrawerSkeleton() {
  return (
    <div
      className="space-y-3 px-5 py-5"
      aria-busy="true"
      aria-label="Loading issue detail"
    >
      {[92, 132, 80, 180].map((height) => (
        <div
          key={height}
          style={{ height }}
          className="animate-pulse rounded-xl bg-[var(--surface-subtle)] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function useSpineIssueDetail(issueId: number) {
  const [retryToken, setRetryToken] = useState(0);
  const [view, setView] = useState<DrawerViewState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/service-spine/issue/${issueId}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | SpineIssueApiResponse
          | null;
        if (!active) return;
        if (
          !response.ok ||
          !body ||
          typeof body !== "object" ||
          !("issue" in body)
        ) {
          setView({
            data: null,
            loading: false,
            error:
              response.status === 404
                ? SPINE_ISSUE_NOT_FOUND_COPY
                : SPINE_ISSUE_DETAIL_FAILED_COPY,
          });
          return;
        }
        if (body.issue.id !== issueId) return;
        setView({ data: body, loading: false, error: null });
      } catch {
        if (!active || controller.signal.aborted) return;
        setView({
          data: null,
          loading: false,
          error: SPINE_ISSUE_DETAIL_FAILED_COPY,
        });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [issueId, retryToken]);

  return {
    view,
    retry: useCallback(() => {
      setView({ data: null, loading: true, error: null });
      setRetryToken((value) => value + 1);
    }, []),
  };
}

function TabButton({
  tab,
  selected,
  count,
  tabId,
  panelId,
  onSelect,
  onKeyDown,
  refCallback,
}: {
  tab: { id: DrawerTab; label: string };
  selected: boolean;
  count?: number;
  tabId: string;
  panelId: string;
  onSelect: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  refCallback: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={refCallback}
      type="button"
      role="tab"
      id={tabId}
      tabIndex={selected ? 0 : -1}
      aria-label={`${tab.label}${count !== undefined ? ` (${count})` : ""}`}
      aria-selected={selected}
      aria-controls={panelId}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="spine-drawer-tab"
    >
      {tab.label}
      {count !== undefined ? (
        <span className="tabular-nums text-[10px] text-[var(--muted)]">
          {count.toLocaleString("en-US")}
        </span>
      ) : null}
    </button>
  );
}

function DrawerTabs({
  data,
  nowMs,
}: {
  data: SpineIssueApiResponse;
  nowMs: number;
}) {
  const [tab, setTab] = useState<DrawerTab>("overview");
  const tabsId = useId();
  const tabRefs = useRef(new Map<DrawerTab, HTMLButtonElement>());
  const timelineCount = data.timeline?.totalEvents ?? data.issue.eventCount;
  const counts: Partial<Record<DrawerTab, number>> = {
    tasks: data.tasks.length,
    timeline: timelineCount,
    connections: data.taskLinks.length + (data.issue.accountId ? 1 : 0),
  };

  const moveTab = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: DrawerTab,
  ) => {
    const index = TABS.findIndex((candidate) => candidate.id === current);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const next = TABS[nextIndex]!.id;
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Issue detail sections"
        className="spine-drawer-tabs"
      >
        {TABS.map((candidate) => (
          <TabButton
            key={candidate.id}
            tab={candidate}
            selected={tab === candidate.id}
            count={counts[candidate.id]}
            tabId={`${tabsId}-tab-${candidate.id}`}
            panelId={`${tabsId}-panel-${candidate.id}`}
            onSelect={() => setTab(candidate.id)}
            onKeyDown={(event) => moveTab(event, candidate.id)}
            refCallback={(element) => {
              if (element) tabRefs.current.set(candidate.id, element);
              else tabRefs.current.delete(candidate.id);
            }}
          />
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabsId}-panel-${tab}`}
        aria-labelledby={`${tabsId}-tab-${tab}`}
        className="px-4 py-4 sm:px-5 sm:py-5"
      >
        {tab === "overview" ? (
          <IssueBrief detail={data} nowMs={nowMs} />
        ) : tab === "tasks" ? (
          <IssueTasks tasks={data.tasks} />
        ) : tab === "timeline" ? (
          <IssueTimeline
            timeline={data.timeline}
            timelineError={data.timelineError}
          />
        ) : (
          <IssueConnections issue={data.issue} links={data.taskLinks} />
        )}
      </div>
    </>
  );
}

function DrawerHeader({
  issueId,
  data,
  nowMs,
  titleId,
  onClose,
  closeRef,
}: {
  issueId: number;
  data: SpineIssueApiResponse | null;
  nowMs: number;
  titleId: string;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const issue = data?.issue;
  return (
    <header className="spine-drawer-header">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Service Spine issue</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <h2
            id={titleId}
            className="min-w-0 truncate text-xl font-semibold tracking-[-0.025em] text-[var(--ink)]"
          >
            {issue?.accountId ? (
              <Link
                href={`/accounts/${issue.accountId}`}
                className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {issue.companyName ?? issue.accountId}
              </Link>
            ) : (
              (issue?.companyName ?? `Issue #${issueId}`)
            )}
          </h2>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tabular-nums text-[var(--muted)]">
            Issue #{issueId}
          </span>
          {issue ? (
            <>
              <SpinePriorityBadge priority={issue.priority} />
              <SpineStatusPill status={issue.status} />
              <SpineSlaChip
                slaDueAt={issue.slaDueAt}
                status={issue.status}
                nowMs={nowMs}
                compact
              />
            </>
          ) : null}
        </div>
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close issue detail"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--rule)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span className="h-4 w-4">
          <CloseIcon />
        </span>
      </button>
    </header>
  );
}

function DrawerContent({
  issueId,
  view,
  retry,
  nowMs,
}: {
  issueId: number;
  view: DrawerViewState;
  retry: () => void;
  nowMs: number;
}) {
  if (view.loading && !view.data) return <DrawerSkeleton />;
  if (view.error && !view.data) {
    return (
      <div className="px-5 py-5">
        <div
          role="alert"
          className="rounded-xl border border-[var(--rule)] bg-[var(--surface)] px-4 py-4"
        >
          <p className="text-sm font-semibold text-[var(--ink)]">
            Issue detail unavailable
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {view.error}
          </p>
          <button
            type="button"
            onClick={retry}
            className="btn-ghost mt-3 min-h-10 px-3 text-xs"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!view.data) return null;
  return (
    <div key={issueId}>
      <DrawerTabs data={view.data} nowMs={nowMs} />
    </div>
  );
}

function SpineIssueDrawerPanel({
  issueId,
  onClose,
}: {
  issueId: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { view, retry } = useSpineIssueDetail(issueId);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    const portalLayer = dialogRef.current?.parentElement ?? null;
    const inerted = Array.from(document.body.children)
      .filter((element) => element !== portalLayer)
      .map((element) => {
        const html = element as HTMLElement;
        const previousInert = html.inert;
        const previousHidden = html.getAttribute("aria-hidden");
        html.inert = true;
        html.setAttribute("aria-hidden", "true");
        return { html, previousInert, previousHidden };
      });

    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = focusableElements(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.removeEventListener("keydown", onKeyDown);
      for (const { html, previousInert, previousHidden } of inerted) {
        html.inert = Boolean(previousInert);
        if (previousHidden === null) html.removeAttribute("aria-hidden");
        else html.setAttribute("aria-hidden", previousHidden);
      }
      window.requestAnimationFrame(() => {
        const triggers = Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-spine-issue-trigger="${issueId}"]`,
          ),
        );
        const visible = triggers.find((element) => element.offsetParent !== null);
        (visible ?? triggers[0])?.focus();
      });
    };
  }, [issueId, onClose]);

  return (
    <div
      className="spine-drawer-backdrop fixed inset-0 z-[110]"
      data-spine-drawer-backdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="spine-drawer-panel"
      >
        <DrawerHeader
          issueId={issueId}
          data={view.data}
          nowMs={nowMs}
          titleId={titleId}
          onClose={onClose}
          closeRef={closeRef}
        />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <DrawerContent
            issueId={issueId}
            view={view}
            retry={retry}
            nowMs={nowMs}
          />
        </div>

        <footer className="spine-drawer-footer">
          <p className="text-[11px] leading-4 text-[var(--muted)]">
            Actions are managed in Actions Workbench.
          </p>
          <a
            href={ACTIONS_WORKBENCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Open Actions Workbench
            <ExternalLinkIcon />
          </a>
        </footer>
      </div>
    </div>
  );
}

export function SpineIssueDrawer() {
  const { requested, update } = useSpineFilters();
  const issueId = requested.issue;
  const close = useCallback(
    () => update({ issue: null }, { history: "push" }),
    [update],
  );

  if (issueId === null || typeof document === "undefined") return null;
  return createPortal(
    <SpineIssueDrawerPanel key={issueId} issueId={issueId} onClose={close} />,
    document.body,
  );
}
