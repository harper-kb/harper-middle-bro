"use client";

import type { Route } from "next";
import Link from "next/link";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type KpiStat = {
  label: string;
  value: number | string;
  /** Number tint — labels always carry the meaning, never color alone. */
  tone?: "neutral" | "bound" | "pending" | "lost";
  /** Distinct account count shown in the accessible status tooltip. */
  tooltipAccountCount?: number;
  /** When set, the whole stat becomes a link to the relevant view. */
  href?: Route;
  /** Concise native tooltip for definitions/coverage that need explanation. */
  tooltip?: string;
};

const KPI_TONES: Record<NonNullable<KpiStat["tone"]>, string> = {
  neutral: "text-[var(--ink)]",
  bound: "text-emerald-600 dark:text-emerald-400",
  pending: "text-[var(--accent)]",
  lost: "text-rose-500/80 dark:text-rose-400/70",
};

type TooltipPosition = {
  left: number;
  top: number;
  arrowOffset: number;
};

function AccountCountTooltip({
  count,
  id,
  open,
  triggerRef,
}: {
  count: number;
  id: string;
  open: boolean;
  triggerRef: RefObject<HTMLAnchorElement | null>;
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const metricCenter = triggerRect.left + triggerRect.width / 2;
      const edgeGap = 8;
      const halfWidth = tooltipRect.width / 2;
      const left = Math.min(
        window.innerWidth - halfWidth - edgeGap,
        Math.max(halfWidth + edgeGap, metricCenter),
      );

      setPosition({
        left,
        top: Math.max(tooltipRect.height + edgeGap, triggerRect.top - 9),
        arrowOffset: Math.max(
          -halfWidth + 12,
          Math.min(halfWidth - 12, metricCenter - left),
        ),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, triggerRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <span
      className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <span
        ref={tooltipRef}
        id={id}
        role="tooltip"
        className="relative block animate-[rise-in_140ms_ease-out] whitespace-nowrap rounded-[5px] border border-[var(--border)] !bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs !text-[var(--foreground)] shadow-[0_6px_18px_color-mix(in_srgb,var(--shadow-color)_28%,transparent)]"
      >
        <strong className="font-semibold tabular-nums">
          {count.toLocaleString()}
        </strong>{" "}
        {count === 1 ? "account" : "accounts"}
        <span
          aria-hidden="true"
          className="absolute -bottom-[4px] left-1/2 size-[7px] -translate-x-1/2 rotate-45 border-b border-r border-[var(--border)] !bg-[var(--surface-raised)]"
          style={{
            marginLeft: position?.arrowOffset ?? 0,
          }}
        />
      </span>
    </span>,
    document.body,
  );
}

function StatBlock({ stat, divided }: { stat: KpiStat; divided: boolean }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const hasTooltip = stat.tooltipAccountCount !== undefined;

  const content: ReactNode = (
    <>
      <span
        className={`text-2xl font-semibold leading-tight tabular-nums ${
          KPI_TONES[stat.tone ?? "neutral"]
        }`}
      >
        {typeof stat.value === "number"
          ? stat.value.toLocaleString()
          : stat.value}
      </span>
      <span
        className={`text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] ${
          hasTooltip
            ? "underline decoration-[var(--rule)] decoration-dotted underline-offset-4 transition-colors group-hover:text-[var(--ink)] group-hover:decoration-[var(--muted)]"
            : ""
        }`}
      >
        {stat.label}
      </span>
    </>
  );

  const baseClasses = `relative flex min-w-fit flex-col gap-0.5 pr-6 ${
    divided ? "border-l border-[var(--rule)] pl-6" : ""
  }`;

  if (stat.href) {
    return (
      <Link
        ref={triggerRef}
        href={stat.href}
        className={`${baseClasses} group rounded-lg no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
        aria-describedby={hasTooltip && open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event: KeyboardEvent<HTMLAnchorElement>) => {
          if (event.key === "Escape") setOpen(false);
        }}
        onPointerDown={(event: PointerEvent<HTMLAnchorElement>) => {
          if (event.pointerType === "touch") setOpen(true);
        }}
      >
        {content}
        {hasTooltip ? (
          <AccountCountTooltip
            count={stat.tooltipAccountCount!}
            id={tooltipId}
            open={open}
            triggerRef={triggerRef}
          />
        ) : null}
      </Link>
    );
  }

  return (
    <div
      className={`${baseClasses} ${stat.tooltip ? "cursor-help rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" : ""}`}
      title={stat.tooltip}
      tabIndex={stat.tooltip ? 0 : undefined}
    >
      {content}
    </div>
  );
}

/**
 * Compact stat strip under the account view titles. Stats with an `href` are
 * links to the matching filtered view; their `tooltip` (distinct account
 * count) shows on hover or keyboard focus and never blocks the click.
 */
export function KpiStrip({ stats }: { stats: KpiStat[] }) {
  // No overflow clipping here: tooltips render outside the strip's box, and
  // flex-wrap already keeps narrow screens tidy.
  return (
    <div className="flex flex-wrap items-start gap-y-3">
      {stats.map((stat, index) => (
        <StatBlock key={stat.label} stat={stat} divided={index > 0} />
      ))}
    </div>
  );
}
