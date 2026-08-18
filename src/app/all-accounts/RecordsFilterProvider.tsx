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
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  clearRecordsFilters,
  recordsFilterHref,
  recordsFilterKey,
  updateRecordsFilters,
  withRecordsView,
  type RecordsFilterPatch,
  type RecordsFilterState,
  type RecordsView,
} from "./records-filter-state";
import {
  reportRecordsTransition,
  type RecordsTransitionReason,
} from "./records-telemetry";

/**
 * One client-side owner of "what the user has asked for".
 *
 * The URL stays the durable state; this only closes the window between a
 * filter click and the server render that answers it. Every control merges its
 * change into the newest requested state rather than into the props it was
 * rendered with, so two rapid changes compose instead of overwriting — a
 * carrier chosen at 0ms and a debounced search landing at 200ms produce one
 * URL carrying both, and neither drops the other's parameters.
 *
 * Rendering still comes from the server state, so nothing here can put a
 * filter on screen that the visible rows were not queried with.
 */

type NavigationOptions = {
  /** What the user did — the reason recorded with the transition. */
  reason: RecordsTransitionReason;
  /** Which control started it, for diagnostics. */
  trigger: string;
  /**
   * `replace` for high-frequency text entry, so typing costs no history
   * entries; `push` for deliberate changes the user expects Back to undo.
   */
  history?: "push" | "replace";
  hash?: string;
  /** Fields the initiating control explicitly owns. */
  changedFields?: readonly (keyof RecordsFilterState)[];
};

type RecordsFilterContextValue = {
  /** The state the visible rows were queried with. */
  state: RecordsFilterState;
  /** The newest state the user has asked for, server render or not. */
  latest: () => RecordsFilterState;
  update: (
    patch:
      | RecordsFilterPatch
      | ((state: RecordsFilterState) => RecordsFilterPatch),
    options: NavigationOptions,
  ) => void;
  switchView: (view: RecordsView, options?: Partial<NavigationOptions>) => void;
  clear: (trigger: string) => void;
  /** Canonical href for a change, built from the newest requested state. */
  hrefFor: (patch: RecordsFilterPatch, hash?: string) => string;
  isPending: boolean;
};

const RecordsFilterContext = createContext<RecordsFilterContextValue | null>(
  null,
);

type StoreSnapshot = {
  acceptedKey: string;
  state: RecordsFilterState;
  children: ReactNode;
  latest: RecordsFilterState;
  optimisticKey: string | null;
  requestedKeys: readonly string[];
};

/**
 * React 19 external-store coordinator. Event handlers publish user intent
 * synchronously; server payloads are accepted, ignored as stale, or promoted
 * as Back/Forward before paint. Keeping this outside React state is what lets
 * two handlers in one tick both read the newest request.
 */
class RecordsFilterStore {
  private listeners = new Set<() => void>();
  private historyNavigation = false;
  private snapshot: StoreSnapshot;

  constructor(state: RecordsFilterState, children: ReactNode) {
    this.snapshot = {
      acceptedKey: recordsFilterKey(state),
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

  request(state: RecordsFilterState) {
    const key = recordsFilterKey(state);
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

  receiveServer(state: RecordsFilterState, children: ReactNode) {
    const key = recordsFilterKey(state);
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

export function RecordsFilterProvider({
  state,
  children,
}: {
  state: RecordsFilterState;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [store] = useState(() => new RecordsFilterStore(state, children));
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
    (next: RecordsFilterState, options: NavigationOptions) => {
      const current = latest();
      const href = recordsFilterHref(next, { hash: options.hash });
      const nextKey = recordsFilterKey(next);
      if (nextKey === recordsFilterKey(current)) return;

      reportRecordsTransition({
        reason: options.reason,
        trigger: options.trigger,
        from: current,
        to: next,
        changedFields: options.changedFields,
      });

      store.request(next);
      startTransition(() => {
        if (options.history === "replace") {
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
      patch:
        | RecordsFilterPatch
        | ((state: RecordsFilterState) => RecordsFilterPatch),
      options: NavigationOptions,
    ) => {
      const current = latest();
      const resolved = typeof patch === "function" ? patch(current) : patch;
      commit(updateRecordsFilters(current, resolved), {
        ...options,
        changedFields:
          options.changedFields ??
          (Object.keys(resolved) as (keyof RecordsFilterState)[]),
      });
    },
    [commit, latest],
  );

  const switchView = useCallback(
    (view: RecordsView, options?: Partial<NavigationOptions>) => {
      commit(withRecordsView(latest(), view), {
        reason: "view-switch",
        trigger: options?.trigger ?? "view-switch",
        history: options?.history ?? "push",
        hash: options?.hash,
        changedFields: ["view"],
      });
    },
    [commit, latest],
  );

  const clear = useCallback(
    (trigger: string) => {
      commit(clearRecordsFilters(latest()), {
        reason: "clear",
        trigger,
      });
    },
    [commit, latest],
  );

  const hrefFor = useCallback(
    (patch: RecordsFilterPatch, hash?: string) =>
      recordsFilterHref(updateRecordsFilters(latest(), patch), { hash }),
    [latest],
  );

  const value = useMemo<RecordsFilterContextValue>(
    () => ({
      state: snapshot.state,
      latest,
      update,
      switchView,
      clear,
      hrefFor,
      isPending,
    }),
    [
      snapshot.state,
      clear,
      hrefFor,
      isPending,
      latest,
      switchView,
      update,
    ],
  );

  return (
    <RecordsFilterContext.Provider value={value}>
      {snapshot.children}
    </RecordsFilterContext.Provider>
  );
}

export function useRecordsFilters(): RecordsFilterContextValue {
  const value = useContext(RecordsFilterContext);
  if (!value) {
    throw new Error(
      "useRecordsFilters must be used inside a RecordsFilterProvider.",
    );
  }
  return value;
}

/** Global navigation can be rendered both inside and outside Records. */
export function useOptionalRecordsFilters(): RecordsFilterContextValue | null {
  return useContext(RecordsFilterContext);
}

/**
 * Props for a filter link that must work as a link — server-rendered href for
 * prefetch, middle-click and copy — while a plain click still navigates from
 * the newest requested state rather than the rendered one.
 */
export function useRecordsFilterLink(
  patch: RecordsFilterPatch,
  options: NavigationOptions,
): { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void } {
  const { state, latest, update } = useRecordsFilters();
  const href = recordsFilterHref(updateRecordsFilters(state, patch), {
    hash: options.hash,
  });

  return {
    href,
    onClick: (event) => {
      // Let the browser own modified clicks; they open a second context where
      // the rendered href is exactly the right answer.
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      if (recordsFilterKey(latest()) === recordsFilterKey(state)) return;
      event.preventDefault();
      update(patch, options);
    },
  };
}
