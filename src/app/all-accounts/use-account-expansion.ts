"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * One authoritative collection of expanded account ids for a results page.
 *
 * Everything the focus mode needs — which rows are sharp, which are softened,
 * whether Close all accounts is offered — is derived from this set, so a row can
 * never disagree with the toolbar about what is open.
 */
export type ExpandedAccountIds = ReadonlySet<string>;

export const NO_EXPANDED_ACCOUNTS: ExpandedAccountIds = new Set<string>();

export function toggleExpandedAccount(
  current: ExpandedAccountIds,
  id: string,
): ExpandedAccountIds {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Drop ids the current result page no longer contains. Returns the same set
 * when nothing changed so callers can bail out of a re-render, and so a
 * filter/search/page change can never leave a new page softened by an account
 * that is not on it.
 */
export function pruneExpandedAccounts(
  current: ExpandedAccountIds,
  visibleIds: ExpandedAccountIds,
): ExpandedAccountIds {
  if (current.size === 0) return current;
  const kept = [...current].filter((id) => visibleIds.has(id));
  return kept.length === current.size ? current : new Set(kept);
}

/** Focus mode is on precisely when at least one visible account is open. */
export function isFocusModeActive(expanded: ExpandedAccountIds): boolean {
  return expanded.size > 0;
}

/** A row is softened only when some *other* account is holding attention. */
export function isAccountDeemphasized(
  expanded: ExpandedAccountIds,
  id: string,
): boolean {
  return expanded.size > 0 && !expanded.has(id);
}

export function useAccountExpansion(
  visibleIds: readonly string[],
  /** Preview/test seam; production lists always start fully collapsed. */
  initialExpandedIds: readonly string[] = [],
) {
  const [stored, setStored] = useState<ExpandedAccountIds>(() =>
    initialExpandedIds.length === 0
      ? NO_EXPANDED_ACCOUNTS
      : new Set(initialExpandedIds),
  );
  const visibleKey = visibleIds.join("\u0000");
  const visibleSet = useMemo(
    () => new Set(visibleIds),
    // Rebuilt only when the page's ids actually change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleKey],
  );

  // Derived rather than synced: a stale id cannot survive even one paint after
  // the result set changes, which is what would otherwise blur a fresh page.
  const expanded = useMemo(
    () => pruneExpandedAccounts(stored, visibleSet),
    [stored, visibleSet],
  );

  const toggleRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const registerToggle = useCallback(
    (id: string, node: HTMLButtonElement | null) => {
      if (node) toggleRefs.current.set(id, node);
      else toggleRefs.current.delete(id);
    },
    [],
  );

  const toggle = useCallback((id: string) => {
    setStored((current) => toggleExpandedAccount(current, id));
  }, []);

  const expand = useCallback((id: string) => {
    setStored((current) =>
      current.has(id) ? current : toggleExpandedAccount(current, id),
    );
  }, []);

  /**
   * One batched update, so every row starts its collapse on the same frame
   * instead of cascading. Focus lands on the first closed account's toggle
   * because the button the user just pressed is about to unmount.
   */
  const closeAll = useCallback(() => {
    const first = [...expanded][0];
    setStored(NO_EXPANDED_ACCOUNTS);
    if (first) toggleRefs.current.get(first)?.focus();
  }, [expanded]);

  return {
    expanded,
    focusMode: isFocusModeActive(expanded),
    toggle,
    expand,
    closeAll,
    registerToggle,
  };
}
