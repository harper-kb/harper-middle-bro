"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Fixed redesigned card slot, with four rows of overscan. The slot is roomy
 * enough for a three-line goal without cards changing height mid-scroll. */
export const SPINE_ROW_ESTIMATE_PX = 190;
export const SPINE_OVERSCAN_ROWS = 4;

/**
 * Used before the container is measured (server render, jsdom) so the first
 * paint carries a sensible slice instead of nothing.
 */
const FALLBACK_VIEWPORT_PX = 608;

export type WindowedList = {
  containerRef: (element: HTMLDivElement | null) => void;
  onScroll: () => void;
  /** First rendered row index (inclusive). */
  start: number;
  /** Last rendered row index (exclusive). */
  end: number;
  totalHeight: number;
  rowHeight: number;
  offsetFor: (index: number) => number;
};

/**
 * Simple dependency-free fixed-estimate windowing for a bounded scroll
 * region: one absolutely positioned row per item, `rowEstimate` px each,
 * `overscan` rows painted beyond both edges. No measurement feedback loop —
 * cards render inside a fixed-height slot, which is exactly how the source
 * board virtualizes.
 */
export function useWindowedList({
  count,
  rowEstimate = SPINE_ROW_ESTIMATE_PX,
  overscan = SPINE_OVERSCAN_ROWS,
}: {
  count: number;
  rowEstimate?: number;
  overscan?: number;
}): WindowedList {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT_PX);

  const containerRef = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const height = elementRef.current?.clientHeight ?? 0;
      // jsdom and unmounted refs measure 0 — keep the fallback estimate.
      if (height > 0) setViewport(height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const onScroll = useCallback(() => {
    const element = elementRef.current;
    if (element) setScrollTop(element.scrollTop);
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / rowEstimate) - overscan);
  const end = Math.min(
    count,
    Math.ceil((scrollTop + viewport) / rowEstimate) + overscan,
  );

  return {
    containerRef,
    onScroll,
    start,
    end,
    totalHeight: count * rowEstimate,
    rowHeight: rowEstimate,
    offsetFor: (index: number) => index * rowEstimate,
  };
}
