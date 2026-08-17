"use client";

import { useEffect, type RefObject } from "react";

export const TOP_NAV_HEIGHT_PROPERTY = "--top-nav-height";
export const TOP_NAV_BOTTOM_PROPERTY = "--top-nav-bottom";
export const TOP_NAV_METRICS_EVENT = "step-bro:top-nav-metrics";

export type TopNavMetricsEventDetail = {
  height: number;
  bottom: number;
};

export type TopNavMetrics = {
  height: number;
  bottom: number;
};

/** Preserve fractional CSS pixels; integer offsetHeight values drift at zoom. */
export function visibleTopNavMetrics(
  elements: readonly (HTMLElement | null)[],
): TopNavMetrics | null {
  for (const element of elements) {
    if (!element || element.getClientRects().length === 0) continue;
    const { height, bottom } = element.getBoundingClientRect();
    if (
      Number.isFinite(height) &&
      height > 0 &&
      Number.isFinite(bottom) &&
      bottom > 0
    ) {
      return { height, bottom };
    }
  }
  return null;
}

/**
 * The top navigation owns the authoritative border-box height and viewport
 * bottom edge consumed by sticky page chrome. Using its actual bottom avoids
 * reconstructing that edge from independently rounded height/top values.
 */
export function TopNavHeightSync({
  desktopRef,
  mobileRef,
}: {
  desktopRef: RefObject<HTMLElement | null>;
  mobileRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const elements = [desktopRef.current, mobileRef.current];
    let measuredHeight = -1;
    let measuredBottom = -1;

    const sync = () => {
      const metrics = visibleTopNavMetrics(elements);
      if (
        metrics === null ||
        (Math.abs(metrics.height - measuredHeight) < 0.01 &&
          Math.abs(metrics.bottom - measuredBottom) < 0.01)
      ) {
        return;
      }
      const { height, bottom } = metrics;
      measuredHeight = height;
      measuredBottom = bottom;
      document.documentElement.style.setProperty(
        TOP_NAV_HEIGHT_PROPERTY,
        `${height}px`,
      );
      document.documentElement.style.setProperty(
        TOP_NAV_BOTTOM_PROPERTY,
        `${bottom}px`,
      );
      window.dispatchEvent(
        new CustomEvent<TopNavMetricsEventDetail>(TOP_NAV_METRICS_EVENT, {
          detail: { height, bottom },
        }),
      );
    };

    sync();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    for (const element of elements) {
      if (element) resize?.observe(element);
    }
    window.addEventListener("resize", sync);

    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [desktopRef, mobileRef]);

  return null;
}
