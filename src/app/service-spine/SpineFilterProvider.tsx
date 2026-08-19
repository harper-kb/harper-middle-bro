"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import {
  clearSpineFilters,
  spineFilterHref,
  spineFilterKey,
  updateSpineFilters,
  type SpineFilterPatch,
  type SpineFilterState,
} from "./spine-filter-state";

/**
 * One client-side owner of "what the operator has asked for" — the Records
 * provider pattern applied to the spine.
 *
 * The URL stays the durable state; this only closes the window between a
 * filter click and the server render that answers it. Every control merges its
 * change into the newest requested state rather than into the props it was
 * rendered with, so two rapid changes compose instead of overwriting.
 *
 * Filter rendering still comes from the server state (`state`), so nothing
 * here can put a filter on screen that the visible rows were not queried
 * with. The one deliberate exception is `requested`: the drawer keys off the
 * newest requested `issue`, because its content is client-fetched — opening
 * and closing must not wait a server round-trip.
 */

type SpineNavigationOptions = {
  /**
   * `replace` for high-frequency text entry, so typing costs no history
   * entries; `push` for deliberate changes the operator expects Back to undo
   * (including opening and closing the drawer).
   */
  history?: "push" | "replace";
};

type SpineFilterContextValue = {
  /** The state the visible rows were queried with. */
  state: SpineFilterState;
  /** The newest state the operator has asked for, server render or not. */
  requested: SpineFilterState;
  latest: () => SpineFilterState;
  update: (
    patch: SpineFilterPatch | ((state: SpineFilterState) => SpineFilterPatch),
    options?: SpineNavigationOptions,
  ) => void;
  clear: () => void;
  /** Canonical href for a change, built from the newest requested state. */
  hrefFor: (patch: SpineFilterPatch) => string;
  isPending: boolean;
};

const SpineFilterContext = createContext<SpineFilterContextValue | null>(null);

type StoreSnapshot = {
  acceptedKey: string;
  state: SpineFilterState;
  children: ReactNode;
  latest: SpineFilterState;
  optimisticKey: string | null;
  requestedKeys: readonly string[];
};

/**
 * React 19 external-store coordinator (Records pattern). Event handlers
 * publish operator intent synchronously; server payloads are accepted,
 * ignored as stale, or promoted as Back/Forward before paint.
 */
class SpineFilterStore {
  private listeners = new Set<() => void>();
  private historyNavigation = false;
  private snapshot: StoreSnapshot;

  constructor(state: SpineFilterState, children: ReactNode) {
    this.snapshot = {
      acceptedKey: spineFilterKey(state),
      state,
      children,
      latest: state,
      optimisticKey: null,
      requestedKeys: [],
    };
  }

  getSnapshot = (): StoreSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  request(state: SpineFilterState) {
    const key = spineFilterKey(state);
    this.snapshot = {
      ...this.snapshot,
      latest: state,
      optimisticKey: key,
      requestedKeys: [...this.snapshot.requestedKeys.slice(-7), key],
    };
    this.emit();
  }

  markHistoryNavigation() {
    this.historyNavigation = true;
  }

  receiveServer(state: SpineFilterState, children: ReactNode) {
    const key = spineFilterKey(state);
    const current = this.snapshot;

    if (current.optimisticKey !== null) {
      // A local request re-rendered the provider, but no new server payload
      // exists yet. The already accepted key is not a response.
      if (key === current.acceptedKey && !this.historyNavigation) return;

      const answered = key === current.optimisticKey;
      const external =
        this.historyNavigation || !current.requestedKeys.includes(key);
      if (!answered && !external) return;
    }

    this.historyNavigation = false;
    if (
      current.acceptedKey === key &&
      current.state === state &&
      current.children === children &&
      current.optimisticKey === null
    ) {
      return;
    }
    this.snapshot = {
      acceptedKey: key,
      state,
      children,
      latest: state,
      optimisticKey: null,
      requestedKeys: [],
    };
    this.emit();
  }
}

export function SpineFilterProvider({
  state,
  children,
}: {
  state: SpineFilterState;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [store] = useState(() => new SpineFilterStore(state, children));
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    const onPopState = () => store.markHistoryNavigation();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [store]);

  useLayoutEffect(() => {
    store.receiveServer(state, children);
  }, [children, state, store]);

  const latest = useCallback(() => store.getSnapshot().latest, [store]);

  const commit = useCallback(
    (next: SpineFilterState, options?: SpineNavigationOptions) => {
      const current = latest();
      const href = spineFilterHref(next);
      if (spineFilterKey(next) === spineFilterKey(current)) return;

      store.request(next);
      startTransition(() => {
        if (options?.history === "replace") {
          router.replace(href, { scroll: false });
        } else {
          router.push(href, { scroll: false });
        }
      });
    },
    [latest, router, store],
  );

  const update = useCallback(
    (
      patch: SpineFilterPatch | ((state: SpineFilterState) => SpineFilterPatch),
      options?: SpineNavigationOptions,
    ) => {
      commit(updateSpineFilters(latest(), patch), options);
    },
    [commit, latest],
  );

  const clear = useCallback(() => {
    commit(clearSpineFilters(latest()));
  }, [commit, latest]);

  const hrefFor = useCallback(
    (patch: SpineFilterPatch) =>
      spineFilterHref(updateSpineFilters(latest(), patch)),
    [latest],
  );

  const value = useMemo<SpineFilterContextValue>(
    () => ({
      state: snapshot.state,
      requested: snapshot.latest,
      latest,
      update,
      clear,
      hrefFor,
      isPending,
    }),
    [snapshot.state, snapshot.latest, clear, hrefFor, isPending, latest, update],
  );

  return (
    <SpineFilterContext.Provider value={value}>
      {snapshot.children}
    </SpineFilterContext.Provider>
  );
}

export function useSpineFilters(): SpineFilterContextValue {
  const value = useContext(SpineFilterContext);
  if (!value) {
    throw new Error("useSpineFilters must be used inside a SpineFilterProvider.");
  }
  return value;
}
