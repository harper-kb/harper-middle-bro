import { isoToLocalDateKey, localDateKey } from "./dates";

/**
 * Pure "story of the day" builder — client-safe, no db imports.
 *
 * The page fetches today's raw material (tickets, threads with messages,
 * decision traces) and hands it in here with a reference "now". Everything
 * out of this module is derived ONLY from recorded events: nothing is
 * invented, nothing is padded. No Date.now() anywhere — determinism is the
 * whole point, and it keeps this unit-testable from a script.
 */

// ————————————————— Input shapes —————————————————
// Narrow structural subsets of the app's detail types, so callers (the page,
// the self-check script) can build them without dragging in db types.

export interface StoryTicket {
  id: string;
  srNumber: string;
  /** Human request-type name, e.g. "Additional Insured" — resolved by the caller. */
  requestTypeLabel: string;
  accountName: string;
  createdAt: string;
  closedAt: string | null;
  /** Set when the blanket fast path issued this without touching the market. */
  fastPathBasis: string | null;
}

export interface StoryThreadMessage {
  createdAt: string;
  direction: "outbound" | "inbound";
  party: "underwriter" | "client";
  subject: string;
}

export interface StoryThread {
  ticketId: string | null;
  carrier: string;
  accountName: string;
  /** Full message history of the thread — the lib filters to today itself. */
  messages: StoryThreadMessage[];
}

export interface StoryDecision {
  ticketId: string;
  createdAt: string;
  headline: string;
  summary: string;
  kind: string;
}

export interface DayStoryInput {
  tickets: StoryTicket[];
  threads: StoryThread[];
  decisions: StoryDecision[];
  /** srNumber lookup for threads/decisions whose ticket isn't in `tickets`. */
  srNumbersByTicketId?: Record<string, string>;
  /** Open tickets on the operator's plate — lets an empty day point forward. */
  openTicketCount: number;
  /** Reference clock, ISO. Defines "today" (local calendar day). */
  now: string;
}

// ————————————————— Output shapes —————————————————

export type DayEventKind =
  | "ticket_opened"
  | "ticket_closed"
  | "fast_path"
  | "message_sent"
  | "message_received"
  | "decision";

export interface DayEvent {
  /** ISO timestamp of the recorded event. */
  at: string;
  kind: DayEventKind;
  headline: string;
  detail?: string;
  href?: string;
  srNumber?: string;
}

export interface DayChapter {
  id: "morning" | "afternoon" | "evening";
  title: "Morning" | "Afternoon" | "Evening";
  events: DayEvent[];
}

export interface StoryBucket {
  label: string;
  /** ISO start of the bucket. */
  start: string;
  /** All recorded events in the bucket. */
  count: number;
  /** Ticket closes (including fast-path closes) in the bucket. */
  closedCount: number;
}

export interface DayStory {
  events: DayEvent[];
  chapters: DayChapter[];
  summary: string;
}

// ————————————————— Time helpers —————————————————

/** Local 12-hour clock, e.g. "9:05 AM". Renderers use this — times are never baked into headlines. */
export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${h24 < 12 ? "AM" : "PM"}`;
}

function isSameLocalDay(iso: string, nowIso: string): boolean {
  return isoToLocalDateKey(iso) === localDateKey(new Date(nowIso));
}

// ————————————————— Events —————————————————

const CLOSE_KINDS: DayEventKind[] = ["ticket_closed", "fast_path"];

/** Decision kinds already represented by a message event — skipped to avoid double-telling. */
const MESSAGE_BACKED_DECISION_KINDS = new Set(["send", "reply", "client_terms"]);

export function buildDayEvents(input: DayStoryInput): DayEvent[] {
  const { now } = input;
  const events: DayEvent[] = [];
  const srByTicket: Record<string, string> = {
    ...input.srNumbersByTicketId,
  };
  for (const t of input.tickets) srByTicket[t.id] = t.srNumber;

  for (const t of input.tickets) {
    const href = `/tickets/${t.id}`;
    if (isSameLocalDay(t.createdAt, now)) {
      events.push({
        at: t.createdAt,
        kind: "ticket_opened",
        headline: `Opened ${t.srNumber} — ${t.requestTypeLabel} for ${t.accountName}`,
        href,
        srNumber: t.srNumber,
      });
    }
    if (t.closedAt && isSameLocalDay(t.closedAt, now)) {
      const fastPath = t.fastPathBasis != null;
      events.push({
        at: t.closedAt,
        kind: fastPath ? "fast_path" : "ticket_closed",
        headline: fastPath
          ? `Closed ${t.srNumber} — ${t.requestTypeLabel} for ${t.accountName} (Fast Path, No Market Contact)`
          : `Closed ${t.srNumber} — ${t.requestTypeLabel} for ${t.accountName}`,
        detail: fastPath ? (t.fastPathBasis ?? undefined) : undefined,
        href,
        srNumber: t.srNumber,
      });
    }
  }

  for (const thread of input.threads) {
    const sr = thread.ticketId ? srByTicket[thread.ticketId] : undefined;
    const where = sr ?? thread.accountName;
    const href = thread.ticketId ? `/tickets/${thread.ticketId}` : undefined;
    // Chronological pass so "first ask today" vs "follow-up" reads off the
    // thread's own recorded history, not off invented state.
    const ordered = [...thread.messages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    let priorOutboundToMarket = 0;
    for (const m of ordered) {
      const today = isSameLocalDay(m.createdAt, now);
      if (m.direction === "outbound" && m.party === "underwriter") {
        if (today) {
          events.push({
            at: m.createdAt,
            kind: "message_sent",
            headline:
              priorOutboundToMarket === 0
                ? `Sent the market request to ${thread.carrier} on ${where}`
                : `Followed up with ${thread.carrier} on ${where}`,
            detail: m.subject || undefined,
            href,
            srNumber: sr,
          });
        }
        priorOutboundToMarket += 1;
      } else if (!today) {
        continue;
      } else if (m.direction === "outbound") {
        events.push({
          at: m.createdAt,
          kind: "message_sent",
          headline: `Relayed an update to ${thread.accountName}${sr ? ` on ${sr}` : ""}`,
          detail: m.subject || undefined,
          href,
          srNumber: sr,
        });
      } else if (m.party === "underwriter") {
        events.push({
          at: m.createdAt,
          kind: "message_received",
          headline: `Heard back from ${thread.carrier} on ${where}`,
          detail: m.subject || undefined,
          href,
          srNumber: sr,
        });
      } else {
        events.push({
          at: m.createdAt,
          kind: "message_received",
          headline: `Received a note from ${thread.accountName}${sr ? ` on ${sr}` : ""}`,
          detail: m.subject || undefined,
          href,
          srNumber: sr,
        });
      }
    }
  }

  for (const d of input.decisions) {
    if (!isSameLocalDay(d.createdAt, now)) continue;
    if (MESSAGE_BACKED_DECISION_KINDS.has(d.kind)) continue;
    const sr = srByTicket[d.ticketId];
    events.push({
      at: d.createdAt,
      // The trace headline is itself a recorded artifact — reuse it verbatim.
      kind: "decision",
      headline: sr ? `${d.headline} on ${sr}` : d.headline,
      detail: d.summary || undefined,
      href: `/tickets/${d.ticketId}`,
      srNumber: sr,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at) || a.headline.localeCompare(b.headline));
  return events;
}

// ————————————————— Chapters —————————————————

export function buildChapters(events: DayEvent[]): DayChapter[] {
  const morning: DayEvent[] = [];
  const afternoon: DayEvent[] = [];
  const evening: DayEvent[] = [];
  for (const e of events) {
    const hour = new Date(e.at).getHours();
    if (hour < 12) morning.push(e);
    else if (hour < 17) afternoon.push(e);
    else evening.push(e);
  }
  const chapters: DayChapter[] = [];
  if (morning.length) chapters.push({ id: "morning", title: "Morning", events: morning });
  if (afternoon.length) chapters.push({ id: "afternoon", title: "Afternoon", events: afternoon });
  if (evening.length) chapters.push({ id: "evening", title: "Evening", events: evening });
  return chapters;
}

// ————————————————— Summary —————————————————

function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function composeSummary(
  events: DayEvent[],
  openTicketCount: number,
): string {
  if (events.length === 0) {
    const plate =
      openTicketCount > 0
        ? ` ${plural(openTicketCount, "open ticket is", "open tickets are")} waiting on your plate below.`
        : " Nothing is assigned to you yet. New work is claimed from the queue.";
    return `No activity recorded yet today.${plate}`;
  }

  const closed = events.filter((e) => CLOSE_KINDS.includes(e.kind)).length;
  const fastPath = events.filter((e) => e.kind === "fast_path").length;
  const opened = events.filter((e) => e.kind === "ticket_opened").length;
  const asks = events.filter(
    (e) => e.kind === "message_sent" && e.headline.startsWith("Sent the market request"),
  ).length;
  const followUps = events.filter(
    (e) => e.kind === "message_sent" && e.headline.startsWith("Followed up"),
  ).length;
  const relays = events.filter(
    (e) => e.kind === "message_sent" && e.headline.startsWith("Relayed"),
  ).length;
  const heard = events.filter((e) => e.kind === "message_received").length;
  const decisions = events.filter((e) => e.kind === "decision").length;

  const clauses: string[] = [];
  if (closed > 0) {
    clauses.push(
      `closed ${plural(closed, "ticket")}${fastPath > 0 ? ` (${fastPath} on the fast path)` : ""}`,
    );
  }
  if (asks > 0) clauses.push(`sent ${plural(asks, "market request")}`);
  if (followUps > 0) clauses.push(`followed up ${plural(followUps, "time")} with the market`);
  if (heard > 0) clauses.push(`heard back ${plural(heard, "time")}`);
  if (relays > 0) clauses.push(`relayed ${plural(relays, "client update")}`);
  if (opened > 0) clauses.push(`opened ${plural(opened, "new ticket")}`);
  if (decisions > 0) clauses.push(`logged ${plural(decisions, "decision")}`);

  const lead = clauses.length > 0 ? `You ${joinClauses(clauses)}.` : "";
  const tail =
    openTicketCount > 0
      ? ` ${plural(openTicketCount, "ticket is", "tickets are")} still open on your plate.`
      : " Your plate is clear.";
  return `${lead}${tail}`.trim();
}

// ————————————————— Buckets —————————————————

function floorToBucket(d: Date, minutes: number): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  out.setMinutes(out.getMinutes() - (out.getMinutes() % minutes));
  return out;
}

function bucketLabel(start: Date, minutes: number): string {
  if (minutes === 60) {
    const h24 = start.getHours();
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h} ${h24 < 12 ? "AM" : "PM"}`;
  }
  return formatClockTime(start.toISOString());
}

/**
 * Fixed-width buckets across the working span of the day: from 8 AM (or the
 * first event, if earlier) through "now". Empty day → empty array.
 */
export function bucketize(
  events: DayEvent[],
  minutes: 60 | 20 | 10,
  nowIso: string,
): StoryBucket[] {
  if (events.length === 0) return [];
  const now = new Date(nowIso);
  const firstAt = events.reduce(
    (min, e) => (e.at < min ? e.at : min),
    events[0].at,
  );
  const first = new Date(firstAt);
  const eightAm = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    8,
    0,
    0,
    0,
  );
  const spanStart = floorToBucket(first < eightAm ? first : eightAm, minutes);

  const buckets: StoryBucket[] = [];
  const stepMs = minutes * 60_000;
  for (let t = spanStart.getTime(); t <= now.getTime(); t += stepMs) {
    const start = new Date(t);
    buckets.push({
      label: bucketLabel(start, minutes),
      start: start.toISOString(),
      count: 0,
      closedCount: 0,
    });
  }
  if (buckets.length === 0) return buckets;

  const baseMs = spanStart.getTime();
  for (const e of events) {
    const idx = Math.floor((new Date(e.at).getTime() - baseMs) / stepMs);
    if (idx < 0 || idx >= buckets.length) continue;
    buckets[idx].count += 1;
    if (CLOSE_KINDS.includes(e.kind)) buckets[idx].closedCount += 1;
  }
  return buckets;
}

// ————————————————— Entry point —————————————————

export function buildDayStory(input: DayStoryInput): DayStory {
  const events = buildDayEvents(input);
  return {
    events,
    chapters: buildChapters(events),
    summary: composeSummary(events, input.openTicketCount),
  };
}
