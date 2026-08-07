import type { IntakeEvent, RequestTypeId } from "./types";

/**
 * Deterministic matching + priority engine for the Pending intake board.
 *
 * Pure and client-safe: no db imports, no clocks (callers pass `now`), no
 * LLM calls. Every score is the sum of named, weighted signals and every
 * recommendation carries the reasons that produced it — the operator sees
 * why, and the desk manager tunes the constants below as real examples
 * accumulate. Change a weight, rerun scripts/intake-match-check.ts.
 */

// ————————————————— Tunable constants —————————————————

// —— Event-vs-ticket signal weights (sum to 1.0 so confidence stays 0..1) ——

/** Same normalized sender contact as the ticket's requester. Strongest single tell. */
export const WEIGHT_SAME_SENDER = 0.3;
/** Shared vocabulary between the event text and the ticket text (see OVERLAP_SATURATION). */
export const WEIGHT_TOKEN_OVERLAP = 0.3;
/** The ticket's certificate-holder name appears verbatim (case-insensitive) in the event. */
export const WEIGHT_HOLDER_PHRASE = 0.2;
/** The event uses keywords of the ticket's request type ("additional insured", "waiver…"). */
export const WEIGHT_REQUEST_TYPE_KEYWORD = 0.1;
/** The event arrived close to the ticket's creation — repeats cluster in time. */
export const WEIGHT_TICKET_RECENCY = 0.1;

/**
 * Token overlap saturates: sharing ≥50% of the smaller side's vocabulary is
 * treated as a full-strength signal. Short real-world repeats never share
 * 100% of their words, so a raw Jaccard would under-score true duplicates.
 */
export const OVERLAP_SATURATION = 0.5;
/** Full recency credit when the event lands within this many hours of ticket creation… */
export const TICKET_RECENCY_FULL_HOURS = 24;
/** …decaying linearly to zero credit at this gap. */
export const TICKET_RECENCY_ZERO_HOURS = 72;

/**
 * The "very identical request with high confidence" bar. One-click merge is
 * offered only at/above this confidence AND same sender AND same account.
 */
export const MERGE_CONFIDENCE_FLOOR = 0.85;
/** Between review and merge floors the candidate is shown with reasons — no one-click. */
export const REVIEW_CONFIDENCE_FLOOR = 0.5;

// —— Pending-pair (duplicate-among-pending) signal weights (sum to 1.0) ——

/** Same sender contact — a follow-up nearly always comes from the same address/number. */
export const PAIR_WEIGHT_SAME_SENDER = 0.35;
/** Same subject thread after stripping "Re:"/"Fwd:" prefixes. */
export const PAIR_WEIGHT_SUBJECT_THREAD = 0.25;
/** Shared vocabulary across subject + body (same saturation rule as above). */
export const PAIR_WEIGHT_TOKEN_OVERLAP = 0.25;
/** Received close together — full credit within PAIR_RECENCY_FULL_HOURS. */
export const PAIR_WEIGHT_RECENCY = 0.15;
export const PAIR_RECENCY_FULL_HOURS = 6;
export const PAIR_RECENCY_ZERO_HOURS = 48;

// —— Priority ordering ——

/** Base recency decay: score = 1 / (1 + ageHours / HALF). Gentle — old items never hit zero. */
export const PRIORITY_RECENCY_HALF_HOURS = 12;
/** Missed calls jump the line — someone dialed and nobody answered. */
export const MISSED_CALL_BOOST = 0.5;
/** An email still untriaged after this many hours is at risk of going stale… */
export const EMAIL_AT_RISK_AFTER_HOURS = 1;
/** …so it gets this bump to resurface. */
export const EMAIL_AT_RISK_BOOST = 0.15;

// ————————————————— Types —————————————————

/** Minimal ticket surface the engine scores against — pages map TicketDetail down to this. */
export interface TicketLike {
  id: string;
  srNumber: string;
  accountId: string;
  title: string;
  subject: string;
  requestType: RequestTypeId;
  /** Human label for the request type — passed in so the engine stays dependency-free. */
  requestTypeLabel: string;
  holderName: string | null;
  requestedBy: string;
  requestedByEmail: string | null;
  createdAt: string;
}

export type MatchResult =
  | {
      kind: "ticket";
      ticketId: string;
      srNumber: string;
      /** 0..1, deterministic sum of the weighted signals above */
      confidence: number;
      /** Human-readable, one per signal that fired — shown as chips on the card */
      reasons: string[];
      recommendation: "merge" | "review";
    }
  | { kind: "none"; recommendation: "new" };

export type PairResult =
  | {
      kind: "pair";
      otherId: string;
      confidence: number;
      reasons: string[];
      recommendation: "merge" | "review";
    }
  | { kind: "none"; recommendation: "new" };

// ————————————————— Text normalization —————————————————

/** Filler words that carry no matching signal. Tuned by hand, not exhaustive. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "back", "be", "but", "by", "call",
  "can", "did", "didnt", "do", "does", "dont", "for", "from", "get", "got",
  "has", "have", "hello", "hey", "hi", "i", "if", "im", "in", "is", "it",
  "its", "just", "me", "my", "need", "needs", "of", "on", "or", "our",
  "out", "over", "per", "please", "re", "so", "team", "thank", "thanks",
  "that", "the", "their", "them", "they", "this", "to", "up", "us", "usual",
  "was", "we", "when", "will", "with", "you", "your",
]);

/** Lowercase, strip punctuation, drop stopwords + single letters, dedupe. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Overlap coefficient: |A ∩ B| / min(|A|, |B|) — robust when one side is short. */
function overlapCoefficient(a: Set<string>, b: Set<string>): { ratio: number; shared: number } {
  if (a.size === 0 || b.size === 0) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return { ratio: shared / Math.min(a.size, b.size), shared };
}

/** Saturated overlap score in 0..1 (see OVERLAP_SATURATION). */
function overlapScore(ratio: number): number {
  return Math.min(1, ratio / OVERLAP_SATURATION);
}

/** Emails compared case-insensitively; phone numbers by digits only. */
function normalizeContact(contact: string): string {
  const trimmed = contact.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D+/g, "");
  return digits.length > 0 ? digits : trimmed;
}

/** Strip reply/forward prefixes so "Re: X" threads with "X". */
function normalizeSubject(subject: string | null): string {
  if (!subject) return "";
  return subject
    .toLowerCase()
    .replace(/^(\s*(re|fwd?|fw)\s*:)+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hoursBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / 3_600_000;
}

/** Linear ramp: 1 inside `fullHours`, 0 beyond `zeroHours`. */
function recencyRamp(gapHours: number, fullHours: number, zeroHours: number): number {
  if (gapHours <= fullHours) return 1;
  if (gapHours >= zeroHours) return 0;
  return (zeroHours - gapHours) / (zeroHours - fullHours);
}

/**
 * Request-type keyword map — extend as new phrasings show up in real intake.
 * Phrases are matched against the normalized (lowercased, de-punctuated)
 * event text, so "waiver-of-subrogation" still hits.
 */
const REQUEST_TYPE_KEYWORDS: Partial<Record<RequestTypeId, string[]>> = {
  additional_insured: ["additional insured", "certificate holder", "certificate", "cert", "coi"],
  waiver_of_subrogation: ["waiver of subrogation", "waive subrogation", "wos"],
  primary_non_contributory: ["primary and non contributory", "primary non contributory"],
  notice_cancellation_30: ["30 day notice", "notice of cancellation"],
  additional_named_insured: ["additional named insured"],
  limit_change: ["limit increase", "raise the limit", "higher limit"],
  premium_finance: ["invoice", "billing", "premium finance"],
  binder_confirmation: ["binder", "bind confirmation"],
  renewal_remarket: ["renewal", "remarket"],
};

function flattenForPhrases(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function hasPhrase(haystackFlat: string, phrase: string): boolean {
  return haystackFlat.includes(` ${flattenForPhrases(phrase).trim()} `);
}

// ————————————————— Event vs open tickets —————————————————

function eventText(event: IntakeEvent): string {
  return `${event.subject ?? ""} ${event.body}`;
}

/**
 * Score one pending event against the open tickets and return the single
 * best candidate. Hard gate: no shared accountId, no match — an event that
 * doesn't resolve to an account can never be recommended into a ticket.
 */
export function scoreIntakeAgainstTickets(
  event: IntakeEvent,
  openTickets: TicketLike[],
  now: string,
): MatchResult {
  if (!event.accountId) return { kind: "none", recommendation: "new" };

  const evTokens = tokenize(eventText(event));
  const evFlat = flattenForPhrases(eventText(event));
  const evContact = normalizeContact(event.fromContact);
  void now; // reserved for future signals; ticket recency measures against receivedAt

  let best: Extract<MatchResult, { kind: "ticket" }> | null = null;

  for (const ticket of openTickets) {
    if (ticket.accountId !== event.accountId) continue; // account gate

    let confidence = 0;
    const reasons: string[] = [];
    reasons.push("Same Account");

    // Signal: same sender contact (weight WEIGHT_SAME_SENDER)
    const sameSender =
      ticket.requestedByEmail !== null &&
      normalizeContact(ticket.requestedByEmail) === evContact;
    if (sameSender) {
      confidence += WEIGHT_SAME_SENDER;
      reasons.push(`Same Sender (${event.fromContact})`);
    }

    // Signal: token overlap (weight WEIGHT_TOKEN_OVERLAP, saturated)
    const ticketTokens = tokenize(
      `${ticket.title} ${ticket.subject} ${ticket.holderName ?? ""} ${ticket.requestTypeLabel}`,
    );
    const { ratio, shared } = overlapCoefficient(evTokens, ticketTokens);
    const tokenScore = overlapScore(ratio) * WEIGHT_TOKEN_OVERLAP;
    if (tokenScore > 0) {
      confidence += tokenScore;
      reasons.push(`Shared Wording — ${shared} Terms In Common`);
    }

    // Signal: holder-name phrase hit (weight WEIGHT_HOLDER_PHRASE)
    if (ticket.holderName && hasPhrase(evFlat, ticket.holderName)) {
      confidence += WEIGHT_HOLDER_PHRASE;
      reasons.push(`Holder Named In Message ("${ticket.holderName}")`);
    }

    // Signal: request-type keyword hit (weight WEIGHT_REQUEST_TYPE_KEYWORD)
    const keywords = REQUEST_TYPE_KEYWORDS[ticket.requestType] ?? [];
    const hitKeyword = keywords.find((k) => hasPhrase(evFlat, k));
    if (hitKeyword) {
      confidence += WEIGHT_REQUEST_TYPE_KEYWORD;
      reasons.push(`${ticket.requestTypeLabel} Keywords ("${hitKeyword}")`);
    }

    // Signal: recency proximity to ticket creation (weight WEIGHT_TICKET_RECENCY)
    const gap = hoursBetween(event.receivedAt, ticket.createdAt);
    const recency =
      recencyRamp(gap, TICKET_RECENCY_FULL_HOURS, TICKET_RECENCY_ZERO_HOURS) *
      WEIGHT_TICKET_RECENCY;
    if (recency > 0) {
      confidence += recency;
      reasons.push(
        gap <= TICKET_RECENCY_FULL_HOURS
          ? "Arrived Within A Day Of The Ticket"
          : "Arrived Within Days Of The Ticket",
      );
    }

    if (confidence < REVIEW_CONFIDENCE_FLOOR) continue;

    // The high bar: merge only when near-identical AND same sender AND same
    // account (account already gated above). Everything else is review-only.
    const recommendation: "merge" | "review" =
      confidence >= MERGE_CONFIDENCE_FLOOR && sameSender ? "merge" : "review";

    const candidate: Extract<MatchResult, { kind: "ticket" }> = {
      kind: "ticket",
      ticketId: ticket.id,
      srNumber: ticket.srNumber,
      confidence,
      reasons,
      recommendation,
    };
    if (
      !best ||
      candidate.confidence > best.confidence ||
      (candidate.confidence === best.confidence && candidate.ticketId < best.ticketId)
    ) {
      best = candidate;
    }
  }

  return best ?? { kind: "none", recommendation: "new" };
}

// ————————————————— Pending vs pending (duplicate pairs) —————————————————

/**
 * Score two still-pending events as potential duplicates of each other
 * (e.g. a client emails, then follows up 20 minutes later). Same account
 * gate and the same merge bar as ticket matching. Symmetric in a/b except
 * `otherId`, which names the counterpart of `a`.
 */
export function scorePendingPair(
  a: IntakeEvent,
  b: IntakeEvent,
  now: string,
): PairResult {
  void now; // signals compare the two events' own timestamps
  if (!a.accountId || !b.accountId || a.accountId !== b.accountId) {
    return { kind: "none", recommendation: "new" };
  }

  let confidence = 0;
  const reasons: string[] = ["Same Account"];

  // Signal: same sender contact (weight PAIR_WEIGHT_SAME_SENDER)
  const sameSender = normalizeContact(a.fromContact) === normalizeContact(b.fromContact);
  if (sameSender) {
    confidence += PAIR_WEIGHT_SAME_SENDER;
    reasons.push(`Same Sender (${a.fromContact})`);
  }

  // Signal: same subject thread ignoring Re:/Fwd: (weight PAIR_WEIGHT_SUBJECT_THREAD)
  const subjA = normalizeSubject(a.subject);
  const subjB = normalizeSubject(b.subject);
  if (subjA.length > 0 && subjA === subjB) {
    confidence += PAIR_WEIGHT_SUBJECT_THREAD;
    reasons.push("Same Subject Thread");
  }

  // Signal: token overlap across subject + body (weight PAIR_WEIGHT_TOKEN_OVERLAP)
  const { ratio, shared } = overlapCoefficient(
    tokenize(eventText(a)),
    tokenize(eventText(b)),
  );
  const tokenScore = overlapScore(ratio) * PAIR_WEIGHT_TOKEN_OVERLAP;
  if (tokenScore > 0) {
    confidence += tokenScore;
    reasons.push(`Shared Wording — ${shared} Terms In Common`);
  }

  // Signal: received close together (weight PAIR_WEIGHT_RECENCY)
  const gap = hoursBetween(a.receivedAt, b.receivedAt);
  const recency =
    recencyRamp(gap, PAIR_RECENCY_FULL_HOURS, PAIR_RECENCY_ZERO_HOURS) *
    PAIR_WEIGHT_RECENCY;
  if (recency > 0) {
    confidence += recency;
    reasons.push(
      gap < 1
        ? `Received ${Math.max(1, Math.round(gap * 60))} Min Apart`
        : `Received ${Math.round(gap)} Hr Apart`,
    );
  }

  if (confidence < REVIEW_CONFIDENCE_FLOOR) {
    return { kind: "none", recommendation: "new" };
  }
  return {
    kind: "pair",
    otherId: b.id,
    confidence,
    reasons,
    recommendation:
      confidence >= MERGE_CONFIDENCE_FLOOR && sameSender ? "merge" : "review",
  };
}

// ————————————————— Priority ordering —————————————————

/** Exposed for the board and the self-check — higher means triage sooner. */
export function priorityScore(event: IntakeEvent, now: string): number {
  const ageHours = Math.max(0, hoursBetween(event.receivedAt, now));
  // Hyperbolic decay: fresh ≈ 1, half strength at PRIORITY_RECENCY_HALF_HOURS,
  // still > 0 after days — old never means gone.
  let score = 1 / (1 + ageHours / PRIORITY_RECENCY_HALF_HOURS);
  if (event.channel === "call" && event.callMissed === true) {
    score += MISSED_CALL_BOOST;
  }
  if (event.channel === "email" && ageHours >= EMAIL_AT_RISK_AFTER_HOURS) {
    score += EMAIL_AT_RISK_BOOST;
  }
  return score;
}

/**
 * Recency-weighted triage order: fresher first, missed calls jump the line,
 * emails aging past an hour get a resurface bump, multi-day items decay
 * gently but are never dropped. Deterministic tie-break by id.
 */
export function priorityOrder(events: IntakeEvent[], now: string): IntakeEvent[] {
  return [...events].sort((a, b) => {
    const diff = priorityScore(b, now) - priorityScore(a, now);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
