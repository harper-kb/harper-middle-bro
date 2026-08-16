import { getRequestType } from "../catalog";
import { formatDate, formatMoney } from "../format";
import {
  findBlanketForm,
  limitStatement,
  LIMIT_SLOT_LABELS,
  type EndorsementForm,
  type LimitSlot,
  type PolicyFormSet,
} from "../certificates/forms";
import {
  guidanceIsQuotable,
  MIN_QUOTE_SAMPLES,
  summarizeQuotes,
  type QuoteSample,
} from "../certificates/price-guidance";
import { ticketStatusLabel } from "../tickets/tickets";
import {
  ACCOUNT_STATUS_LABELS,
  type AccountDetail,
  type AccountStatus,
  type IntakeChannel,
  type RequestTypeId,
  type Thread,
  type ThreadDetail,
  type TicketDetail,
  type TicketStatus,
} from "../types";

/**
 * Desk Brain — deterministic Q&A scoped to one account's record.
 *
 * NO model anywhere in this path. A typed question is matched against a fixed
 * set of intents by regex, and every answer is assembled verbatim from the
 * context bundle the server handed over — form sets, policies, threads, the
 * ticket, quote history. Anything the record cannot back gets the one refusal
 * line, exactly. A blank refusal beats a wrong answer; that is doctrine.
 *
 * The Step Bro Bot adds a second, desk-wide scope on the same discipline:
 * a DeskWideBundle (queue counts, escalations, pending intake, operator load,
 * account roster) assembled by the /api/desk-brain route, answered by
 * askDeskWide below. Same rules — cited answers or the refusal, nothing else.
 */

export const DESK_BRAIN_REFUSAL = "I only answer from this account's record.";

export const DESK_WIDE_REFUSAL = "I only answer from this desk's record.";

// ——— Serializable context bundle (server assembles, client answers) ———

export interface BrainPolicy {
  id: string;
  policyNumber: string;
  carrier: string;
  coverages: string[];
  effectiveDate: string;
  expirationDate: string;
  premiumCents: number;
}

export interface BrainMessage {
  role: "agent" | "underwriter" | "human" | "client";
  direction: "outbound" | "inbound";
  subject: string;
  body: string;
  premiumImpactCents: number | null;
  createdAt: string;
}

export interface BrainThread {
  id: string;
  subject: string;
  status: string;
  underwriterName: string | null;
  carrier: string;
  policyNumber: string;
  offeredPremiumCents: number | null;
  createdAt: string;
  /** Empty on account-level summaries — messages live on the ticket view */
  messages: BrainMessage[];
}

export interface BrainTicket {
  id: string;
  srNumber: string;
  status: TicketStatus;
  requestType: RequestTypeId;
  requestTypeLabel: string;
  subject: string;
  holderName: string | null;
  holderAddress: string | null;
  fastPathBasis: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface BrainDecision {
  headline: string;
  kind: string;
  createdAt: string;
}

export interface DeskBrainBundle {
  account: {
    id: string;
    name: string;
    dba: string | null;
    industry: string;
    state: string;
    status: AccountStatus;
    paymentReceivedAt: string | null;
    primaryUwName: string;
    primaryUwCarrier: string;
    backupUwName: string | null;
  };
  policies: BrainPolicy[];
  /** Schedule of record per policy id — the only limits/forms source */
  formSets: Record<string, PolicyFormSet>;
  ticket: BrainTicket | null;
  threads: BrainThread[];
  decisions: BrainDecision[];
  quoteSamples: QuoteSample[];
}

/** Desk-wide context the /api/desk-brain route assembles for the bot. */
export interface DeskWideBundle {
  ticketCounts: { status: TicketStatus; count: number }[];
  openTicketCount: number;
  /** Open tickets nobody has claimed — the grab pile */
  unclaimedOpenCount: number;
  escalations: {
    ticketId: string;
    srNumber: string;
    toName: string | null;
    dueBy: string | null;
  }[];
  pendingIntake: { channel: IntakeChannel; count: number }[];
  operators: { id: string; name: string; openTickets: number }[];
  accounts: { id: string; name: string; status: AccountStatus }[];
  changedToday: {
    ticketId: string;
    srNumber: string;
    subject: string;
    status: TicketStatus;
  }[];
}

export interface DeskBrainCitation {
  label: string;
  href?: string;
}

export type DeskBrainIntent =
  | "account_status"
  | "fast_path"
  | "ticket_status"
  | "holder"
  | "blanket"
  | "price_history"
  | "premium"
  | "limits"
  | "endorsements"
  | "threads"
  | "policies";

export type DeskWideIntent =
  | "desk_open_tickets"
  | "desk_pending"
  | "desk_operator_load"
  | "desk_prebind_accounts"
  | "desk_escalations"
  | "desk_changed_today";

export type DeskBrainResult =
  | {
      kind: "answer";
      intent: DeskBrainIntent | DeskWideIntent;
      answer: string;
      citations: DeskBrainCitation[];
    }
  | { kind: "refusal"; answer: string };

// ——— Server-side bundle assembly (pure mapping, callable anywhere) ———

export function buildDeskBrainBundle(input: {
  account: AccountDetail;
  formSets: Record<string, PolicyFormSet>;
  ticket?: TicketDetail | null;
  ticketThreads?: ThreadDetail[];
  decisions?: BrainDecision[];
  quoteSamples: QuoteSample[];
}): DeskBrainBundle {
  const { account } = input;
  const uwNameById = new Map<string, string>([
    [account.primaryUw.id, account.primaryUw.name],
    ...(account.backupUw
      ? ([[account.backupUw.id, account.backupUw.name]] as [string, string][])
      : []),
  ]);
  const policyById = new Map(account.policies.map((p) => [p.id, p]));

  const threads: BrainThread[] = input.ticketThreads
    ? input.ticketThreads.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        underwriterName: t.underwriter.name,
        carrier: t.policy.carrier,
        policyNumber: t.policy.policyNumber,
        offeredPremiumCents: t.offeredPremiumCents,
        createdAt: t.createdAt,
        messages: t.messages.map((m) => ({
          role: m.role,
          direction: m.direction,
          subject: m.subject,
          body: m.body,
          premiumImpactCents: m.premiumImpactCents,
          createdAt: m.createdAt,
        })),
      }))
    : account.threads.map((t: Thread) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        underwriterName: uwNameById.get(t.underwriterId) ?? null,
        carrier: policyById.get(t.policyId)?.carrier ?? "",
        policyNumber: policyById.get(t.policyId)?.policyNumber ?? "",
        offeredPremiumCents: t.offeredPremiumCents,
        createdAt: t.createdAt,
        messages: [],
      }));

  const ticket = input.ticket ?? null;

  return {
    account: {
      id: account.id,
      name: account.name,
      dba: account.dba,
      industry: account.industry,
      state: account.state,
      status: account.status,
      paymentReceivedAt: account.paymentReceivedAt,
      primaryUwName: account.primaryUw.name,
      primaryUwCarrier: account.primaryUw.carrier,
      backupUwName: account.backupUw?.name ?? null,
    },
    policies: account.policies.map((p) => ({
      id: p.id,
      policyNumber: p.policyNumber,
      carrier: p.carrier,
      coverages: p.coverages,
      effectiveDate: p.effectiveDate,
      expirationDate: p.expirationDate,
      premiumCents: p.premiumCents,
    })),
    formSets: input.formSets,
    ticket: ticket
      ? {
          id: ticket.id,
          srNumber: ticket.srNumber,
          status: ticket.status,
          requestType: ticket.requestType,
          requestTypeLabel: getRequestType(ticket.requestType).label,
          subject: ticket.subject,
          holderName: ticket.holderName,
          holderAddress: ticket.holderAddress,
          fastPathBasis: ticket.fastPathBasis,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          closedAt: ticket.closedAt,
        }
      : null,
    threads,
    decisions: input.decisions ?? [],
    quoteSamples: input.quoteSamples,
  };
}

// ——— Scope guard ———

/**
 * Words that are ordinary question or insurance vocabulary — capitalized
 * occurrences of these never count as a foreign entity mention.
 */
const LEXICON = new Set(
  (
    "what whats what's is are do does did have has had who when where why how which " +
    "the a an on of for to from in at this that these those their they them we our us it its " +
    "any all show tell me give list summarize summary please and or with about there was were " +
    "can could would should will won't dont don't isn't aren't much many " +
    "gl ai wos wofs pnc bop wc sr coi el eo e&o csl hoa llc inc " +
    "cert certificate certificates blanket waiver waivers subrogation additional insured insureds " +
    "limit limits each occurrence aggregate general liability medical expense exp umbrella excess " +
    "auto combined single cyber professional workers comp compensation employers premium premiums " +
    "policy policies carrier carriers term terms effective expiration expire expires renew renewal " +
    "endorsement endorsements form forms edition schedule scheduled price history pay paid pricing " +
    "thread threads market underwriter underwriters holder account status active cancelled canceled " +
    "fast path basis ticket number payment received pre-bind prebind damage rented premises personal " +
    "advertising injury products completed operations ops liquor primary noncontributory non contributory " +
    "quote quoted quotes charge cost rate usually typically going desk info information " +
    // Desk-wide vocabulary — queue, intake, escalation, and operator-load talk
    "tickets open opened closed file queue pending intake triage triaged escalation escalations " +
    "escalated operator operators load workload most today yesterday changed change changes moved " +
    "updated anyone anything wide bind unclaimed claimed emails texts calls call communications srs"
  ).split(/\s+/),
);

/**
 * Refuse questions that name something outside this account's record. A
 * capitalized token that is neither question/insurance vocabulary nor found
 * anywhere in the bundle's own text reads as a foreign entity ("Apex
 * Construction", another carrier) — and the record cannot back an answer
 * about it. Lowercase mentions slip past this guard; the intent regexes and
 * the default refusal still bound what can be said.
 */
function mentionsForeignEntity(question: string, bundle: DeskBrainBundle): boolean {
  return hasUnknownProperNoun(question, knownText(bundle));
}

function hasUnknownProperNoun(question: string, known: string): boolean {
  const tokens = question.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g, "");
    if (raw.length < 3) continue;
    if (!/^[A-Z]/.test(raw)) continue;
    if (i === 0) continue; // leading word of a sentence is always capitalized
    if (LEXICON.has(raw.toLowerCase())) continue;
    if (known.includes(raw.toLowerCase())) continue;
    return true;
  }
  return false;
}

function knownText(bundle: DeskBrainBundle): string {
  const parts: string[] = [
    bundle.account.name,
    bundle.account.dba ?? "",
    bundle.account.industry,
    bundle.account.state,
    bundle.account.primaryUwName,
    bundle.account.primaryUwCarrier,
    bundle.account.backupUwName ?? "",
  ];
  for (const p of bundle.policies) {
    parts.push(p.policyNumber, p.carrier, ...p.coverages);
    const set = bundle.formSets[p.id];
    if (set) {
      for (const c of set.coverages) parts.push(c.form, c.label);
      for (const e of set.endorsements) parts.push(e.form, e.title);
    }
  }
  for (const t of bundle.threads) {
    parts.push(t.subject, t.underwriterName ?? "", t.carrier, t.policyNumber);
  }
  if (bundle.ticket) {
    parts.push(
      bundle.ticket.subject,
      bundle.ticket.holderName ?? "",
      bundle.ticket.holderAddress ?? "",
      bundle.ticket.srNumber,
      bundle.ticket.fastPathBasis ?? "",
    );
  }
  return parts.join(" \n ").toLowerCase();
}

// ——— Intent matching ———

const INTENT_PATTERNS: { intent: DeskBrainIntent; pattern: RegExp }[] = [
  {
    intent: "account_status",
    pattern:
      /account status|is (this|the) account (active|live|cancelled|canceled|in service)|payment (received|status|land)|(have|has) (they|the account|the insured) paid|pre[- ]?bind|when did (service|the account) (start|activate)/i,
  },
  {
    intent: "fast_path",
    pattern:
      /fast[- ]?path|skip(ped)? the market|why (was|is) (this|the market) skipped|blanket basis|issued without (the )?market/i,
  },
  {
    intent: "ticket_status",
    pattern:
      /sr[- ]?number|ticket (status|number)|status of (this|the) (ticket|request|sr)|where (does|is) (this|the) ticket|what('|’)?s the sr/i,
  },
  {
    intent: "holder",
    pattern: /\bholder\b|certificate holder|who (is|gets) the cert/i,
  },
  {
    intent: "blanket",
    pattern: /blanket|automatic (ai|additional insured|waiver|status)/i,
  },
  {
    intent: "price_history",
    pattern:
      /price history|going rate|(usually|typically|historically|normally) (pay|charge|cost|run)|what (do|does|did) (we|the desk|this desk) (usually |typically )?pay|desk history|(price|cost|charge) (of|for) a (waiver|wos|ai\b|additional insured|notice|pnc|endorsement)/i,
  },
  {
    intent: "premium",
    pattern:
      /\bpremiums?\b|how much (is|are|does) (the|each|this|that) polic|polic(y|ies) cost/i,
  },
  {
    intent: "limits",
    pattern:
      /\blimits?\b|each occurrence|per occurrence|aggregate|med(ical)? (exp|expense|pay)|combined single|\bcsl\b|damage to (rented )?premises|personal (and|&) advertising|products.{0,3}completed|employers.? liabilit|\be\.?l\.?\b each/i,
  },
  {
    intent: "endorsements",
    pattern:
      /endorsements?|what forms|forms (on|are)|schedule of forms|waiver of subrogation|\bwos\b|\bwaivers?\b|additional insureds?|\bai\b|\bpnc\b|primary (and|&) non/i,
  },
  {
    intent: "threads",
    pattern:
      /\bthreads?\b|underwriter (say|said|reply|replied|respond)|market (say|said|come back|came back|reply|replied|respond)|gone to market|been to market|heard (back|from)|any repl|what did .* say|conversation/i,
  },
  {
    intent: "policies",
    pattern:
      /\bcarriers?\b|who writes|polic(y|ies)|policy numbers?|\bterms?\b|effective|expir|when does .*(renew|expire)|coverages? (do|on|carried)/i,
  },
];

export function matchDeskBrainIntent(question: string): DeskBrainIntent | null {
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(question)) return intent;
  }
  return null;
}

// ——— The ask ———

export function askDeskBrain(
  question: string,
  bundle: DeskBrainBundle,
): DeskBrainResult {
  const q = question.trim();
  if (!q) return refuse();
  if (mentionsForeignEntity(q, bundle)) return refuse();

  const intent = matchDeskBrainIntent(q);
  if (!intent) return refuse();

  switch (intent) {
    case "account_status":
      return answerAccountStatus(bundle);
    case "fast_path":
      return answerFastPath(bundle);
    case "ticket_status":
      return answerTicketStatus(bundle);
    case "holder":
      return answerHolder(bundle);
    case "blanket":
      return answerBlanket(q, bundle);
    case "price_history":
      return answerPriceHistory(q, bundle);
    case "premium":
      return answerPremium(bundle);
    case "limits":
      return answerLimits(q, bundle);
    case "endorsements":
      return answerEndorsements(q, bundle);
    case "threads":
      return answerThreads(bundle);
    case "policies":
      return answerPolicies(bundle);
  }
}

function refuse(): DeskBrainResult {
  return { kind: "refusal", answer: DESK_BRAIN_REFUSAL };
}

function answer(
  intent: DeskBrainIntent | DeskWideIntent,
  text: string,
  citations: DeskBrainCitation[],
): DeskBrainResult {
  return { kind: "answer", intent, answer: text, citations: dedupe(citations) };
}

function dedupe(citations: DeskBrainCitation[]): DeskBrainCitation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.label}|${c.href ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function accountCitation(bundle: DeskBrainBundle): DeskBrainCitation {
  return {
    label: bundle.account.name,
    href: `/accounts/${bundle.account.id}`,
  };
}

function policyCitation(
  bundle: DeskBrainBundle,
  p: BrainPolicy,
): DeskBrainCitation {
  return {
    label: `${p.policyNumber} · ${p.carrier}`,
    href: `/accounts/${bundle.account.id}`,
  };
}

function ticketCitations(bundle: DeskBrainBundle): DeskBrainCitation[] {
  if (!bundle.ticket) return [];
  return [
    {
      label: bundle.ticket.srNumber || "Ticket",
      href: `/tickets/${bundle.ticket.id}`,
    },
    { label: "Trace", href: `/trace?ticket=${bundle.ticket.id}` },
  ];
}

// ——— Intent answers ———

function answerAccountStatus(bundle: DeskBrainBundle): DeskBrainResult {
  const a = bundle.account;
  const label = ACCOUNT_STATUS_LABELS[a.status];
  let text: string;
  if (a.status === "active") {
    text = a.paymentReceivedAt
      ? `${a.name} is Active — payment received ${formatDate(a.paymentReceivedAt)}, which is when service went live.`
      : `${a.name} is Active. No payment timestamp is on the record.`;
  } else if (a.status === "pre_bind") {
    text = `${a.name} is Pre-Bind — quoted and bound, but payment has not been received. Paper issues once payment is recorded.`;
  } else {
    text = `${a.name} is Cancelled — no active service on this account.`;
  }
  return answer("account_status", text, [
    { label: `Status — ${label}` },
    accountCitation(bundle),
  ]);
}

function answerFastPath(bundle: DeskBrainBundle): DeskBrainResult {
  const t = bundle.ticket;
  if (!t) {
    return answer(
      "fast_path",
      "No ticket is in scope on this page — fast-path basis lives on a ticket. Open the ticket and ask there.",
      [accountCitation(bundle)],
    );
  }
  if (t.fastPathBasis) {
    return answer(
      "fast_path",
      `Yes — ${t.srNumber || "this ticket"} took the blanket fast path and skipped the market entirely. Basis on record: ${t.fastPathBasis}`,
      [{ label: t.fastPathBasis }, ...ticketCitations(bundle)],
    );
  }
  return answer(
    "fast_path",
    `${t.srNumber || "This ticket"} took the standard path — no blanket fast-path basis is on the record.`,
    ticketCitations(bundle),
  );
}

function answerTicketStatus(bundle: DeskBrainBundle): DeskBrainResult {
  const t = bundle.ticket;
  if (!t) {
    return answer(
      "ticket_status",
      "No ticket is in scope on this page — open a ticket to ask about its status or SR number.",
      [accountCitation(bundle)],
    );
  }
  const bits = [
    `${t.srNumber || "This ticket"} — ${ticketStatusLabel(t.status)}.`,
    `${t.requestTypeLabel}, opened ${formatDate(t.createdAt)}, last updated ${formatDate(t.updatedAt)}.`,
  ];
  if (t.closedAt) bits.push(`Closed ${formatDate(t.closedAt)}.`);
  if (t.fastPathBasis) bits.push(`Issued on the blanket fast path: ${t.fastPathBasis}`);
  return answer("ticket_status", bits.join(" "), ticketCitations(bundle));
}

function answerHolder(bundle: DeskBrainBundle): DeskBrainResult {
  const t = bundle.ticket;
  if (!t) {
    return answer(
      "holder",
      "No ticket is in scope on this page — certificate holder details live on a ticket.",
      [accountCitation(bundle)],
    );
  }
  if (!t.holderName) {
    return answer(
      "holder",
      `${t.srNumber || "This ticket"} has no certificate holder on the record.`,
      ticketCitations(bundle),
    );
  }
  const text = t.holderAddress
    ? `Certificate holder on ${t.srNumber || "this ticket"}: ${t.holderName}, ${t.holderAddress}.`
    : `Certificate holder on ${t.srNumber || "this ticket"}: ${t.holderName}. No address on the record.`;
  return answer("holder", text, [
    { label: t.holderName },
    ...ticketCitations(bundle),
  ]);
}

function answerBlanket(q: string, bundle: DeskBrainBundle): DeskBrainResult {
  const wantsWos = /waiver|subrogation|\bwos\b/i.test(q);
  const wantsAi = /\bai\b|additional insured/i.test(q);
  const kinds: ("ai" | "wos")[] =
    wantsWos && !wantsAi ? ["wos"] : wantsAi && !wantsWos ? ["ai"] : ["ai", "wos"];
  const kindLabel = { ai: "Additional Insured", wos: "Waiver Of Subrogation" };

  const lines: string[] = [];
  const citations: DeskBrainCitation[] = [];

  for (const kind of kinds) {
    const hits: { policy: BrainPolicy; form: EndorsementForm }[] = [];
    for (const p of bundle.policies) {
      const set = bundle.formSets[p.id];
      if (!set) continue;
      const form = findBlanketForm(set, kind);
      if (form) hits.push({ policy: p, form });
    }
    if (hits.length > 0) {
      for (const { policy, form } of hits) {
        lines.push(
          `Yes — blanket ${kindLabel[kind]} is on the paper: ${form.form} ${form.edition} (${form.title}) on ${policy.policyNumber} with ${policy.carrier}. It grants status automatically when a written contract requires it — wording only, no market contact needed.`,
        );
        citations.push(
          { label: `${form.form} ${form.edition}` },
          policyCitation(bundle, policy),
        );
      }
    } else {
      const scheduled = bundle.policies.some((p) =>
        bundle.formSets[p.id]?.endorsements.some(
          (e) => e.kind === kind && e.scope === "scheduled",
        ),
      );
      lines.push(
        scheduled
          ? `No blanket ${kindLabel[kind]} on this account — the ${kindLabel[kind]} forms on file are scheduled, so the holder must be named by the market.`
          : `No ${kindLabel[kind]} endorsement of any scope is on this account's schedule of record.`,
      );
      citations.push(accountCitation(bundle));
    }
  }
  return answer("blanket", lines.join(" "), citations);
}

/** Request-type keywords the price-history intent can resolve. */
const PRICE_TYPE_KEYWORDS: { pattern: RegExp; requestType: RequestTypeId }[] = [
  { pattern: /waiver|subrogation|\bwos\b/i, requestType: "waiver_of_subrogation" },
  { pattern: /additional insured|\bai\b/i, requestType: "additional_insured" },
  { pattern: /\bpnc\b|primary (and|&) non/i, requestType: "primary_non_contributory" },
  { pattern: /notice|cancellation/i, requestType: "notice_cancellation_30" },
  { pattern: /limit (change|increase|decrease)/i, requestType: "limit_change" },
];

function answerPriceHistory(q: string, bundle: DeskBrainBundle): DeskBrainResult {
  let requestType: RequestTypeId | null = null;
  for (const { pattern, requestType: rt } of PRICE_TYPE_KEYWORDS) {
    if (pattern.test(q)) {
      requestType = rt;
      break;
    }
  }
  if (!requestType && bundle.ticket) requestType = bundle.ticket.requestType;
  if (!requestType) {
    return answer(
      "price_history",
      "Name the request — a waiver, an additional insured, a notice of cancellation — and the desk's quote history for it can be pulled.",
      [accountCitation(bundle)],
    );
  }

  const label = getRequestType(requestType).label;
  const all = summarizeQuotes(bundle.quoteSamples);
  const carriers = [...new Set(bundle.policies.map((p) => p.carrier))];
  const lines: string[] = [];
  const citations: DeskBrainCitation[] = [];
  let quotable = 0;

  for (const carrier of carriers) {
    const g = all[`${carrier}::${requestType}`] ?? null;
    if (!guidanceIsQuotable(g) || !g) continue;
    quotable++;
    const priced = g.priced;
    if (priced) {
      const range =
        priced.minCents === priced.maxCents
          ? formatMoney(priced.medianCents)
          : `${formatMoney(priced.minCents)}–${formatMoney(priced.maxCents)} (median ${formatMoney(priced.medianCents)})`;
      lines.push(
        `${carrier} ${label}: quoted at ${range} across ${g.sampleCount} real quotes on this desk${g.zeroCount > 0 ? `, ${g.zeroCount} of which came back no charge` : ""}. Indication only — the market still sets the price.`,
      );
    } else {
      lines.push(
        `${carrier} ${label}: all ${g.sampleCount} quotes on this desk came back no charge.`,
      );
    }
    citations.push({ label: `${g.sampleCount} Quoted Threads With ${carrier}` });
  }

  if (quotable === 0) {
    const thin = carriers
      .map((c) => all[`${c}::${requestType}`] ?? null)
      .filter((g): g is NonNullable<typeof g> => g != null);
    const count = thin.reduce((n, g) => n + g.sampleCount, 0);
    return answer(
      "price_history",
      count > 0
        ? `The desk lacks enough history to quote a number for ${label} on this account's carriers — only ${count} prior quote${count === 1 ? "" : "s"}, under the ${MIN_QUOTE_SAMPLES}-quote minimum. Ask the market rather than guess.`
        : `The desk lacks history for ${label} with ${carriers.join(" or ")} — no prior quotes on record. Ask the market rather than guess.`,
      [accountCitation(bundle)],
    );
  }
  return answer("price_history", lines.join(" "), citations);
}

function answerPremium(bundle: DeskBrainBundle): DeskBrainResult {
  if (bundle.policies.length === 0) {
    return answer("premium", "No policies are on this account's record.", [
      accountCitation(bundle),
    ]);
  }
  const lines = bundle.policies.map(
    (p) =>
      `${p.policyNumber} (${p.carrier}): ${formatMoney(p.premiumCents)} premium, term ${p.effectiveDate} → ${p.expirationDate}.`,
  );
  return answer(
    "premium",
    lines.join(" "),
    bundle.policies.map((p) => policyCitation(bundle, p)),
  );
}

/** Question keywords → the limit slots they name. */
const SLOT_KEYWORDS: { pattern: RegExp; slots: LimitSlot[] }[] = [
  { pattern: /each occurrence|per occurrence/i, slots: ["gl_each_occurrence", "umb_each_occurrence"] },
  { pattern: /damage to (rented )?premises|rented premises/i, slots: ["gl_damage_premises"] },
  { pattern: /med(ical)? (exp|expense|pay)/i, slots: ["gl_med_exp"] },
  { pattern: /personal (and|&) advertising|advertising injury/i, slots: ["gl_personal_adv"] },
  { pattern: /general aggregate/i, slots: ["gl_general_aggregate"] },
  { pattern: /products.{0,3}completed|completed op/i, slots: ["gl_products_completed_ops"] },
  { pattern: /liquor/i, slots: ["liquor_each_common_cause"] },
  { pattern: /combined single|\bcsl\b/i, slots: ["auto_combined_single"] },
  { pattern: /umbrella|excess/i, slots: ["umb_each_occurrence", "umb_aggregate"] },
  {
    pattern: /employers.? liabilit|\be\.?l\.?\b|workers comp/i,
    slots: ["wc_el_each_accident", "wc_el_disease_employee", "wc_el_disease_policy"],
  },
  { pattern: /professional|\beo\b|e&o|each claim/i, slots: ["prof_each_claim", "prof_aggregate"] },
  { pattern: /cyber/i, slots: ["cyber_aggregate"] },
];

const GL_SLOTS: LimitSlot[] = [
  "gl_each_occurrence",
  "gl_damage_premises",
  "gl_med_exp",
  "gl_personal_adv",
  "gl_general_aggregate",
  "gl_products_completed_ops",
];

function answerLimits(q: string, bundle: DeskBrainBundle): DeskBrainResult {
  let slotFilter: Set<LimitSlot> | null = null;
  const wanted = new Set<LimitSlot>();
  for (const { pattern, slots } of SLOT_KEYWORDS) {
    if (pattern.test(q)) for (const s of slots) wanted.add(s);
  }
  // "GL limits" with no finer keyword → the GL block.
  if (wanted.size === 0 && /\bgl\b|general liability/i.test(q)) {
    for (const s of GL_SLOTS) wanted.add(s);
  }
  if (wanted.size > 0) slotFilter = wanted;

  const lines: string[] = [];
  const citations: DeskBrainCitation[] = [];
  for (const p of bundle.policies) {
    const set = bundle.formSets[p.id];
    if (!set || set.limits.length === 0) continue;
    const limits = slotFilter
      ? set.limits.filter((l) => slotFilter.has(l.slot))
      : set.limits;
    if (limits.length === 0) continue;
    const stated = limits
      .map((l) => `${LIMIT_SLOT_LABELS[l.slot]} ${limitStatement(l)}`)
      .join("; ");
    lines.push(`${p.policyNumber} (${p.carrier}): ${stated}.`);
    citations.push(policyCitation(bundle, p));
    for (const c of set.coverages) {
      if (c.form !== "—") citations.push({ label: `${c.form} ${c.edition}`.trim() });
    }
  }

  if (lines.length === 0) {
    return answer(
      "limits",
      slotFilter
        ? "The schedule of record does not state that limit on any policy for this account."
        : "No limits are on the schedule of record for this account's policies.",
      [accountCitation(bundle)],
    );
  }
  return answer("limits", lines.join(" "), citations);
}

function answerEndorsements(q: string, bundle: DeskBrainBundle): DeskBrainResult {
  const wantsWos = /waiver|subrogation|\bwos\b/i.test(q);
  const wantsAi = /additional insured|\bai\b/i.test(q);
  const wantsPnc = /\bpnc\b|primary (and|&) non/i.test(q);
  const kindFilter =
    wantsWos && !wantsAi && !wantsPnc
      ? "wos"
      : wantsAi && !wantsWos && !wantsPnc
        ? "ai"
        : wantsPnc && !wantsAi && !wantsWos
          ? "pnc"
          : null;

  const lines: string[] = [];
  const citations: DeskBrainCitation[] = [];
  for (const p of bundle.policies) {
    const set = bundle.formSets[p.id];
    if (!set) continue;
    const forms = kindFilter
      ? set.endorsements.filter((e) => e.kind === kindFilter)
      : set.endorsements;
    if (forms.length === 0) continue;
    const stated = forms
      .map(
        (e) =>
          `${e.form} ${e.edition} — ${e.title}${e.scope ? ` (${e.scope === "blanket" ? "Blanket" : "Scheduled"})` : ""}`,
      )
      .join("; ");
    lines.push(`${p.policyNumber} (${p.carrier}): ${stated}.`);
    citations.push(policyCitation(bundle, p));
    for (const e of forms) citations.push({ label: `${e.form} ${e.edition}` });
  }

  if (lines.length === 0) {
    return answer(
      "endorsements",
      kindFilter
        ? "No endorsement of that kind is on the schedule of record for this account."
        : "No endorsements are on the schedule of record for this account's policies.",
      [accountCitation(bundle)],
    );
  }
  return answer("endorsements", lines.join(" "), citations);
}

function answerThreads(bundle: DeskBrainBundle): DeskBrainResult {
  const scope = bundle.ticket
    ? bundle.ticket.srNumber || "this ticket"
    : "this account";
  if (bundle.threads.length === 0) {
    return answer(
      "threads",
      `No market threads on record for ${scope} — it has not gone to market.`,
      bundle.ticket ? ticketCitations(bundle) : [accountCitation(bundle)],
    );
  }

  const lines: string[] = [
    `${bundle.threads.length} market thread${bundle.threads.length === 1 ? "" : "s"} on record for ${scope}.`,
  ];
  for (const t of bundle.threads) {
    const uwReplies = t.messages.filter((m) => m.role === "underwriter");
    const last = uwReplies[uwReplies.length - 1];
    if (last) {
      const priceBit =
        last.premiumImpactCents == null
          ? ""
          : last.premiumImpactCents === 0
            ? " (no additional premium)"
            : ` (quoted ${formatMoney(last.premiumImpactCents)})`;
      lines.push(
        `${t.underwriterName ?? "The market desk"} (${t.carrier}, ${t.policyNumber}) last replied ${formatDate(last.createdAt)}${priceBit}: “${truncate(last.body, 220)}”`,
      );
    } else if (t.messages.length > 0) {
      lines.push(
        `Thread with ${t.underwriterName ?? "the market desk"} (${t.carrier}, ${t.policyNumber}): sent, no underwriter reply yet.`,
      );
    } else {
      lines.push(
        `Thread “${t.subject}” (${t.carrier}${t.policyNumber ? `, ${t.policyNumber}` : ""}): ${t.status.replace(/_/g, " ")}${t.offeredPremiumCents != null ? `, offered ${t.offeredPremiumCents === 0 ? "no charge" : formatMoney(t.offeredPremiumCents)}` : ""}.`,
      );
    }
  }

  const citations: DeskBrainCitation[] = bundle.ticket
    ? [
        {
          label: `${bundle.ticket.srNumber || "Ticket"} Comms`,
          href: `/tickets/${bundle.ticket.id}?tab=comms`,
        },
        { label: "Trace", href: `/trace?ticket=${bundle.ticket.id}` },
      ]
    : [accountCitation(bundle)];
  return answer("threads", lines.join(" "), citations);
}

function answerPolicies(bundle: DeskBrainBundle): DeskBrainResult {
  if (bundle.policies.length === 0) {
    return answer("policies", "No policies are on this account's record.", [
      accountCitation(bundle),
    ]);
  }
  const lines = bundle.policies.map(
    (p) =>
      `${p.policyNumber} with ${p.carrier} (${p.coverages.join(", ")}), term ${p.effectiveDate} → ${p.expirationDate}.`,
  );
  return answer(
    "policies",
    `${bundle.account.name} carries ${bundle.policies.length} polic${bundle.policies.length === 1 ? "y" : "ies"}: ${lines.join(" ")}`,
    bundle.policies.map((p) => policyCitation(bundle, p)),
  );
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

// ——— Desk-wide intents (Step Bro Bot) ———

const DESK_WIDE_PATTERNS: { intent: DeskWideIntent; pattern: RegExp }[] = [
  // Order matters: "who has the most open tickets" must hit operator load
  // before the open-tickets pattern claims it.
  { intent: "desk_escalations", pattern: /escalat/i },
  {
    intent: "desk_changed_today",
    pattern:
      /(changed|updated|happened|moved) today|today('|’)?s (change|update|activit)|what changed|what('|’)?s new/i,
  },
  {
    intent: "desk_operator_load",
    pattern:
      /most open|who (has|holds|owns|carries|is working)|busiest|operator (load|count)|workload|per operator/i,
  },
  {
    intent: "desk_pending",
    pattern:
      /\bpending\b|\bintake\b|awaiting triage|untriaged|waiting to be (triaged|ticketed)/i,
  },
  {
    intent: "desk_prebind_accounts",
    pattern:
      /pre[- ]?bind|which accounts|list (the )?accounts|how many accounts|accounts? (on the desk|do we (have|serve))/i,
  },
  {
    intent: "desk_open_tickets",
    pattern:
      /how many tickets|open tickets?|tickets? (are )?open|ticket count|queue (size|look)|how('|’)?s the queue|status of the queue/i,
  },
];

export function matchDeskWideIntent(question: string): DeskWideIntent | null {
  for (const { intent, pattern } of DESK_WIDE_PATTERNS) {
    if (pattern.test(question)) return intent;
  }
  return null;
}

function knownDeskText(bundle: DeskWideBundle): string {
  const parts: string[] = [];
  for (const a of bundle.accounts) parts.push(a.name);
  for (const o of bundle.operators) parts.push(o.name);
  for (const e of bundle.escalations) parts.push(e.srNumber, e.toName ?? "");
  for (const c of bundle.changedToday) parts.push(c.srNumber, c.subject);
  return parts.join(" \n ").toLowerCase();
}

/**
 * Desk-wide ask — same doctrine as askDeskBrain, wider record. Every answer
 * comes verbatim from the DeskWideBundle the server assembled; anything the
 * desk record cannot back gets the one desk-wide refusal line.
 */
export function askDeskWide(
  question: string,
  bundle: DeskWideBundle,
): DeskBrainResult {
  const q = question.trim();
  if (!q) return refuseDeskWide();
  if (hasUnknownProperNoun(q, knownDeskText(bundle))) return refuseDeskWide();

  const intent = matchDeskWideIntent(q);
  if (!intent) return refuseDeskWide();

  switch (intent) {
    case "desk_open_tickets":
      return answerDeskOpenTickets(bundle);
    case "desk_pending":
      return answerDeskPending(bundle);
    case "desk_operator_load":
      return answerDeskOperatorLoad(bundle);
    case "desk_prebind_accounts":
      return answerDeskPrebindAccounts(bundle);
    case "desk_escalations":
      return answerDeskEscalations(bundle);
    case "desk_changed_today":
      return answerDeskChangedToday(bundle);
  }
}

function refuseDeskWide(): DeskBrainResult {
  return { kind: "refusal", answer: DESK_WIDE_REFUSAL };
}

const OPEN_STATUSES: TicketStatus[] = [
  "intake",
  "drafting",
  "waiting_market",
  "needs_you",
  "ready_to_issue",
];

function answerDeskOpenTickets(b: DeskWideBundle): DeskBrainResult {
  const open = b.openTicketCount;
  const queueCite: DeskBrainCitation = {
    label: `Queue · ${open} Open`,
    href: "/queue",
  };
  if (open === 0) {
    return answer(
      "desk_open_tickets",
      "No tickets are open on the desk — every SR is delivered or closed.",
      [queueCite],
    );
  }
  const parts = b.ticketCounts
    .filter((c) => c.count > 0 && OPEN_STATUSES.includes(c.status))
    .map((c) => `${c.count} ${ticketStatusLabel(c.status)}`);
  const unclaimed =
    b.unclaimedOpenCount > 0
      ? ` ${b.unclaimedOpenCount} of them ${b.unclaimedOpenCount === 1 ? "is" : "are"} unclaimed.`
      : "";
  return answer(
    "desk_open_tickets",
    `${open} ticket${open === 1 ? " is" : "s are"} open on the desk — ${parts.join(", ")}.${unclaimed}`,
    [queueCite],
  );
}

const CHANNEL_LABELS: Record<IntakeChannel, string> = {
  email: "Email",
  text: "Text",
  call: "Call",
};

function answerDeskPending(b: DeskWideBundle): DeskBrainResult {
  const total = b.pendingIntake.reduce((n, c) => n + c.count, 0);
  if (total === 0) {
    return answer(
      "desk_pending",
      "Nothing is pending intake — the service inbox, texts, and calls are all triaged.",
      [{ label: "Comms · 0 Awaiting Triage", href: "/comms" }],
    );
  }
  const parts = b.pendingIntake
    .filter((c) => c.count > 0)
    .map((c) => `${c.count} ${CHANNEL_LABELS[c.channel]}`);
  return answer(
    "desk_pending",
    `${total} communication${total === 1 ? " is" : "s are"} pending triage on the intake board — ${parts.join(", ")}. Nothing becomes an SR without a match or an operator's confirmation.`,
    [{ label: `Comms · ${total} Awaiting Triage`, href: "/comms" }],
  );
}

function answerDeskOperatorLoad(b: DeskWideBundle): DeskBrainResult {
  const ranked = [...b.operators].sort((x, y) => y.openTickets - x.openTickets);
  const top = ranked[0];
  if (!top || top.openTickets === 0) {
    return answer(
      "desk_operator_load",
      b.unclaimedOpenCount > 0
        ? `No operator holds an open ticket — all ${b.unclaimedOpenCount} open ticket${b.unclaimedOpenCount === 1 ? " is" : "s are"} unclaimed.`
        : "No operator holds an open ticket right now.",
      [{ label: "Queue", href: "/queue" }],
    );
  }
  const loaded = ranked.filter((o) => o.openTickets > 0);
  const full = loaded.map((o) => `${o.name} ${o.openTickets}`).join(", ");
  const unclaimed =
    b.unclaimedOpenCount > 0
      ? ` ${b.unclaimedOpenCount} more ${b.unclaimedOpenCount === 1 ? "sits" : "sit"} unclaimed in the queue.`
      : "";
  return answer(
    "desk_operator_load",
    `${top.name} has the most open tickets — ${top.openTickets}. Full load: ${full}.${unclaimed}`,
    [
      { label: `${top.name} · ${top.openTickets} Open` },
      { label: "Queue", href: "/queue" },
    ],
  );
}

function answerDeskPrebindAccounts(b: DeskWideBundle): DeskBrainResult {
  const pre = b.accounts.filter((a) => a.status === "pre_bind");
  if (pre.length === 0) {
    const active = b.accounts.filter((a) => a.status === "active").length;
    const cancelled = b.accounts.filter((a) => a.status === "cancelled").length;
    return answer(
      "desk_prebind_accounts",
      `No accounts are Pre-Bind. Of ${b.accounts.length} on the desk, ${active} ${active === 1 ? "is" : "are"} Active and ${cancelled} Cancelled.`,
      [{ label: `Accounts · ${b.accounts.length}`, href: "/accounts" }],
    );
  }
  return answer(
    "desk_prebind_accounts",
    `${pre.length} account${pre.length === 1 ? " is" : "s are"} Pre-Bind — quoted and bound, waiting on payment: ${pre.map((a) => a.name).join(", ")}.`,
    pre.map((a) => ({ label: a.name, href: `/accounts/${a.id}` })),
  );
}

function answerDeskEscalations(b: DeskWideBundle): DeskBrainResult {
  if (b.escalations.length === 0) {
    return answer(
      "desk_escalations",
      "No open escalations — no tickets are flagged for assistance right now.",
      [{ label: "Escalations · 0 Open" }, { label: "Queue", href: "/queue" }],
    );
  }
  const lines = b.escalations.map((e) => {
    const who = e.toName ? ` to ${e.toName}` : "";
    const due = e.dueBy ? `, due ${formatDate(e.dueBy)}` : "";
    return `${e.srNumber}${who}${due}`;
  });
  return answer(
    "desk_escalations",
    `${b.escalations.length} ticket${b.escalations.length === 1 ? " is" : "s are"} escalated and unresolved: ${lines.join("; ")}.`,
    [
      { label: `Escalations · ${b.escalations.length} Open` },
      ...b.escalations.map((e) => ({
        label: e.srNumber,
        href: `/tickets/${e.ticketId}`,
      })),
    ],
  );
}

function answerDeskChangedToday(b: DeskWideBundle): DeskBrainResult {
  if (b.changedToday.length === 0) {
    return answer(
      "desk_changed_today",
      "No ticket has changed today — nothing on the desk record moved.",
      [{ label: "Queue", href: "/queue" }],
    );
  }
  const shown = b.changedToday.slice(0, 8);
  const more = b.changedToday.length - shown.length;
  const lines = shown.map(
    (c) => `${c.srNumber} (${ticketStatusLabel(c.status)})`,
  );
  return answer(
    "desk_changed_today",
    `${b.changedToday.length} ticket${b.changedToday.length === 1 ? "" : "s"} changed today: ${lines.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
    [
      { label: `Queue · ${b.changedToday.length} Updated Today`, href: "/queue" },
      ...shown.map((c) => ({ label: c.srNumber, href: `/tickets/${c.ticketId}` })),
    ],
  );
}
