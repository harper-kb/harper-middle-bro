"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  DAILY_STATS_SNAPSHOT_HEIGHT,
  DAILY_STATS_SNAPSHOT_WIDTH,
} from "@/components/daily-stats-snapshot/DailyStatsSnapshotCard";
import {
  dailyStatsSnapshotAltText,
  dailyStatsSnapshotFilename,
  formatCapturedMetadata,
  type DailyStatsSnapshot,
} from "@/lib/daily-stats-snapshot";
import {
  copyPngBlobToClipboard,
  createDailyStatsSnapshotRenderJob,
  type ClipboardCopyOutcome,
  type DailyStatsSnapshotRenderJob,
} from "@/lib/daily-stats-snapshot-image";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
const pendingRenderAborts = new WeakMap<AbortController, number>();

type InertElement = HTMLElement & { inert: boolean };
type Phase = "generating" | "ready" | "error";
type CopyRecord = {
  outcome: ClipboardCopyOutcome;
  attempt: "automatic" | "explicit";
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <rect x="6.5" y="5.5" width="9" height="10" rx="2" />
      <path d="M4.5 13.5h-.25A1.75 1.75 0 0 1 2.5 11.75v-7.5A1.75 1.75 0 0 1 4.25 2.5h7.5A1.75 1.75 0 0 1 13.5 4.25v.25" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16.5h12" />
    </svg>
  );
}

function copyStatus(record: CopyRecord | null, copying: boolean): string {
  if (copying) return "Copying image…";
  if (!record) return "Image ready";
  if (record.outcome.status === "success") return "Copied to clipboard";
  if (record.outcome.status === "unsupported") {
    return "Image copying isn’t supported here";
  }
  if (record.attempt === "automatic") return "Ready to copy";
  if (record.outcome.status === "denied") {
    return "Clipboard access was denied";
  }
  return "Couldn’t copy image";
}

export function DailyStatsSnapshotDialog({
  snapshot,
  initialJob,
  onClose,
}: {
  snapshot: DailyStatsSnapshot;
  initialJob: DailyStatsSnapshotRenderJob;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const renderingRef = useRef(true);
  const copyingRef = useRef(false);
  const [job, setJob] = useState(initialJob);
  const [phase, setPhase] = useState<Phase>("generating");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [copyRecord, setCopyRecord] = useState<CopyRecord | null>(null);
  const [copying, setCopying] = useState(false);

  // Freeze the application behind one portal and preserve any pre-existing
  // inert/scroll-lock ownership for layers that close immediately beforehand.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const subdued = new Map<
      InertElement,
      { hadInert: boolean; ariaHidden: string | null }
    >();
    const subdue = (node: Element) => {
      if (!(node instanceof HTMLElement) || node === overlay) return;
      // The idle brand experience remains the one layer allowed to outrank the
      // snapshot if it was already opening during this portal's commit.
      if (node.hasAttribute("data-idle-brand-overlay")) return;
      const element = node as InertElement;
      if (subdued.has(element)) return;
      subdued.set(element, {
        hadInert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.inert = true;
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    };

    for (const child of document.body.children) subdue(child);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) subdue(node);
        }
      }
    });
    observer.observe(document.body, { childList: true });

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const ownsBodyLock = previousOverflow !== "hidden";
    const clientWidth = document.documentElement.clientWidth;
    const scrollbar = clientWidth > 0 ? window.innerWidth - clientWidth : 0;
    if (ownsBodyLock) {
      document.body.style.overflow = "hidden";
      if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    }

    return () => {
      observer.disconnect();
      for (const [element, previous] of subdued) {
        element.inert = previous.hadInert;
        if (previous.hadInert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", previous.ariaHidden);
      }
      if (ownsBodyLock) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== "Tab") {
        if (!overlay.contains(event.target as Node)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeRef.current?.focus();
        }
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableElements(panel);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!overlay.contains(event.target as Node)) closeRef.current?.focus();
    };
    const stopBackgroundShortcuts = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") {
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    overlay.addEventListener("keydown", stopBackgroundShortcuts);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      overlay.removeEventListener("keydown", stopBackgroundShortcuts);
    };
  }, [close]);

  useEffect(() => {
    const pendingAbort = pendingRenderAborts.get(job.abortController);
    if (pendingAbort !== undefined) {
      window.clearTimeout(pendingAbort);
      pendingRenderAborts.delete(job.abortController);
    }
    let active = true;
    let previewUrl: string | null = null;

    void (async () => {
      try {
        const blob = await job.blobPromise;
        if (!active) return;
        previewUrl = URL.createObjectURL(blob);
        setImage({ blob, url: previewUrl });
        setPhase("ready");
        renderingRef.current = false;
        const outcome = await job.automaticCopyPromise;
        if (active) setCopyRecord({ outcome, attempt: "automatic" });
      } catch (error) {
        if (
          !active ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        renderingRef.current = false;
        setPhase("error");
      }
    })();

    return () => {
      active = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      // React development StrictMode replays setup → cleanup → setup. Defer
      // cancellation one task so the replay can claim this same job;
      // a real unmount has no newer effect version and still aborts promptly.
      const abortTimer = window.setTimeout(() => {
        pendingRenderAborts.delete(job.abortController);
        job.abortController.abort();
      }, 0);
      pendingRenderAborts.set(job.abortController, abortTimer);
    };
  }, [job]);

  const retryGeneration = () => {
    if (renderingRef.current) return;
    renderingRef.current = true;
    job.abortController.abort();
    setPhase("generating");
    setImage(null);
    setCopyRecord(null);
    setJob(createDailyStatsSnapshotRenderJob(snapshot));
  };

  const copyImage = async () => {
    if (!image || copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    const outcome = await copyPngBlobToClipboard(image.blob);
    setCopyRecord({ outcome, attempt: "explicit" });
    copyingRef.current = false;
    setCopying(false);
  };

  if (typeof document === "undefined") return null;

  const liveMessage =
    phase === "generating"
      ? "Generating high-quality PNG…"
      : phase === "error"
        ? "Snapshot generation failed"
        : copyStatus(copyRecord, copying);
  const altText = dailyStatsSnapshotAltText(snapshot);

  return createPortal(
    <div
      ref={overlayRef}
      data-daily-stats-snapshot-backdrop
      className="daily-stats-snapshot-backdrop fixed inset-0 z-[150] flex items-center justify-center overflow-y-auto p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="daily-stats-snapshot-panel my-auto flex w-full max-w-[48rem] flex-col overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-[0_30px_90px_color-mix(in_srgb,var(--shadow-color)_68%,transparent)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--rule)] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p className="eyebrow">Daily snapshot</p>
            <h2
              id={titleId}
              className="mt-1 text-lg font-semibold tracking-[-0.015em] text-[var(--ink)]"
            >
              Daily stats snapshot
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-xs leading-5 text-[var(--muted)]"
            >
              Preview the exact PNG available to copy or download.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close daily stats snapshot"
            title="Close"
            className="daily-stats-snapshot-close flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--rule)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mb-3 flex min-h-7 items-center gap-2 text-xs font-semibold text-[var(--muted)]"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                phase === "error"
                  ? "bg-[var(--danger)]"
                  : copyRecord?.outcome.status === "success"
                    ? "bg-[var(--success)]"
                    : phase === "generating"
                      ? "bg-[var(--accent)] motion-safe:animate-pulse"
                      : "bg-[var(--info)]"
              }`}
            />
            {liveMessage}
          </div>

          <div className="daily-stats-snapshot-preview relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--rule)] bg-[#0b1822]">
            {phase === "generating" ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <span
                    aria-hidden="true"
                    className="mx-auto block h-8 w-8 rounded-xl border border-[#ff7067]/40 bg-[#ff7067]/10 motion-safe:animate-pulse"
                  />
                  <p className="mt-3 text-xs font-semibold text-slate-300">
                    Building your snapshot…
                  </p>
                </div>
              </div>
            ) : null}
            {phase === "error" ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Couldn’t generate the snapshot
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-5 text-slate-400">
                    The frozen stats are still safe. Retry the image render, or
                    close and try again.
                  </p>
                  <button
                    type="button"
                    onClick={retryGeneration}
                    className="mt-4 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7067]"
                  >
                    Retry generation
                  </button>
                </div>
              </div>
            ) : null}
            {image ? (
              // This object URL points at the same blob passed to ClipboardItem
              // and exposed by the download link below.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
                alt={altText}
                width={DAILY_STATS_SNAPSHOT_WIDTH}
                height={DAILY_STATS_SNAPSHOT_HEIGHT}
                className="daily-stats-snapshot-image h-full w-full object-contain"
              />
            ) : null}
          </div>

          <div className="mt-3 flex flex-col gap-1 text-xs text-[var(--muted)] sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div>
              <p className="font-semibold text-[var(--ink)]">
                Snapshot for {snapshot.selectedDateLabel}
              </p>
              <p className="mt-0.5">
                Captured {formatCapturedMetadata(snapshot)}
              </p>
            </div>
            {snapshot.dataUpdatedAt ? (
              <p className="shrink-0">Uses the displayed database revision</p>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--rule)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          {image ? (
            <a
              href={image.url}
              download={dailyStatsSnapshotFilename(snapshot)}
              className="btn-ghost inline-flex min-h-9 items-center justify-center gap-2 px-3 text-xs"
            >
              <DownloadIcon />
              Download PNG
            </a>
          ) : (
            <span />
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="btn-ghost min-h-9 px-3 text-xs"
            >
              Close
            </button>
            {image ? (
              <button
                type="button"
                onClick={() => void copyImage()}
                disabled={copying}
                className="btn-primary inline-flex min-h-9 items-center justify-center gap-2 px-3 text-xs disabled:pointer-events-none disabled:opacity-55"
              >
                <CopyIcon />
                Copy image
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
