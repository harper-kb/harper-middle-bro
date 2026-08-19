/**
 * The canonical Service Spine filter state.
 *
 * Copy of the Records codec pattern (parse / serialize / normalize), same
 * invariants: the URL is the only durable filter store, `parseSpineFilterState`
 * is the only thing that turns a request into state,
 * `serializeSpineFilterState` is the only thing that turns state back into a
 * URL, and `normalizeSpineFilterState` is the only place field validity is
 * decided.
 *
 * The invariant that keeps a filtered board from collapsing to the default
 * view: an unrecognised value is dropped on its own field, never by resetting
 * the model. A hand-typed priority, a stale wave, a malformed queue token and
 * a page past the end each cost exactly the field they touch.
 */

import {
  isKnownQueueMode,
  SPINE_BOARD_ROWS_DEFAULT,
  SPINE_BOARD_ROWS_STEPS,
  SPINE_QUEUE_ALL,
  SPINE_QUEUE_PERSON_PREFIX,
  type SpineCohort,
  type SpineSort,
} from "@/lib/service-spine/domain";

export const SPINE_PATH = "/service-spine";

export const SPINE_VIEW_PARAM = "view";
export const SPINE_QUERY_PARAM = "q";
export const SPINE_PRIORITY_PARAM = "priority";
export const SPINE_TYPE_PARAM = "type";
export const SPINE_WAVE_PARAM = "wave";
export const SPINE_COHORT_PARAM = "cohort";
export const SPINE_QUEUE_PARAM = "queue";
export const SPINE_SORT_PARAM = "sort";
export const SPINE_ROWS_PARAM = "rows";
export const SPINE_PAGE_PARAM = "page";
export const SPINE_ISSUE_PARAM = "issue";

/**
 * Canonical parameter order. Fixed so one filter state has exactly one URL:
 * the face, the search, the filter row in its reading order, sort, the board
 * cap, the table page, then the open drawer.
 */
export const SPINE_FILTER_PARAM_ORDER = [
  SPINE_VIEW_PARAM,
  SPINE_QUERY_PARAM,
  SPINE_PRIORITY_PARAM,
  SPINE_TYPE_PARAM,
  SPINE_WAVE_PARAM,
  SPINE_COHORT_PARAM,
  SPINE_QUEUE_PARAM,
  SPINE_SORT_PARAM,
  SPINE_ROWS_PARAM,
  SPINE_PAGE_PARAM,
  SPINE_ISSUE_PARAM,
] as const;

/** The shape Next.js hands a page, repeated params included. */
export type SpineSearchParams = Record<string, string | string[] | undefined>;

export type SpineView = "board" | "table";

export type SpineFilterState = {
  view: SpineView;
  /** Free-text search — trimmed, control-stripped, capped at 200 chars. */
  q: string;
  /** `P<digit>`-shaped priority, or null for all. */
  priority: string | null;
  /** issue_type key, or null for all. */
  type: string | null;
  /** `MMDD` wave, or null for all. */
  wave: string | null;
  cohort: SpineCohort | null;
  /** A known queue mode or `person:<name>`; defaults to `all`. */
  queue: string;
  sort: SpineSort;
  /** Board per-column cap — one of SPINE_BOARD_ROWS_STEPS. */
  rows: number;
  /** Table page, integer ≥ 1; clamped to the last page server-side. */
  page: number;
  /** Open drawer issue id, or null when no drawer is open. */
  issue: number | null;
};

export type SpineFilterPatch = Partial<SpineFilterState>;

const SPINE_DEFAULT_VIEW: SpineView = "board";
const SPINE_DEFAULT_SORT: SpineSort = "recency";
const SPINE_QUERY_MAX_CHARS = 200;
const SPINE_PERSON_MAX_CHARS = 80;
const PRIORITY_RE = /^P\d$/;
const TYPE_RE = /^[a-z0-9_]{1,64}$/;
const WAVE_RE = /^\d{4}$/;
const DIGITS_RE = /^\d+$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

/**
 * Collapse the runtime param shape to the single string the field parsers
 * expect. A repeated `?priority=` is a malformed request for a single-select
 * param, not a reason to throw or discard the other filters.
 */
export function readSpineParam(
  params: SpineSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((entry) => entry !== undefined);
  return undefined;
}

function normalizeView(raw: string | undefined | null): SpineView {
  return raw === "table" ? "table" : SPINE_DEFAULT_VIEW;
}

function normalizeQuery(raw: string | undefined | null): string {
  return (raw ?? "")
    .replace(CONTROL_CHARS_RE, "")
    .trim()
    .slice(0, SPINE_QUERY_MAX_CHARS);
}

function normalizePriority(raw: string | undefined | null): string | null {
  return raw != null && PRIORITY_RE.test(raw) ? raw : null;
}

function normalizeType(raw: string | undefined | null): string | null {
  return raw != null && TYPE_RE.test(raw) ? raw : null;
}

function normalizeWave(raw: string | undefined | null): string | null {
  return raw != null && WAVE_RE.test(raw) ? raw : null;
}

function normalizeCohort(raw: string | undefined | null): SpineCohort | null {
  return raw === "pending" || raw === "active" || raw === "others"
    ? raw
    : null;
}

function normalizeQueue(raw: string | undefined | null): string {
  const value = raw ?? "";
  if (isKnownQueueMode(value)) return value;
  if (value.startsWith(SPINE_QUEUE_PERSON_PREFIX)) {
    const person = value.slice(SPINE_QUEUE_PERSON_PREFIX.length).trim();
    if (person.length >= 1 && person.length <= SPINE_PERSON_MAX_CHARS) {
      return `${SPINE_QUEUE_PERSON_PREFIX}${person}`;
    }
  }
  return SPINE_QUEUE_ALL;
}

function normalizeSort(raw: string | undefined | null): SpineSort {
  return raw === "priority" ? "priority" : SPINE_DEFAULT_SORT;
}

function normalizeRows(raw: string | number | undefined | null): number {
  const parsed = typeof raw === "number" ? raw : Number(raw ?? NaN);
  return (SPINE_BOARD_ROWS_STEPS as readonly number[]).includes(parsed)
    ? parsed
    : SPINE_BOARD_ROWS_DEFAULT;
}

function normalizePage(raw: string | number | undefined | null): number {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 1 ? raw : 1;
  }
  if (raw == null || !DIGITS_RE.test(raw)) return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1;
}

function normalizeIssue(
  raw: string | number | undefined | null,
): number | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (raw == null || !DIGITS_RE.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Run every field through its own codec. Each invalid field is dropped on its
 * own; everything still valid survives untouched.
 */
export function normalizeSpineFilterState(
  state: SpineFilterState,
): SpineFilterState {
  return {
    view: normalizeView(state.view),
    q: normalizeQuery(state.q),
    priority: normalizePriority(state.priority),
    type: normalizeType(state.type),
    wave: normalizeWave(state.wave),
    cohort: normalizeCohort(state.cohort),
    queue: normalizeQueue(state.queue),
    sort: normalizeSort(state.sort),
    rows: normalizeRows(state.rows),
    page: normalizePage(state.page),
    issue: normalizeIssue(state.issue),
  };
}

/** The state the section shows when the URL carries nothing valid. */
export function defaultSpineFilterState(): SpineFilterState {
  return {
    view: SPINE_DEFAULT_VIEW,
    q: "",
    priority: null,
    type: null,
    wave: null,
    cohort: null,
    queue: SPINE_QUEUE_ALL,
    sort: SPINE_DEFAULT_SORT,
    rows: SPINE_BOARD_ROWS_DEFAULT,
    page: 1,
    issue: null,
  };
}

/** The one place a request becomes Service Spine state. */
export function parseSpineFilterState(
  params: SpineSearchParams,
): SpineFilterState {
  return {
    view: normalizeView(readSpineParam(params, SPINE_VIEW_PARAM)),
    q: normalizeQuery(readSpineParam(params, SPINE_QUERY_PARAM)),
    priority: normalizePriority(readSpineParam(params, SPINE_PRIORITY_PARAM)),
    type: normalizeType(readSpineParam(params, SPINE_TYPE_PARAM)),
    wave: normalizeWave(readSpineParam(params, SPINE_WAVE_PARAM)),
    cohort: normalizeCohort(readSpineParam(params, SPINE_COHORT_PARAM)),
    queue: normalizeQueue(readSpineParam(params, SPINE_QUEUE_PARAM)),
    sort: normalizeSort(readSpineParam(params, SPINE_SORT_PARAM)),
    rows: normalizeRows(readSpineParam(params, SPINE_ROWS_PARAM)),
    page: normalizePage(readSpineParam(params, SPINE_PAGE_PARAM)),
    issue: normalizeIssue(readSpineParam(params, SPINE_ISSUE_PARAM)),
  };
}

/**
 * The one place Service Spine state becomes a URL. Defaults are omitted, so a
 * clean view is the bare path and needs no normalizing redirect.
 */
export function serializeSpineFilterState(
  state: SpineFilterState,
): URLSearchParams {
  const normalized = normalizeSpineFilterState(state);
  const params = new URLSearchParams();

  if (normalized.view !== SPINE_DEFAULT_VIEW) {
    params.set(SPINE_VIEW_PARAM, normalized.view);
  }
  if (normalized.q) params.set(SPINE_QUERY_PARAM, normalized.q);
  if (normalized.priority) params.set(SPINE_PRIORITY_PARAM, normalized.priority);
  if (normalized.type) params.set(SPINE_TYPE_PARAM, normalized.type);
  if (normalized.wave) params.set(SPINE_WAVE_PARAM, normalized.wave);
  if (normalized.cohort) params.set(SPINE_COHORT_PARAM, normalized.cohort);
  if (normalized.queue !== SPINE_QUEUE_ALL) {
    params.set(SPINE_QUEUE_PARAM, normalized.queue);
  }
  if (normalized.sort !== SPINE_DEFAULT_SORT) {
    params.set(SPINE_SORT_PARAM, normalized.sort);
  }
  if (normalized.rows !== SPINE_BOARD_ROWS_DEFAULT) {
    params.set(SPINE_ROWS_PARAM, String(normalized.rows));
  }
  if (normalized.page > 1) {
    params.set(SPINE_PAGE_PARAM, String(normalized.page));
  }
  if (normalized.issue !== null) {
    params.set(SPINE_ISSUE_PARAM, String(normalized.issue));
  }

  return params;
}

/** The canonical URL for a state — path plus canonical query. */
export function spineFilterHref(state: SpineFilterState): string {
  const query = serializeSpineFilterState(state).toString();
  return `${SPINE_PATH}${query ? `?${query}` : ""}`;
}

/** Stable identity for a state — equal keys mean the same URL. */
export function spineFilterKey(state: SpineFilterState): string {
  return spineFilterHref(state);
}

/**
 * Exactly the query string the request carried, repeated params included, so
 * the page can tell a canonical URL from one that needs normalizing.
 */
export function rawSpineQuery(params: SpineSearchParams): string {
  const raw = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) raw.append(key, entry);
    } else {
      raw.append(key, value);
    }
  }
  return raw.toString();
}

/**
 * True when the request already spells this state canonically. Parsing is
 * idempotent, so redirecting on false always settles in one hop.
 */
export function isCanonicalSpineQuery(
  state: SpineFilterState,
  params: SpineSearchParams,
): boolean {
  return rawSpineQuery(params) === serializeSpineFilterState(state).toString();
}

/** Which owned params the request spelled in a way the state could not keep. */
export function droppedSpineParams(
  state: SpineFilterState,
  params: SpineSearchParams,
): string[] {
  const canonical = serializeSpineFilterState(state);
  return SPINE_FILTER_PARAM_ORDER.filter((key) => {
    const raw = readSpineParam(params, key);
    return raw !== undefined && raw !== canonical.get(key);
  });
}

/**
 * Everything that changes which issues match — the fields whose change resets
 * the table page. The board cap, the page itself and the open drawer are
 * excluded: bumping Load more or opening an issue must never move the page.
 */
function spineResultSetKey(state: SpineFilterState): string {
  return spineFilterHref({
    ...state,
    rows: SPINE_BOARD_ROWS_DEFAULT,
    page: 1,
    issue: null,
  });
}

/**
 * Merge a partial change into a complete state. Callers pass only what they
 * own; every other active filter survives, and the page returns to 1 whenever
 * the result set itself changed.
 */
export function updateSpineFilters(
  current: SpineFilterState,
  patch: SpineFilterPatch | ((state: SpineFilterState) => SpineFilterPatch),
): SpineFilterState {
  const resolved = typeof patch === "function" ? patch(current) : patch;
  const next = normalizeSpineFilterState({ ...current, ...resolved });
  if (
    resolved.page === undefined &&
    spineResultSetKey(next) !== spineResultSetKey(current)
  ) {
    return { ...next, page: 1 };
  }
  return next;
}

/**
 * The intentional reset: no filters, same face, same open drawer. The view is
 * durable user intent and the drawer is not a filter.
 */
export function clearSpineFilters(state: SpineFilterState): SpineFilterState {
  return {
    ...defaultSpineFilterState(),
    view: state.view,
    issue: state.issue,
  };
}

export function hasActiveSpineFilters(state: SpineFilterState): boolean {
  return (
    state.q !== "" ||
    state.priority !== null ||
    state.type !== null ||
    state.wave !== null ||
    state.cohort !== null ||
    state.queue !== SPINE_QUEUE_ALL ||
    state.sort !== SPINE_DEFAULT_SORT
  );
}
