/**
 * Low-noise diagnostics for Records filter state.
 *
 * These events exist to prove where a filtered list loses its filters, so they
 * describe the *shape* of a transition and never its content. No company
 * names, no account ids, no carrier selections, no search text, no full URLs.
 * Search text is reduced to its length; every other field is reduced to a
 * stable code or a count, and the whole state to a short hash.
 */

import {
  hasActiveRecordsFilters,
  isDefaultRecordsFilterState,
  type RecordsFilterState,
} from "./records-filter-state";

export type RecordsTransitionReason =
  | "initial-load"
  | "filter"
  | "search"
  | "sort"
  | "page"
  | "view-switch"
  | "clear"
  | "return-to-records"
  | "url-normalized";

function intentFields(state: RecordsFilterState): (keyof RecordsFilterState)[] {
  const defaults = {
    view: "all",
    source: "all",
    range: undefined,
    sort: "oldest:none",
  };
  const fields: (keyof RecordsFilterState)[] = [];
  if (state.view !== defaults.view) fields.push("view");
  if (state.source !== defaults.source) fields.push("source");
  if (state.iqStages.length > 0) fields.push("iqStages");
  if (state.brokerGates.length > 0) fields.push("brokerGates");
  if (state.range !== defaults.range) fields.push("range");
  if (state.carriers.length > 0) fields.push("carriers");
  if (state.locationStates.length > 0) fields.push("locationStates");
  if (`${state.sort.date}:${state.sort.revenue}` !== defaults.sort) {
    fields.push("sort");
  }
  if (state.query.length > 0) fields.push("query");
  if (state.page > 1) fields.push("page");
  if (Object.keys(state.passthrough).length > 0) fields.push("passthrough");
  return fields;
}

/** Stable digest of the redacted state shape — no search or facet values. */
export function recordsStateHash(state: RecordsFilterState): string {
  const redacted = [
    state.view,
    state.source,
    state.iqStages.length,
    state.brokerGates.length,
    state.range ?? "none",
    state.carriers.length,
    state.locationStates.length,
    state.sort.date,
    state.sort.revenue,
    state.query.length,
    state.page,
  ].join("|");
  // FNV-1a: short, dependency-free, and only ever compared to itself.
  let hash = 0x811c9dc5;
  for (let i = 0; i < redacted.length; i += 1) {
    hash ^= redacted.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Redacted structural description — which filters are on, never their values. */
export function recordsStateShape(state: RecordsFilterState) {
  return {
    view: state.view,
    source: state.source,
    iq_stage_count: state.iqStages.length,
    broker_gate_count: state.brokerGates.length,
    range: state.range ?? "none",
    carrier_count: state.carriers.length,
    location_state_count: state.locationStates.length,
    sort_date: state.sort.date,
    sort_revenue: state.sort.revenue,
    query_length: state.query.length,
    page: state.page,
    filters_active: hasActiveRecordsFilters(state),
    hash: recordsStateHash(state),
  };
}

function sendProductionEvent(
  event: string,
  detail: Record<string, unknown>,
): void {
  if (
    process.env.NODE_ENV !== "production" ||
    typeof window === "undefined"
  ) {
    return;
  }
  void fetch("/api/records-telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, detail }),
    keepalive: true,
  }).catch(() => {
    // Diagnostics must never get in the way of Records navigation.
  });
}

function appVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    "unknown"
  );
}

/**
 * A Records filter transition. `reason` is what the user did, which is what
 * separates an intentional reset from the defect this instrumentation exists
 * to catch.
 */
export function reportRecordsTransition(event: {
  reason: RecordsTransitionReason;
  from: RecordsFilterState;
  to: RecordsFilterState;
  /** How the transition was initiated, when the caller knows. */
  trigger?: string;
  /** Fields the initiating control explicitly owns. */
  changedFields?: readonly (keyof RecordsFilterState)[];
}): void {
  const { reason, from, to, trigger, changedFields = [] } = event;
  const allowed = new Set<keyof RecordsFilterState>([
    ...changedFields,
    // Result-set changes intentionally return to page 1.
    "page",
  ]);
  if (allowed.has("source")) {
    allowed.add("iqStages");
    allowed.add("brokerGates");
  }
  if (allowed.has("view")) {
    allowed.add("range");
    allowed.add("iqStages");
    allowed.add("brokerGates");
  }
  const unexpectedReset =
    !isDefaultRecordsFilterState(from) &&
    isDefaultRecordsFilterState(to) &&
    to.view === "all" &&
    reason !== "clear" &&
    reason !== "view-switch" &&
    intentFields(from).some((field) => !allowed.has(field));

  if (unexpectedReset) {
    // The defect signature: a filtered list became unfiltered All Accounts
    // without the user asking for it.
    console.warn("records_filters_unexpected_reset", {
      reason,
      trigger: trigger ?? "unknown",
      app_version: appVersion(),
      from: recordsStateShape(from),
      to: recordsStateShape(to),
    });
    sendProductionEvent("unexpected-reset", {
      reason,
      trigger: trigger ?? "unknown",
      from: recordsStateShape(from),
      to: recordsStateShape(to),
    });
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `Records filters reset to default All Accounts without an explicit reset (reason: ${reason}, trigger: ${trigger ?? "unknown"}).`,
      );
    }
    return;
  }

  sendProductionEvent("filter-transition", {
    reason,
    trigger: trigger ?? "unknown",
    from: recordsStateShape(from),
    to: recordsStateShape(to),
  });

  if (process.env.NODE_ENV !== "production") {
    console.info("records_filters_transition", {
      reason,
      trigger: trigger ?? "unknown",
      from_hash: recordsStateHash(from),
      to_hash: recordsStateHash(to),
    });
  }
}

/** Filtered request initialization, emitted server-side with no raw values. */
export function reportRecordsInitialized(state: RecordsFilterState): void {
  if (isDefaultRecordsFilterState(state)) return;
  console.info("records_filters_initialized", {
    app_version: appVersion(),
    state: recordsStateShape(state),
  });
}

export function reportRecordsNavigation(
  event: "records-to-company" | "return-to-records",
  state: RecordsFilterState,
  trigger: string,
): void {
  sendProductionEvent(event, {
    trigger,
    state: recordsStateShape(state),
  });
}

/** A request whose URL was not the canonical spelling of its own state. */
export function reportRecordsUrlNormalized(event: {
  state: RecordsFilterState;
  /** Owned params the request spelled differently or could not keep. */
  droppedParams: readonly string[];
}): void {
  console.info("records_url_normalized", {
    app_version: appVersion(),
    dropped_params: [...event.droppedParams].sort(),
    to: recordsStateShape(event.state),
  });
}

/** Live data shrank the result set under a page the user was holding. */
export function reportRecordsPageClamped(event: {
  state: RecordsFilterState;
  requestedPage: number;
  pageCount: number;
}): void {
  console.info("records_page_clamped", {
    app_version: appVersion(),
    requested_page: event.requestedPage,
    page_count: event.pageCount,
    // Proves the clamp touched only the page.
    filters: recordsStateShape(event.state),
  });
}
