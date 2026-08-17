"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The single authoritative state of an account row. Preview visibility, panel
 * visibility, clipping and ARIA are all derived from this phase, so the row can
 * never settle into a state that shows the compact outside previews and the
 * full inside note cards at the same time.
 */
export type AccountRowPhase =
  | "collapsed"
  | "expanding"
  | "expanded"
  | "collapsing";

/**
 * Wall-clock length of the coordinated choreography, measured to the end of the
 * slowest track. Keep in sync with the --acct-* timings in globals.css.
 */
export const ACCOUNT_ROW_EXPAND_MS = 320;
export const ACCOUNT_ROW_COLLAPSE_MS = 280;

export function isAccountRowOpen(phase: AccountRowPhase): boolean {
  return phase === "expanding" || phase === "expanded";
}

/** The order panel keeps its children while it animates shut. */
export function accountRowPanelMounted(phase: AccountRowPhase): boolean {
  return phase !== "collapsed";
}

/** The compact previews keep rendering while they animate out. */
export function accountRowPreviewsMounted(phase: AccountRowPhase): boolean {
  return phase !== "expanded";
}

/** Exiting content stays painted but leaves the a11y tree and the Tab order. */
export function accountRowPreviewsActive(phase: AccountRowPhase): boolean {
  return phase === "collapsed" || phase === "collapsing";
}

export function accountRowPanelActive(phase: AccountRowPhase): boolean {
  return phase === "expanding" || phase === "expanded";
}

export function settledAccountRowPhase(
  phase: AccountRowPhase,
): AccountRowPhase {
  if (phase === "expanding") return "expanded";
  if (phase === "collapsing") return "collapsed";
  return phase;
}

export function accountRowPhaseDurationMs(phase: AccountRowPhase): number {
  if (phase === "expanding") return ACCOUNT_ROW_EXPAND_MS;
  if (phase === "collapsing") return ACCOUNT_ROW_COLLAPSE_MS;
  return 0;
}

/**
 * Interruptible by construction: a toggle mid-flight re-enters the opposite
 * transitional phase, and the CSS transitions pick up from wherever they are.
 */
export function nextAccountRowPhase(
  phase: AccountRowPhase,
  open: boolean,
  animate: boolean,
): AccountRowPhase {
  if (!animate) return open ? "expanded" : "collapsed";
  if (open) return phase === "expanded" ? "expanded" : "expanding";
  return phase === "collapsed" ? "collapsed" : "collapsing";
}

/**
 * Animation phase for a row whose open/closed state is owned by the list.
 *
 * The row no longer decides whether it is open — the page's expanded-id set
 * does — so this only translates that boolean into the four-phase choreography
 * and settles it when the CSS finishes. Driving it from a prop is what lets
 * Close all accounts collapse a dozen rows in one batched update.
 */
export function useAccountRowPhase(open: boolean): AccountRowPhase {
  const [phase, setPhase] = useState<AccountRowPhase>(
    open ? "expanded" : "collapsed",
  );
  const animateRef = useRef(true);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    animateRef.current = !query.matches;
    const onChange = (event: MediaQueryListEvent) => {
      animateRef.current = !event.matches;
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Mount is a no-op: nextAccountRowPhase returns the resting phase it is
  // already in, so an initially-open row never plays an entrance.
  useEffect(() => {
    setPhase((current) =>
      nextAccountRowPhase(current, open, animateRef.current),
    );
  }, [open]);

  useEffect(() => {
    if (phase !== "expanding" && phase !== "collapsing") return;
    const timer = window.setTimeout(
      () => setPhase(settledAccountRowPhase(phase)),
      accountRowPhaseDurationMs(phase),
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  return phase;
}
