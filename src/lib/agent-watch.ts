import { verbatimExcerpt } from "./service-ack";

/**
 * Agent Watch — the desk manager's at-scale observation engine.
 *
 * Pure and deterministic: data in, findings out. No db imports, no clock
 * reads — the caller supplies `asOf`, so the same corpus always produces the
 * same report. Accuracy doctrine applies hard: every finding cites the exact
 * records that triggered it, and a rule that examined N records and found
 * nothing says so ("checked N records") instead of asserting trust.
 *
 * The server page feeds this from src/lib/db.ts exports; the self-check
 * (scripts/agent-watch-check.ts) feeds it synthetic corpora. Both get the
 * same answers for the same data.
 */

// ————————————————— Thresholds (named, documented) —————————————————

/** An auto-send burst is a storm when MORE than this many land in one window. */
export const AUTO_SEND_STORM_THRESHOLD = 5;

/** The storm window — auto-sends counted within any rolling 10 minutes. */
export const AUTO_SEND_STORM_WINDOW_MS = 10 * 60 * 1000;

/** A pending missed call is rotting once it has waited longer than this. */
export const MISSED_CALL_ROT_HOURS = 24;

/** An open ticket with no decision or message activity this long is stuck. */
export const TICKET_STUCK_HOURS = 72;

// ————————————————— Input corpus (structural subsets) —————————————————
// These are deliberately narrower than the app types so TicketDetail /
// DecisionTrace / IntakeEvent are assignable as-is, while the self-check can
// craft minimal synthetic records.

export interface WatchPolicyRef {
  id: string;
  policyNumber: string;
  carrier: string;
}

export interface WatchTicket {
  id: string;
  srNumber: string;
  status: string;
  requestType: string;
  fastPathBasis: string | null;
  namedOnPolicyRequired: boolean;
  escalatedAt: string | null;
  escalationDueBy: string | null;
  escalationResolvedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  policies: WatchPolicyRef[];
}

/** Blanket forms actually on a policy's schedule of record. */
export interface WatchBlanket {
  ai: boolean;
  wos: boolean;
}

export interface WatchDecision {
  id: string;
  ticketId: string;
  /** TraceKind — send, auto_send, reply, approval, client_terms, certificate */
  kind: string;
  /** TraceAuthor — ai, operator, market */
  author: string;
  headline: string;
  createdAt: string;
  /** TraceStep subset — id and verdict are enough to read the authority step. */
  steps?: { id: string; verdict: string }[];
}

/**
 * Every automated outbound send on the record, in two shapes: an explicit
 * auto_send decision (streak-unlocked market send), and an AI-authored reply
 * whose authority step passed ("ok") — the quote-confirm path that sends
 * "Proceed — please bind/endorse as quoted" inside the $500 authority while
 * recording a single reply-kind decision for the whole exchange. Reading the
 * recorded step (not the prose) keeps this structural, and because it is the
 * same one decision the AI Actions rollup already counts, widening here
 * double-counts nothing.
 */
export function isAutoSendDecision(d: WatchDecision): boolean {
  if (d.kind === "auto_send") return true;
  return (
    d.kind === "reply" &&
    d.author === "ai" &&
    (d.steps ?? []).some((s) => s.id === "authority" && s.verdict === "ok")
  );
}

/** A message flattened out of a ticket's threads, tagged with its ticket. */
export interface WatchMessage {
  id: string;
  ticketId: string | null;
  direction: string;
  createdAt: string;
}

export interface WatchIntakeEvent {
  id: string;
  channel: string;
  fromName: string;
  receivedAt: string;
  status: string;
  body: string;
  ticketId: string | null;
  ackSentAt: string | null;
  ackBody: string | null;
  callMissed: boolean | null;
}

export interface WatchCorpus {
  /** The audit clock — every age-based rule measures against this instant. */
  asOf: string;
  tickets: WatchTicket[];
  /** Schedule-of-record blanket flags, keyed by policy id. */
  blanketByPolicyId: Record<string, WatchBlanket>;
  decisions: WatchDecision[];
  messages: WatchMessage[];
  intakeEvents: WatchIntakeEvent[];
}

// ————————————————— Rules registry —————————————————

export type WatchSeverity = "critical" | "warn" | "info";

export type WatchRuleId =
  | "FAST_PATH_WITHOUT_BLANKET"
  | "FAST_PATH_DESPITE_NAMED_REQUIRED"
  | "ACK_MISQUOTE"
  | "ACK_WITHOUT_TICKET"
  | "STALE_ESCALATION"
  | "MISSED_CALL_ROTTING"
  | "AUTO_SEND_STORM"
  | "TICKET_STUCK";

export interface WatchRule {
  id: WatchRuleId;
  severity: WatchSeverity;
  title: string;
  /** What the rule proves, in the manager's words. */
  doctrine: string;
}

/** Ordered critical → warn → info; the UI rail renders in this order. */
export const WATCH_RULES: WatchRule[] = [
  {
    id: "FAST_PATH_WITHOUT_BLANKET",
    severity: "critical",
    title: "Fast Path Without Blanket",
    doctrine:
      "A blanket fast path must stand on a blanket form that is actually on the policy. A fastPathBasis with no blanket Additional Insured (AI) or Waiver Of Subrogation (WOS) form in the schedule of record is a data integrity breach.",
  },
  {
    id: "FAST_PATH_DESPITE_NAMED_REQUIRED",
    severity: "critical",
    title: "Fast Path Despite Named Required",
    doctrine:
      "When the holder contractually requires being named on the policy, blanket wording cannot satisfy them — the fast path is forbidden. A fastPathBasis on such a ticket is a doctrine violation.",
  },
  {
    id: "ACK_MISQUOTE",
    severity: "critical",
    title: "Acknowledgment Misquote",
    doctrine:
      "Service acknowledgments quote the client's request back verbatim, never paraphrased. An acknowledgment body that does not contain the verbatim excerpt of the source event is an accuracy breach.",
  },
  {
    id: "ACK_WITHOUT_TICKET",
    severity: "warn",
    title: "Acknowledgment Without Ticket",
    doctrine:
      "An acknowledgment promises the client a service request. An acknowledgment recorded on an intake event with no ticket behind it promised something that does not exist.",
  },
  {
    id: "STALE_ESCALATION",
    severity: "warn",
    title: "Stale Escalation",
    doctrine:
      "An escalation is a promise with a due time. Past dueBy and unresolved on an open ticket means the promise was broken and nobody noticed.",
  },
  {
    id: "MISSED_CALL_ROTTING",
    severity: "warn",
    title: "Missed Call Unreturned",
    doctrine: `A missed call is the triage priority. One still pending after ${MISSED_CALL_ROT_HOURS} hours is a client who called and never heard back.`,
  },
  {
    id: "AUTO_SEND_STORM",
    severity: "info",
    title: "Auto-Send Storm",
    doctrine: `More than ${AUTO_SEND_STORM_THRESHOLD} auto-sent actions inside ${AUTO_SEND_STORM_WINDOW_MS / 60000} minutes is not necessarily wrong — but a burst that fast deserves a human read.`,
  },
  {
    id: "TICKET_STUCK",
    severity: "info",
    title: "Ticket Stuck",
    doctrine: `An open ticket with no decision or message activity for ${TICKET_STUCK_HOURS} hours is going nowhere on its own.`,
  },
];

export const WATCH_RULE_BY_ID: Record<WatchRuleId, WatchRule> =
  Object.fromEntries(WATCH_RULES.map((r) => [r.id, r])) as Record<
    WatchRuleId,
    WatchRule
  >;

export const SEVERITY_ORDER: Record<WatchSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

export const SEVERITY_LABELS: Record<WatchSeverity, string> = {
  critical: "Critical",
  warn: "Warn",
  info: "Info",
};

// ————————————————— Output —————————————————

export interface WatchCitation {
  kind: "ticket" | "intake" | "decision";
  id: string;
  /** Human-facing handle — SR number, event id, decision headline */
  label: string;
  /** In-app link, or null when the record has no page of its own */
  href: string | null;
}

export interface WatchFinding {
  ruleId: WatchRuleId;
  severity: WatchSeverity;
  headline: string;
  detail: string;
  citations: WatchCitation[];
  /** Recency anchor — the most relevant timestamp among the cited records */
  at: string;
}

export interface WatchRollups {
  /** AI-authored decisions per local-UTC day, split by trace kind. Ascending by day. */
  aiActionsByDay: { day: string; byKind: Record<string, number>; total: number }[];
  aiActionsTotal: number;
  /** Blanket fast paths applied, and the exact form bases they cited. */
  fastPaths: { total: number; bases: { basis: string; count: number }[] };
  autoSends: number;
  humanSends: number;
  acksSent: number;
  /** Decision volume per ticket, densest first. */
  decisionsPerTicket: { ticketId: string; srNumber: string; count: number }[];
}

export interface WatchTotals {
  tickets: number;
  decisions: number;
  messages: number;
  intakeEvents: number;
  findingsBySeverity: Record<WatchSeverity, number>;
}

export interface WatchReport {
  rollups: WatchRollups;
  findings: WatchFinding[];
  /** Records each rule examined — the denominator behind every clean bill. */
  checked: Record<WatchRuleId, number>;
  totals: WatchTotals;
}

// ————————————————— Helpers —————————————————

function ticketCitation(t: WatchTicket): WatchCitation {
  return {
    kind: "ticket",
    id: t.id,
    label: t.srNumber || t.id,
    href: `/tickets/${t.id}`,
  };
}

function intakeCitation(e: WatchIntakeEvent): WatchCitation {
  return {
    kind: "intake",
    id: e.id,
    label: `${e.channel} from ${e.fromName} (${e.id})`,
    href: "/pending",
  };
}

function decisionCitation(d: WatchDecision): WatchCitation {
  return {
    kind: "decision",
    id: d.id,
    label: d.headline || d.id,
    href: `/trace?ticket=${d.ticketId}`,
  };
}

function hoursBetween(earlierIso: string, laterIso: string): number {
  return (Date.parse(laterIso) - Date.parse(earlierIso)) / 3_600_000;
}

/** Which blanket kind a request type stands on — mirrors fast-path.ts. */
function blanketKindFor(requestType: string): "ai" | "wos" | null {
  if (requestType === "additional_insured") return "ai";
  if (requestType === "waiver_of_subrogation") return "wos";
  return null;
}

// ————————————————— The engine —————————————————

export function runAgentWatch(corpus: WatchCorpus): WatchReport {
  const findings: WatchFinding[] = [];
  const checked = {} as Record<WatchRuleId, number>;

  const openTickets = corpus.tickets.filter(
    (t) => t.closedAt == null && t.status !== "closed",
  );

  // —— FAST_PATH_WITHOUT_BLANKET (critical) ——
  // Domain: every ticket. Violation: fastPathBasis set, but no policy on the
  // ticket carries the blanket form the request type stands on (AI for
  // additional_insured, WOS for waiver_of_subrogation; any blanket for
  // request types that should never fast-path at all).
  checked.FAST_PATH_WITHOUT_BLANKET = corpus.tickets.length;
  for (const t of corpus.tickets) {
    if (!t.fastPathBasis) continue;
    const kind = blanketKindFor(t.requestType);
    const backed = t.policies.some((p) => {
      const b = corpus.blanketByPolicyId[p.id];
      if (!b) return false;
      return kind ? b[kind] : b.ai || b.wos;
    });
    if (!backed) {
      findings.push({
        ruleId: "FAST_PATH_WITHOUT_BLANKET",
        severity: "critical",
        headline: `${t.srNumber}: Fast path cites "${t.fastPathBasis}" but no policy on the ticket carries a blanket ${kind ? kind.toUpperCase() : "AI/WOS"} form`,
        detail: `Policies checked: ${
          t.policies.map((p) => `${p.carrier} ${p.policyNumber}`).join(", ") ||
          "none on the ticket"
        }. The schedule of record shows no blanket endorsement that could back this basis.`,
        citations: [ticketCitation(t)],
        at: t.createdAt,
      });
    }
  }

  // —— FAST_PATH_DESPITE_NAMED_REQUIRED (critical) ——
  // Domain: every ticket. Violation: fastPathBasis set while the holder
  // contractually requires being named on the policy.
  checked.FAST_PATH_DESPITE_NAMED_REQUIRED = corpus.tickets.length;
  for (const t of corpus.tickets) {
    if (t.fastPathBasis && t.namedOnPolicyRequired) {
      findings.push({
        ruleId: "FAST_PATH_DESPITE_NAMED_REQUIRED",
        severity: "critical",
        headline: `${t.srNumber}: Fast path applied while the holder requires being named on the policy`,
        detail: `namedOnPolicyRequired is true and fastPathBasis reads "${t.fastPathBasis}". Blanket wording cannot satisfy a named-on-policy demand — this belonged with the market.`,
        citations: [ticketCitation(t)],
        at: t.createdAt,
      });
    }
  }

  // —— ACK_MISQUOTE (critical) ——
  // Domain: every intake event. Violation: an ack body was recorded and it
  // does not contain the verbatim excerpt of the source event body — the
  // exact string service-ack.ts is required to quote.
  checked.ACK_MISQUOTE = corpus.intakeEvents.length;
  for (const e of corpus.intakeEvents) {
    if (e.ackBody == null) continue;
    const excerpt = verbatimExcerpt(e.body);
    if (!e.ackBody.includes(excerpt)) {
      findings.push({
        ruleId: "ACK_MISQUOTE",
        severity: "critical",
        headline: `Acknowledgment to ${e.fromName} does not quote their request verbatim`,
        detail: `Expected the acknowledgment body to contain the verbatim excerpt "${excerpt.slice(0, 120)}${excerpt.length > 120 ? "…" : ""}" — it does not. The client was told something other than what they said.`,
        citations: [intakeCitation(e)],
        at: e.ackSentAt ?? e.receivedAt,
      });
    }
  }

  // —— ACK_WITHOUT_TICKET (warn) ——
  // Domain: every intake event. Violation: an ack was sent (ackSentAt or
  // ackBody recorded) but no ticket id is on the event — the SR the client
  // was promised does not exist.
  checked.ACK_WITHOUT_TICKET = corpus.intakeEvents.length;
  for (const e of corpus.intakeEvents) {
    if ((e.ackSentAt != null || e.ackBody != null) && e.ticketId == null) {
      findings.push({
        ruleId: "ACK_WITHOUT_TICKET",
        severity: "warn",
        headline: `Acknowledgment sent to ${e.fromName} with no ticket behind it`,
        detail: `The event carries an acknowledgment (sent ${e.ackSentAt ?? "time unrecorded"}) but ticketId is null. The Service Request (SR) the acknowledgment referenced is not on file.`,
        citations: [intakeCitation(e)],
        at: e.ackSentAt ?? e.receivedAt,
      });
    }
  }

  // —— STALE_ESCALATION (warn) ——
  // Domain: every ticket. Violation: escalated, unresolved, past its dueBy
  // as of the audit clock, and the ticket is still open.
  checked.STALE_ESCALATION = corpus.tickets.length;
  for (const t of openTickets) {
    if (
      t.escalatedAt != null &&
      t.escalationResolvedAt == null &&
      t.escalationDueBy != null &&
      Date.parse(t.escalationDueBy) < Date.parse(corpus.asOf)
    ) {
      const lateHours = hoursBetween(t.escalationDueBy, corpus.asOf);
      findings.push({
        ruleId: "STALE_ESCALATION",
        severity: "warn",
        headline: `${t.srNumber}: Escalation ${Math.floor(lateHours)}h past its due time, unresolved`,
        detail: `Escalated ${t.escalatedAt}, promised by ${t.escalationDueBy}, still open with no resolution recorded as of ${corpus.asOf}.`,
        citations: [ticketCitation(t)],
        at: t.escalationDueBy,
      });
    }
  }

  // —— MISSED_CALL_ROTTING (warn) ——
  // Domain: every intake event. Violation: a missed call still pending more
  // than MISSED_CALL_ROT_HOURS after it was received.
  checked.MISSED_CALL_ROTTING = corpus.intakeEvents.length;
  for (const e of corpus.intakeEvents) {
    if (
      e.channel === "call" &&
      e.callMissed === true &&
      e.status === "pending" &&
      hoursBetween(e.receivedAt, corpus.asOf) > MISSED_CALL_ROT_HOURS
    ) {
      const waited = Math.floor(hoursBetween(e.receivedAt, corpus.asOf));
      findings.push({
        ruleId: "MISSED_CALL_ROTTING",
        severity: "warn",
        headline: `Missed call from ${e.fromName} pending ${waited}h with no callback`,
        detail: `Received ${e.receivedAt}, still pending on the triage board as of ${corpus.asOf} — past the ${MISSED_CALL_ROT_HOURS}h line.`,
        citations: [intakeCitation(e)],
        at: e.receivedAt,
      });
    }
  }

  // —— AUTO_SEND_STORM (info) ——
  // Domain: every decision. Violation: more than AUTO_SEND_STORM_THRESHOLD
  // automated sends (isAutoSendDecision — explicit auto_send plus AI-authored
  // authority-ok confirms) inside any rolling AUTO_SEND_STORM_WINDOW_MS
  // window. Overlapping windows merge into one burst so a storm is reported
  // once, citing every decision in it.
  checked.AUTO_SEND_STORM = corpus.decisions.length;
  const autoSends = corpus.decisions
    .filter(isAutoSendDecision)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  {
    let burstStart = -1;
    let burstEnd = -1; // exclusive
    const flushBurst = () => {
      if (burstStart < 0) return;
      const burst = autoSends.slice(burstStart, burstEnd);
      const first = burst[0];
      const last = burst[burst.length - 1];
      findings.push({
        ruleId: "AUTO_SEND_STORM",
        severity: "info",
        headline: `${burst.length} auto-sends between ${first.createdAt} and ${last.createdAt}`,
        detail: `More than ${AUTO_SEND_STORM_THRESHOLD} auto-authored sends landed inside a ${AUTO_SEND_STORM_WINDOW_MS / 60000}-minute window. Nothing here is proven wrong — the volume itself is the flag; every send in the burst is cited for review.`,
        citations: burst.map(decisionCitation),
        at: last.createdAt,
      });
      burstStart = -1;
      burstEnd = -1;
    };
    for (let i = 0; i < autoSends.length; i++) {
      let j = i;
      while (
        j < autoSends.length &&
        Date.parse(autoSends[j].createdAt) -
          Date.parse(autoSends[i].createdAt) <=
          AUTO_SEND_STORM_WINDOW_MS
      ) {
        j++;
      }
      if (j - i > AUTO_SEND_STORM_THRESHOLD) {
        if (burstStart < 0) {
          burstStart = i;
          burstEnd = j;
        } else if (i < burstEnd) {
          burstEnd = Math.max(burstEnd, j);
        } else {
          flushBurst();
          burstStart = i;
          burstEnd = j;
        }
      }
    }
    flushBurst();
  }

  // —— TICKET_STUCK (info) ——
  // Domain: every ticket. Violation: an open ticket whose latest activity —
  // ticket creation, any decision, any message on its threads — is more than
  // TICKET_STUCK_HOURS before the audit clock.
  checked.TICKET_STUCK = corpus.tickets.length;
  const lastActivity = new Map<string, string>();
  for (const t of corpus.tickets) lastActivity.set(t.id, t.createdAt);
  const bump = (ticketId: string | null, at: string) => {
    if (!ticketId) return;
    const prev = lastActivity.get(ticketId);
    if (prev != null && Date.parse(at) > Date.parse(prev)) {
      lastActivity.set(ticketId, at);
    }
  };
  for (const d of corpus.decisions) bump(d.ticketId, d.createdAt);
  for (const m of corpus.messages) bump(m.ticketId, m.createdAt);
  for (const t of openTickets) {
    const last = lastActivity.get(t.id) ?? t.createdAt;
    const idle = hoursBetween(last, corpus.asOf);
    if (idle > TICKET_STUCK_HOURS) {
      findings.push({
        ruleId: "TICKET_STUCK",
        severity: "info",
        headline: `${t.srNumber}: Open with no activity for ${Math.floor(idle)}h`,
        detail: `Status "${t.status}", last decision or message activity ${last}, nothing since as of ${corpus.asOf} — past the ${TICKET_STUCK_HOURS}h line.`,
        citations: [ticketCitation(t)],
        at: last,
      });
    }
  }

  // —— Sort: critical → warn → info, then most recent first ——
  findings.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const t = Date.parse(b.at) - Date.parse(a.at);
    if (t !== 0) return t;
    return a.headline.localeCompare(b.headline);
  });

  return {
    rollups: buildRollups(corpus),
    findings,
    checked,
    totals: {
      tickets: corpus.tickets.length,
      decisions: corpus.decisions.length,
      messages: corpus.messages.length,
      intakeEvents: corpus.intakeEvents.length,
      findingsBySeverity: {
        critical: findings.filter((f) => f.severity === "critical").length,
        warn: findings.filter((f) => f.severity === "warn").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
    },
  };
}

// ————————————————— Rollups —————————————————

function buildRollups(corpus: WatchCorpus): WatchRollups {
  const ai = corpus.decisions.filter((d) => d.author === "ai");

  const byDay = new Map<string, Record<string, number>>();
  for (const d of ai) {
    const day = d.createdAt.slice(0, 10);
    const bucket = byDay.get(day) ?? {};
    bucket[d.kind] = (bucket[d.kind] ?? 0) + 1;
    byDay.set(day, bucket);
  }
  const aiActionsByDay = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, byKind]) => ({
      day,
      byKind,
      total: Object.values(byKind).reduce((s, n) => s + n, 0),
    }));

  const basisCounts = new Map<string, number>();
  let fastPathTotal = 0;
  for (const t of corpus.tickets) {
    if (!t.fastPathBasis) continue;
    fastPathTotal++;
    basisCounts.set(
      t.fastPathBasis,
      (basisCounts.get(t.fastPathBasis) ?? 0) + 1,
    );
  }
  const bases = [...basisCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([basis, count]) => ({ basis, count }));

  const perTicket = new Map<string, number>();
  for (const d of corpus.decisions) {
    perTicket.set(d.ticketId, (perTicket.get(d.ticketId) ?? 0) + 1);
  }
  const srByTicket = new Map(corpus.tickets.map((t) => [t.id, t.srNumber]));
  const decisionsPerTicket = [...perTicket.entries()]
    .map(([ticketId, count]) => ({
      ticketId,
      srNumber: srByTicket.get(ticketId) ?? ticketId,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.srNumber.localeCompare(b.srNumber));

  return {
    aiActionsByDay,
    aiActionsTotal: ai.length,
    fastPaths: { total: fastPathTotal, bases },
    autoSends: corpus.decisions.filter(isAutoSendDecision).length,
    humanSends: corpus.decisions.filter((d) => d.kind === "send").length,
    acksSent: corpus.intakeEvents.filter((e) => e.ackSentAt != null).length,
    decisionsPerTicket,
  };
}
