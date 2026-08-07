import type { ReactNode } from "react";

/**
 * Collapsible section shell for the desk — the "collapse by default, count
 * in the header" pattern. Server-friendly: plain <details>/<summary> styled
 * on the existing .disclosure recipe, so a collapsed section still says
 * what's inside ("Escalations · 2 Open") without any client state.
 */
export function DeskSection({
  title,
  count,
  summary,
  defaultOpen = false,
  action,
  flush = false,
  children,
}: {
  /** Section heading, Title Case. */
  title: string;
  /** Bare count chip — used when `summary` is not given. */
  count?: number;
  /** Summary chip, e.g. "2 Open" — wins over `count`. */
  summary?: string;
  defaultOpen?: boolean;
  /** Optional right-side slot (button, link) on the header row. */
  action?: ReactNode;
  /** Body without inner padding, for tables that run edge to edge. */
  flush?: boolean;
  children: ReactNode;
}) {
  const chip = summary ?? (count != null ? String(count) : null);
  return (
    <details
      className="disclosure desk-section"
      open={defaultOpen || undefined}
    >
      <summary className="flex flex-wrap items-center gap-2.5 px-4 py-3">
        <span className="disclosure-caret text-xs text-[var(--muted)]" aria-hidden>
          ›
        </span>
        <span className="text-sm font-semibold text-[var(--ink)]">{title}</span>
        {chip != null && <span className="chip tabular-nums">{chip}</span>}
        {action != null && (
          <span className="ml-auto flex items-center gap-2">{action}</span>
        )}
      </summary>
      <div
        className={
          flush
            ? "border-t border-[var(--rule)]"
            : "border-t border-[var(--rule)] px-4 py-4"
        }
      >
        {children}
      </div>
    </details>
  );
}
