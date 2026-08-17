"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { CompanySearchResponse } from "@/app/api/company-search/route";
import type { CompanySearchResult } from "@/lib/db/queries/company-search";

/**
 * The one search state machine behind both presentations of global company
 * search — the inline field in the operational bar and the centered palette.
 *
 * Everything that decides *what* the operator sees lives here: the debounce,
 * the stale-response guard, the derived view, the highlighted row and the
 * account navigation. The two presentations own only layout and chrome, so
 * they cannot drift apart on behaviour or return different results for the
 * same query.
 */

export const COMPANY_SEARCH_MIN_QUERY = 2;

const DEBOUNCE_MS = 250;

/**
 * Every settled state carries the query it describes, so a response that
 * arrives after the operator has typed on is recognised as stale and masked
 * rather than rendered under the newer query.
 */
type SettledState =
  | { status: "idle" }
  | { status: "error"; query: string }
  | {
      status: "ready";
      query: string;
      results: CompanySearchResult[];
      lastSuccessfulSyncAt: string | null;
    };

export type CompanySearchView = SettledState | { status: "loading" };

/**
 * Shared so an empty result set keeps the same identity between renders — an
 * inline `[]` would make every callback that depends on results unstable.
 */
const NO_RESULTS: readonly CompanySearchResult[] = [];

/** Why the surface is going away — the caller decides where focus lands. */
export type CompanySearchDismissal = "escape" | "navigate";

export interface CompanySearchController {
  query: string;
  setQuery: (value: string) => void;
  /** Empties the box; results disappear on the same keystroke. */
  clear: () => void;
  view: CompanySearchView;
  results: readonly CompanySearchResult[];
  activeIndex: number;
  highlight: (index: number) => void;
  listboxId: string;
  optionId: (index: number) => string;
  activeDescendant: string | undefined;
  /** Arrow / Enter / Escape, identical in both presentations. */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Called by a result row once its link has taken the navigation. */
  handleResultClick: () => void;
  lastSuccessfulSyncAt: string | null;
}

export function useCompanySearch({
  onDismiss,
}: {
  onDismiss: (reason: CompanySearchDismissal) => void;
}): CompanySearchController {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SettledState>({ status: "idle" });
  const [highlighted, setHighlighted] = useState(-1);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = useCallback(
    (index: number) => `${baseId}-option-${index}`,
    [baseId],
  );

  const trimmedQuery = query.trim();

  // The view is derived, never stored: an emptied box hides results on the
  // keystroke rather than after the debounce, and a query the settled state
  // does not describe reads as loading instead of showing the previous hits.
  const describesQuery =
    trimmedQuery.length >= COMPANY_SEARCH_MIN_QUERY &&
    state.status !== "idle" &&
    state.query === trimmedQuery;

  const view: CompanySearchView =
    trimmedQuery.length < COMPANY_SEARCH_MIN_QUERY
      ? { status: "idle" }
      : describesQuery
        ? state
        : { status: "loading" };

  const results =
    describesQuery && state.status === "ready" ? state.results : NO_RESULTS;
  // Guards the window between a shorter result list arriving and the fetch
  // callback resetting the highlight.
  const activeIndex = Math.min(highlighted, results.length - 1);

  // Debounced live search. The abort both cancels the request the operator has
  // typed past and marks its response stale, so a slow reply for an older
  // query can never land on top of a newer one.
  useEffect(() => {
    if (trimmedQuery.length < COMPANY_SEARCH_MIN_QUERY) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/company-search?q=${encodeURIComponent(trimmedQuery)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!response.ok) throw new Error(`status ${response.status}`);
          const body = (await response.json()) as CompanySearchResponse;
          setState({
            status: "ready",
            query: trimmedQuery,
            results: body.results,
            lastSuccessfulSyncAt: body.lastSuccessfulSyncAt,
          });
          setHighlighted(body.results.length > 0 ? 0 : -1);
        } catch {
          if (controller.signal.aborted) return;
          setState({ status: "error", query: trimmedQuery });
          setHighlighted(-1);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(optionId(activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, optionId]);

  // Idempotent: collapsing an already-empty field must not cost a render.
  const clear = useCallback(() => {
    setQuery("");
    setState((current) =>
      current.status === "idle" ? current : { status: "idle" },
    );
    setHighlighted(-1);
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss("escape");
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (results.length === 0) return;
        event.preventDefault();
        const next =
          event.key === "ArrowDown" ? activeIndex + 1 : activeIndex - 1;
        setHighlighted(
          next < 0 ? results.length - 1 : next >= results.length ? 0 : next,
        );
        return;
      }
      if (event.key === "Enter") {
        const result = results[activeIndex];
        if (!result) return;
        event.preventDefault();
        // The same stable-id destination the row's link points at, so keyboard
        // and pointer land on exactly one account route.
        router.push(`/accounts/${result.id}`);
        onDismiss("navigate");
      }
    },
    [activeIndex, onDismiss, results, router],
  );

  const handleResultClick = useCallback(
    () => onDismiss("navigate"),
    [onDismiss],
  );

  return {
    query,
    setQuery,
    clear,
    view,
    results,
    activeIndex,
    highlight: setHighlighted,
    listboxId,
    optionId,
    activeDescendant: activeIndex >= 0 ? optionId(activeIndex) : undefined,
    handleKeyDown,
    handleResultClick,
    lastSuccessfulSyncAt:
      view.status === "ready" ? view.lastSuccessfulSyncAt : null,
  };
}
