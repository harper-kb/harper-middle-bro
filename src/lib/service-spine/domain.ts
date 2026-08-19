// Service Spine domain contract — the one shared law module for the Step Bro
// Service Spine section. Pure types and functions only (client-safe: the
// board, the drawer, the read service, and the refresher all import from
// here, so nothing server-only may leak in).
//
// Every law below is ported verbatim-in-semantics from the audited source
// (Tatch-AI/harper-coi-workbench @ 718064e5dd1d78f02d4d54a3a0a5d8525fac83e4)
// with the exact file references recorded in
// docs/service-spine/source-audit.md §4. Raw stored values are preserved on
// the types; display normalization happens in exactly one place (the label
// functions here).

// ── Terminal vocabulary (source: src/lib/service-spine/labels.ts:22) ─────────
export const ISSUE_TERMINAL_STATUSES = ["resolved", "cancelled"] as const;

export function isTerminalIssueStatus(status: string): boolean {
  return (ISSUE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ── Operator labels (source: labels.ts:28–54). Stored values are never
// rewritten; unknown keys degrade to readable words, never a raw token. ──────
export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  waiting_customer: "Waiting on customer",
  waiting_third_party: "Waiting on third party",
  blocked: "Blocked",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function issueTypeLabel(issueType: string): string {
  return issueType.replace(/_/g, " ");
}

export function eventKindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

// ── Task openness (source: reads.ts:31, my-queue.ts:9) ───────────────────────
export const TASK_CLOSED_STATUSES = ["done", "cancelled"] as const;

export function isOpenTaskStatus(status: string): boolean {
  return !(TASK_CLOSED_STATUSES as readonly string[]).includes(status);
}

export function isOpenHumanTask(task: {
  ownerKind?: string | null;
  status?: string | null;
}): boolean {
  return (
    String(task.ownerKind ?? "") === "human" &&
    isOpenTaskStatus(String(task.status ?? ""))
  );
}

// ── Board columns (source: ServiceSpineBoard.tsx:297–314) ────────────────────
export interface SpineColumnDef {
  id: string;
  label: string;
  note: string;
  alwaysShown: boolean;
}

export const SPINE_COLUMNS: readonly SpineColumnDef[] = [
  { id: "open", label: "Open", note: "Being worked. No wait on anyone.", alwaysShown: true },
  { id: "waiting_customer", label: "Waiting on customer", note: "The next move is the customer's.", alwaysShown: true },
  { id: "waiting_third_party", label: "Waiting on third party", note: "The next move is a carrier's, underwriter's, or other third party's.", alwaysShown: true },
  { id: "blocked", label: "Blocked", note: "Stuck. Needs an unblock before any move.", alwaysShown: false },
  { id: "closure-proposed", label: "Closure proposed", note: "The agent proposed closing; awaiting the confirm.", alwaysShown: true },
  { id: "closed", label: "Closed", note: "Resolved or cancelled: the terminal states.", alwaysShown: true },
] as const;

/**
 * An issue's working column: terminal statuses fold to `closed`; a proposed
 * closure outranks the raw status; everything else is the status verbatim.
 * An unknown status becomes its own appended column — never silently
 * re-filed (source law, pinned by the source's own tests).
 */
export function spineColumnOf(issue: {
  status: string;
  closureProposed: boolean;
}): string {
  if (isTerminalIssueStatus(issue.status)) return "closed";
  if (issue.closureProposed) return "closure-proposed";
  return issue.status;
}

export function spineColumnLabel(columnId: string): string {
  const known = SPINE_COLUMNS.find((c) => c.id === columnId);
  return known ? known.label : statusLabel(columnId);
}

// ── Cohort (source: ServiceSpineBoard.tsx:739–743; SQL law reads.ts:69–118) ──
export type SpineCohort = "pending" | "active" | "others";

/** pendingOrder: true = Pending orders, false = Active services (bound wins),
 * null = neither/unknown — wears no tag and is never forced into Active. */
export function spineCohortOf(pendingOrder: boolean | null): SpineCohort {
  if (pendingOrder === true) return "pending";
  if (pendingOrder === false) return "active";
  return "others";
}

export const SPINE_COHORT_LABELS: Record<SpineCohort, string> = {
  pending: "Pending orders",
  active: "Active services",
  others: "Others",
};

// ── Wave (source: ServiceSpineBoard.tsx waveOf) ──────────────────────────────
/** The wave, read off the correlation key's tag prefix
 * ("spine-prod-20260731:…" → "0731"). No dedicated column exists. */
export function waveOf(correlationKey: string | null): string | null {
  if (!correlationKey) return null;
  const prefix = correlationKey.split(":")[0] ?? "";
  const m = prefix.match(/(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[2]}${m[3]}` : null;
}

// ── SLA (source: ServiceSpineBoard.tsx SlaChip; amber < 4 h, red breached) ───
export type SpineSlaState = "none" | "due" | "soon" | "breached";

export const SLA_SOON_WINDOW_MS = 4 * 3_600_000;

export function spineSlaState(
  slaDueAt: string | null,
  status: string,
  nowMs: number,
): { state: SpineSlaState; dueMs: number | null } {
  if (!slaDueAt || isTerminalIssueStatus(status)) {
    return { state: "none", dueMs: null };
  }
  const dueMs = new Date(slaDueAt).getTime();
  if (!Number.isFinite(dueMs)) return { state: "none", dueMs: null };
  const diff = dueMs - nowMs;
  if (diff < 0) return { state: "breached", dueMs };
  if (diff < SLA_SOON_WINDOW_MS) return { state: "soon", dueMs };
  return { state: "due", dueMs };
}

/** Short duration for SLA copy ("16h 20m", "1d 4h") — source durShort. */
export function spineSlaDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= 86_400_000) {
    return `${Math.floor(abs / 86_400_000)}d ${Math.floor((abs % 86_400_000) / 3_600_000)}h`;
  }
  if (abs >= 3_600_000) {
    return `${Math.floor(abs / 3_600_000)}h ${Math.floor((abs % 3_600_000) / 60_000)}m`;
  }
  return `${Math.max(1, Math.floor(abs / 60_000))}m`;
}

// ── Queue law (source: my-queue.ts, work-lane-core.ts:47–79) ─────────────────
export const SPINE_QUEUE_ALL = "all";
export const SPINE_QUEUE_MINE = "mine";
export const SPINE_QUEUE_PERSON_PREFIX = "person:";

export const SPINE_QUEUE_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: SPINE_QUEUE_ALL, label: "Queue: all" },
  { value: SPINE_QUEUE_MINE, label: "Queue: mine" },
  { value: "human", label: "Queue: human" },
  { value: "ai", label: "Queue: AI" },
  { value: "human+ai", label: "Queue: human + AI" },
];

export function isKnownQueueMode(value: string): boolean {
  return SPINE_QUEUE_MODES.some((m) => m.value === value);
}

export function spineQueuePersonOf(queue: string): string | null {
  return queue.startsWith(SPINE_QUEUE_PERSON_PREFIX)
    ? queue.slice(SPINE_QUEUE_PERSON_PREFIX.length).trim() || null
    : null;
}

// Name folding, ported exactly from the source's viewerNameMatches
// (work-lane-core.ts): lowercase, non-letters to spaces, collapsed; an email
// folds to its local part only for @harperinsure.com addresses whose local
// part carries at least two name tokens.
function foldName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(raw: string | null | undefined): string {
  const whole = raw ?? "";
  const at = whole.indexOf("@");
  if (at < 0) return foldName(whole);
  const domain = whole.slice(at + 1).trim().toLowerCase();
  const local = foldName(whole.slice(0, at));
  if (domain !== "harperinsure.com" || local.split(" ").length < 2) return "";
  return local;
}

export function viewerNameMatches(
  assigneeRaw: string | null | undefined,
  viewerName: string | null | undefined,
): boolean {
  const assignee = normalizeName(assigneeRaw);
  const viewer = normalizeName(viewerName);
  if (!assignee || !viewer) return false;
  if (assignee === viewer) return true;
  const assigneeTokens = assignee.split(" ");
  const viewerTokens = viewer.split(" ");
  if (assigneeTokens[0] !== viewerTokens[0]) return false;
  return assigneeTokens
    .slice(1)
    .every((token) =>
      viewerTokens.slice(1).some((viewerToken) => viewerToken.startsWith(token)),
    );
}

export function spineAssigneeMatchesViewer(
  assigneeToken: string | null | undefined,
  viewer: { name?: string | null; email?: string | null },
): boolean {
  const a = (assigneeToken ?? "").trim();
  if (!a) return false;
  const email = (viewer.email ?? "").trim();
  if (email && a.toLowerCase() === email.toLowerCase()) return true;
  return viewerNameMatches(a, viewer.name);
}

/** The queue-membership law (source my-queue.ts:123–144). `openHumanAssignees`
 * carries match tokens: directory name AND email for an id-shaped assignee,
 * the raw value otherwise. */
export function issueInSpineQueue(
  issue: {
    humanOpen?: number;
    agentOpen?: number;
    openHumanAssignees?: string[] | null;
  },
  queue: string,
  viewer: { name?: string | null; email?: string | null },
): boolean {
  const person = spineQueuePersonOf(queue);
  if (person) {
    const want = person.toLowerCase();
    return (issue.openHumanAssignees ?? []).some(
      (a) => a.trim().toLowerCase() === want,
    );
  }
  const human = Number(issue.humanOpen ?? 0) > 0;
  const ai = Number(issue.agentOpen ?? 0) > 0;
  if (queue === SPINE_QUEUE_MINE) {
    return (issue.openHumanAssignees ?? []).some((a) =>
      spineAssigneeMatchesViewer(a, viewer),
    );
  }
  if (queue === "human") return human;
  if (queue === "ai") return ai;
  if (queue === "human+ai") return human || ai;
  return true;
}

// ── Search haystack (source: ServiceSpineBoard.tsx issueMatchesSearch) ───────
/** Lowercased haystack matching the source's search law field-for-field.
 * Precomputed at mirror-upsert time so SQLite LIKE and the source substring
 * search agree; also used directly by tests. */
export function buildSpineSearchHaystack(issue: {
  companyName: string | null;
  companyId: number | null;
  id: number;
  goal: string;
  issueType: string;
  status: string;
  priority: string;
  correlationKey: string | null;
  latestSummary: string | null;
  origin: string | null;
}): string {
  return [
    issue.companyName,
    issue.companyId != null ? String(issue.companyId) : null,
    String(issue.id),
    issue.goal,
    issue.issueType,
    issueTypeLabel(issue.issueType),
    issue.status,
    statusLabel(issue.status),
    issue.priority,
    issue.correlationKey,
    issue.latestSummary,
    issue.origin,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ── Domain shapes ────────────────────────────────────────────────────────────

/** One issue as the board/table/drawer consume it. Raw stored values are
 * preserved; labels come from the functions above at render time. */
export interface SpineIssueCard {
  id: number;
  companyId: number | null;
  /** `co-{companyId}` when the company exists in the Step Bro book (so the
   * link resolves); null otherwise — the card then shows a plain name. */
  accountId: string | null;
  companyName: string | null;
  issueType: string;
  goal: string;
  status: string;
  priority: string;
  blocking: string | null;
  origin: string | null;
  correlationKey: string | null;
  wave: string | null;
  slaDueAt: string | null;
  latestSummary: string | null;
  openedAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
  agentOpen: number;
  agentTotal: number;
  humanOpen: number;
  humanTotal: number;
  /** Match tokens (directory name/email for id-shaped assignees, raw value
   * otherwise) — the queue law's input. */
  openHumanAssignees: string[];
  /** Display names for the same set (never emails). */
  openHumanAssigneeNames: string[];
  eventCount: number;
  lastEventAt: string | null;
  hasDraft: boolean;
  closureProposed: boolean;
  pendingOrder: boolean | null;
  /** Derived working column (spineColumnOf). */
  column: string;
}

export interface SpineTaskRow {
  id: number;
  issueId: number;
  title: string;
  ownerKind: string;
  status: string;
  /** Raw stored assignee (id or legacy name). */
  assignee: string | null;
  /** Directory-resolved display label (raw token when unresolved). */
  assigneeLabel: string | null;
  laneSkill: string | null;
  gateLabel: string | null;
  slaDueAt: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface SpineTaskLinkRow {
  id: number;
  taskId: number;
  taskTitle: string | null;
  linkKind: string;
  linkRef: string | null;
  createdAt: string | null;
}

export interface SpineIssueDetail {
  issue: SpineIssueCard & {
    lastCommunicationSummary: string | null;
    resolutionSummary: string | null;
  };
  tasks: SpineTaskRow[];
  taskLinks: SpineTaskLinkRow[];
}

export interface SpineTimelineEvent {
  id: number;
  kind: string;
  payload: unknown;
  actor: string | null;
  at: string | null;
}

export interface SpineTimeline {
  events: SpineTimelineEvent[];
  totalEvents: number;
  truncated: boolean;
  fetchedAt: string;
}

export interface SpineSummary {
  issuesByStatus: Array<{ status: string; n: number }>;
  issuesTotal: number;
  /** Non-terminal issues carrying the closure_proposed overlay signal — the
   * whole-mirror count of the board's "Closure proposed" column, so the
   * summary strip can report it on both faces (view-independent). */
  closureProposedOpen: number;
  agentTasks: { open: number; total: number };
  humanTasks: { open: number; total: number };
  events: { total: number; suppressions: number };
}

export interface SpineFilterOptions {
  priorities: string[];
  issueTypes: string[];
  waves: string[];
  people: Array<{ label: string; n: number }>;
}

export type SpineSort = "recency" | "priority";

/** Canonical, validated list query — produced by the URL codec, consumed by
 * the read service. All fields are already validated/normalized. */
export interface SpineListQuery {
  search: string;
  priority: string | null;
  issueType: string | null;
  wave: string | null;
  cohort: SpineCohort | null;
  queue: string;
  viewer: { name: string | null; email: string | null };
  sort: SpineSort;
}

export interface SpineBoardColumn {
  id: string;
  label: string;
  /** Exact filtered total for this column across the whole mirror. */
  total: number;
  /** Rows served (≤ the per-column cap), deterministic order. */
  rows: SpineIssueCard[];
}

export interface SpineBoardResult {
  columns: SpineBoardColumn[];
  /** Exact filtered issue count across all columns. */
  filteredTotal: number;
  /** Whole-mirror issue count (unfiltered). */
  mirrorTotal: number;
}

export interface SpineTableResult {
  rows: SpineIssueCard[];
  filteredTotal: number;
  mirrorTotal: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export interface SpineSyncStatus {
  /** Last successful spine mirror sync (ISO), null before the first. */
  lastSyncAt: string | null;
  lastFullSyncAt: string | null;
  lastFailureAt: string | null;
}

// ── Shared bounds ────────────────────────────────────────────────────────────
export const SPINE_BOARD_ROWS_STEPS = [100, 250, 500, 1000] as const;
export const SPINE_BOARD_ROWS_DEFAULT = 100;
export const SPINE_TABLE_PAGE_SIZE = 100;
export const SPINE_TIMELINE_EVENT_CAP = 500;
/** Timeline events painted before "Show older" (source folds at 40). */
export const SPINE_TIMELINE_FOLD = 40;
