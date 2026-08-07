import { REQUEST_TYPES } from "./catalog";
import { TICKET_STATUS_LABELS } from "./tickets";
import type {
  Policy,
  RequestTypeId,
  TicketDetail,
  TicketStatus,
} from "./types";

/**
 * Queue board helpers — pure functions shared by the /queue page and its
 * components. Filters and sort ride the URL (`searchParams`), so the board
 * stays server-rendered and every state is linkable.
 *
 * URL scheme:
 *   q       free-text search (passed through to listTickets)
 *   owner   me | unclaimed | claimed | <operator id> — absent means all
 *   type    RequestTypeId
 *   status  TicketStatus
 *   age     gt7 | 3to7 | lt3   (from createdAt)
 *   sort    sr | account | type | status | age | owner | premium (default age)
 *   dir     asc | desc (default desc — oldest first for the default age sort)
 */

export type AgeBucketId = "gt7" | "3to7" | "lt3";

export const AGE_BUCKETS: { id: AgeBucketId; label: string }[] = [
  { id: "gt7", label: ">7 Days" },
  { id: "3to7", label: "3–7 Days" },
  { id: "lt3", label: "<3 Days" },
];

export function ageBucketLabel(id: AgeBucketId): string {
  return AGE_BUCKETS.find((b) => b.id === id)?.label ?? id;
}

export function ageDays(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
}

export function ageBucket(createdAt: string): AgeBucketId {
  const days = ageDays(createdAt);
  if (days > 7) return "gt7";
  if (days >= 3) return "3to7";
  return "lt3";
}

/**
 * Premium exposure sitting behind a ticket — the annual premium on file for
 * the policies the ticket touches (falling back to the account's whole book
 * when no policy is linked). Explicitly NOT an invoice or billing amount;
 * we don't have those.
 */
export function premiumOnFileCents(t: TicketDetail): number {
  const policies: Policy[] = t.policies.length ? t.policies : t.account.policies;
  return policies.reduce((sum, p) => sum + p.premiumCents, 0);
}

export type QueueSortId =
  | "sr"
  | "account"
  | "type"
  | "status"
  | "age"
  | "owner"
  | "premium";

export type QueueSortDir = "asc" | "desc";

export const DEFAULT_SORT: QueueSortId = "age";
export const DEFAULT_DIR: QueueSortDir = "desc";

export interface QueueQuery {
  q?: string;
  owner?: string;
  type?: RequestTypeId;
  status?: TicketStatus;
  age?: AgeBucketId;
  sort: QueueSortId;
  dir: QueueSortDir;
}

const SORT_IDS: QueueSortId[] = [
  "sr",
  "account",
  "type",
  "status",
  "age",
  "owner",
  "premium",
];

/** Parse raw searchParams into a typed query; legacy `view` maps to `owner`. */
export function parseQueueQuery(params: {
  q?: string;
  view?: string;
  owner?: string;
  type?: string;
  status?: string;
  age?: string;
  sort?: string;
  dir?: string;
}): QueueQuery {
  const legacyOwner =
    params.view === "mine"
      ? "me"
      : params.view === "working"
        ? "claimed"
        : params.view === "open"
          ? "unclaimed"
          : undefined;

  return {
    q: params.q?.trim() || undefined,
    owner: params.owner?.trim() || legacyOwner,
    type: REQUEST_TYPES.some((r) => r.id === params.type)
      ? (params.type as RequestTypeId)
      : undefined,
    status:
      params.status && params.status in TICKET_STATUS_LABELS
        ? (params.status as TicketStatus)
        : undefined,
    age: AGE_BUCKETS.some((b) => b.id === params.age)
      ? (params.age as AgeBucketId)
      : undefined,
    sort: SORT_IDS.includes(params.sort as QueueSortId)
      ? (params.sort as QueueSortId)
      : DEFAULT_SORT,
    dir: params.dir === "asc" || params.dir === "desc" ? params.dir : DEFAULT_DIR,
  };
}

/** Serialize a query back to a /queue href, omitting defaults. */
export function queueHref(query: Partial<QueueQuery>): string {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.owner) sp.set("owner", query.owner);
  if (query.type) sp.set("type", query.type);
  if (query.status) sp.set("status", query.status);
  if (query.age) sp.set("age", query.age);
  const sort = query.sort ?? DEFAULT_SORT;
  const dir = query.dir ?? DEFAULT_DIR;
  if (sort !== DEFAULT_SORT || dir !== DEFAULT_DIR) {
    sp.set("sort", sort);
    sp.set("dir", dir);
  }
  const qs = sp.toString();
  return qs ? `/queue?${qs}` : "/queue";
}

export function matchesOwner(
  ticket: TicketDetail,
  owner: string | undefined,
  meId: string | null,
): boolean {
  if (!owner) return true;
  if (owner === "me") return meId != null && ticket.operatorId === meId;
  if (owner === "unclaimed") return ticket.operatorId == null;
  if (owner === "claimed") return ticket.operatorId != null;
  return ticket.operatorId === owner;
}

/**
 * Request-type rollup: count + summed premium on file per type, ordered by
 * count descending so the busiest types lead the card.
 */
export function typeRollup(
  tickets: TicketDetail[],
): { key: RequestTypeId; count: number; premiumCents: number }[] {
  const map = new Map<RequestTypeId, { count: number; premiumCents: number }>();
  for (const t of tickets) {
    const entry = map.get(t.requestType) ?? { count: 0, premiumCents: 0 };
    entry.count += 1;
    entry.premiumCents += premiumOnFileCents(t);
    map.set(t.requestType, entry);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count);
}

/** Status rollup ordered by pipeline stage (Needs You first). */
export function statusRollup(
  tickets: TicketDetail[],
): { key: TicketStatus; count: number; premiumCents: number }[] {
  const map = new Map<TicketStatus, { count: number; premiumCents: number }>();
  for (const t of tickets) {
    const entry = map.get(t.status) ?? { count: 0, premiumCents: 0 };
    entry.count += 1;
    entry.premiumCents += premiumOnFileCents(t);
    map.set(t.status, entry);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => STATUS_RANK[a.key] - STATUS_RANK[b.key]);
}

/** Work-order rank so the status column sorts by pipeline stage, not alphabet. */
const STATUS_RANK: Record<TicketStatus, number> = {
  needs_you: 0,
  intake: 1,
  drafting: 2,
  waiting_market: 3,
  ready_to_issue: 4,
  delivered: 5,
  closed: 6,
};

export function sortTickets(
  tickets: TicketDetail[],
  sort: QueueSortId,
  dir: QueueSortDir,
  operatorsById: Record<string, string>,
): TicketDetail[] {
  const sign = dir === "asc" ? 1 : -1;
  const ownerName = (t: TicketDetail) =>
    t.operatorId ? (operatorsById[t.operatorId] ?? "Assigned") : "";

  const compare = (a: TicketDetail, b: TicketDetail): number => {
    switch (sort) {
      case "sr":
        return a.srNumber.localeCompare(b.srNumber, undefined, { numeric: true });
      case "account":
        return a.account.name.localeCompare(b.account.name);
      case "type":
        return a.requestType.localeCompare(b.requestType);
      case "status":
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      case "owner":
        // Unclaimed sorts last in asc so named owners lead.
        return (ownerName(a) || "\uffff").localeCompare(ownerName(b) || "\uffff");
      case "premium":
        return premiumOnFileCents(a) - premiumOnFileCents(b);
      case "age":
      default:
        // asc = youngest first; desc = oldest first.
        return b.createdAt.localeCompare(a.createdAt);
    }
  };

  return [...tickets].sort((a, b) => {
    const d = compare(a, b);
    return d !== 0 ? sign * d : a.srNumber.localeCompare(b.srNumber);
  });
}
