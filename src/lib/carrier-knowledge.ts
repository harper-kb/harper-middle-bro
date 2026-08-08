import { coverageLabel } from "./catalog";
import type { CoiFlags } from "./coi";
import { ISC_WRITERS } from "./naic";
import type { RequestTypeId } from "./types";

/**
 * Carrier knowledge registry — institutional knowledge per carrier, writing
 * company, coverage line, industry vertical, and state, recorded once and
 * enforced forever. Every entry is a stated or verified fact: restructured
 * from the desk's verified carrier notes or recorded from the desk manager's
 * own words, each with a source and a recorded-on date. Nothing here is
 * invented.
 *
 * Two kinds of power live in one shape:
 *
 * 1. CARDS — every entry renders on the carrier's desk page under Carrier
 *    Intelligence, grouped by scope, so the nuance is visible before the
 *    mistake happens.
 * 2. ENFORCEMENT — entries with `enforceable: true` and a `match` block gate
 *    the request flow (fast path + pre-send verification) and certificate
 *    preparation. A blocked action cites the entry (id + title) as the
 *    reason. Enforcement rules ship only through code review: operator-added
 *    entries (SQLite) render as cards and can warn, but can never silently
 *    hard-block — by design.
 *
 * Pure module — no database, no server imports — so the same registry runs
 * in the app and in the harness scripts. One-door integration note: the
 * request/cert evaluators below are self-contained and shaped so they can be
 * wrapped in a `CertCheckDef` and appended to the canonical presend check
 * registry (`cert-checks.ts` → `runCertChecks({ appendChecks })`) once the
 * one-door consolidation lands; until then `certificate.ts` merges the cert
 * findings directly into the packet verdict.
 */

export type KnowledgeKind =
  | "restriction"
  | "state_law"
  | "past_issue"
  | "practice_note";

export type KnowledgeSeverity = "blocker" | "warning" | "note";

/**
 * How an enforceable entry recognizes the action it gates. All specified
 * fields must match (AND semantics); an unspecified field matches anything.
 */
export interface KnowledgeMatch {
  /** Request types this entry gates (ticket / fast-path flow) */
  requestTypes?: RequestTypeId[];
  /** RegExp source tested against coverage codes and their catalog labels */
  coverageLinePattern?: string;
  /** RegExp source tested against the request wording */
  wordingPattern?: string;
  /** Two-letter state code the account must sit in */
  state?: string;
  /** RegExp source tested against the account's industry text */
  industryPattern?: string;
}

export interface CarrierKnowledgeEntry {
  /** Stable id — cited verbatim as the block reason */
  id: string;
  /** Carrier brand as it appears on policy records ("ISC", "Coterie", …) */
  carrier: string;
  /** Writing company scope, when the fact is about specific paper */
  writingCompany?: string;
  /** Coverage line scope, display label ("Excess Liability") */
  coverageLine?: string;
  /** Industry vertical scope, display label ("Contractors — Lease") */
  industryVertical?: string;
  /** State scope, display label ("Colorado (CO)") */
  state?: string;
  kind: KnowledgeKind;
  severity: KnowledgeSeverity;
  /**
   * Whether the desk enforces this entry in code. Only committed entries can
   * be enforceable — the operator form creates cards and warnings, never
   * silent auto-enforcement; a new hard block requires code review.
   */
  enforceable: boolean;
  /** Title Case display name */
  title: string;
  /** The fact, in precise prose */
  detail: string;
  /** What goes wrong if this is ignored */
  consequence: string;
  /** "Desk Experience", "Carrier Documentation", "Manager Direction", … */
  source: string;
  /** YYYY-MM-DD the fact was recorded into the registry */
  recordedAt: string;
  /** Enforcement matcher — present only on enforceable entries */
  match?: KnowledgeMatch;
  /**
   * Certificate provisions this entry forbids on a matching policy section.
   * A prepared certificate that claims one of these flags against a matching
   * policy is rejected with this entry as the reason.
   */
  certFlags?: (keyof CoiFlags)[];
}

/**
 * The desk's excess-line coverage codes: EXCESS_UMB ("Umbrella/Excess
 * Liability") and Umb ("Umbrella Liability"). The pattern also catches
 * spelled-out labels off imported schedules.
 */
export const EXCESS_LINE_PATTERN = "excess|umb";

/**
 * A 10-day Notice of Cancellation ask, in any phrasing that pairs "10 day"
 * with notice / cancellation / NOC language.
 */
export const TEN_DAY_NOC_PATTERN =
  "\\b(10|ten)[-\\s]?days?\\b[\\s\\S]{0,80}?\\b(notice|cancell?ation|noc)\\b|\\b(notice|noc)\\b[\\s\\S]{0,80}?\\b(10|ten)[-\\s]?days?\\b";

export function isTenDayNocAsk(wording: string): boolean {
  return new RegExp(TEN_DAY_NOC_PATTERN, "i").test(wording);
}

const iscWriterEntries: CarrierKnowledgeEntry[] = ISC_WRITERS.map((w) => ({
  id: `isc-writer-${w.naic}`,
  carrier: "ISC",
  writingCompany: w.issuingCompany,
  kind: "practice_note" as const,
  severity: "note" as const,
  enforceable: false,
  title: `Paper Issues On ${w.issuingCompany} (NAIC ${w.naic})`,
  detail: `ISC (Instant Specialty) holds no carrier license and no National Association of Insurance Commissioners (NAIC) code of its own. ${w.note ?? ""} The declarations page governs which writer a given policy issues on, and the desk records the writer per policy at intake.`,
  consequence:
    "A certificate that prints ISC — or the wrong writer — on the INSURER line misidentifies the insurer and fails validation. The INSURER line prints the writing company and its verified NAIC code, never the Managing General Agent (MGA).",
  source: "Carrier Documentation",
  recordedAt: "2026-08-08",
}));

/**
 * The committed registry. Entries are restructured from verified desk
 * knowledge already in the codebase (`carriers.ts` known notes, the NAIC
 * writer registry, the ISC market panel) plus the desk manager's stated
 * rules recorded 2026-08-08. Categories with no verified entries stay empty
 * on the carrier page — an honest empty state beats filler.
 */
export const CARRIER_KNOWLEDGE: CarrierKnowledgeEntry[] = [
  // ————— ISC — enforced restrictions (the two seed rules) —————
  {
    id: "isc-excess-no-additional-insured",
    carrier: "ISC",
    coverageLine: "Excess Liability",
    kind: "restriction",
    severity: "blocker",
    enforceable: true,
    title: "Excess Lines Cannot Take Additional Insured Status",
    detail:
      "When a policy is placed through ISC (the MGA) and the line is Excess Liability — an excess policy, for example on Sutton National paper — an Additional Insured (AI) cannot be added to the excess line. It cannot be endorsed, and it must never appear on a certificate against the excess line.",
    consequence:
      "The desk has issued certificates showing Additional Insured status against an ISC excess line in the past; every one of them was rework. Requesting the endorsement wastes a market touch (ISC will not issue it), and certifying it claims coverage the paper does not grant.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
    match: {
      requestTypes: ["additional_insured", "blanket_ai_wos"],
      coverageLinePattern: EXCESS_LINE_PATTERN,
    },
    certFlags: ["additionalInsured"],
  },
  {
    id: "isc-co-contractors-lease-no-10-day-noc",
    carrier: "ISC",
    industryVertical: "Contractors — Lease",
    state: "Colorado (CO)",
    kind: "restriction",
    severity: "blocker",
    enforceable: true,
    title: "No 10-Day Notice Of Cancellation For Non-Payment — Lease Vertical, Colorado",
    detail:
      "Some ISC carrier verticals will not offer a 10-day Notice of Cancellation (NOC) for non-payment. Confirmed combination: the lease vertical under contractors, in the state of Colorado — ISC does not offer the 10-day non-payment notice there. This entry encodes exactly that combination; it is not generalized to other states or verticals without data.",
    consequence:
      "Promising a 10-day notice the market will not endorse means walking the promise back with the holder, and a certificate claiming it would certify wording the policy does not carry. Stop before the desk promises it or routes the ask to certs@iscmga.com.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
    match: {
      wordingPattern: TEN_DAY_NOC_PATTERN,
      state: "CO",
      industryPattern: "leas(e|ing)",
    },
  },
  {
    id: "isc-co-10-day-noc-desk-note",
    carrier: "ISC",
    state: "Colorado (CO)",
    kind: "restriction",
    severity: "warning",
    enforceable: true,
    title: "Colorado 10-Day Notice Of Cancellation Not Seen Available",
    detail:
      "Desk history on ISC paper in Colorado: the 10-day Notice of Cancellation has not been available — 30-day only. Recorded as a desk-experience warning, not a verified blanket rule; the confirmed hard case is the contractors/lease vertical (see isc-co-contractors-lease-no-10-day-noc).",
    consequence:
      "A 10-day notice promised on Colorado ISC paper is likely to come back unendorsable. Confirm with ISC before committing to the holder.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
    match: {
      wordingPattern: TEN_DAY_NOC_PATTERN,
      state: "CO",
    },
  },

  // ————— ISC — writing companies (verified NAIC registry) —————
  ...iscWriterEntries,

  // ————— ISC — practice notes (verified desk knowledge) —————
  {
    id: "isc-mga-path",
    carrier: "ISC",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "MGA Path — Work ISC Directly",
    detail:
      "Harper works Instant Specialty (ISC) directly as the Managing General Agent (MGA) of record. Do not flatten ISC tickets to the behind-carrier inbox — the ultimate paper carrier sits behind ISC and is not Harper's first contact.",
    consequence:
      "A request sent past the MGA to the paper carrier stalls: the carrier routes it back to ISC and the desk loses the round trip.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "isc-portal-scope",
    carrier: "ISC",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Portal Scope And Session Behavior",
    detail:
      "The Instant Specialty portal handles Additional Insured, name, and address endorsements: countersign, then bind, then download the documents, then validate. Portal sessions drop around 6 PM.",
    consequence:
      "Endorsements attempted outside the portal's scope go nowhere, and an evening session can drop mid-endorsement — re-verify anything bound near the cutoff.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "isc-30-day-noc-loop",
    carrier: "ISC",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "30-Day Notice Of Cancellation Runs Through certs@iscmga.com",
    detail:
      "30-day notices and subjectivities are not on the portal. Prepare the certificate first, then email it to certs@iscmga.com with the endorsement request. ISC replies with a charge for the endorsement — about $100 in desk history — which must be approved before the endorsement issues.",
    consequence:
      "Skipping the prepared certificate or the charge approval stalls the endorsement and adds a chase loop with the certs desk.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "isc-financing-commission",
    carrier: "ISC",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Financing Via Agile Or Jump; Commission On Full Premium",
    detail:
      "ISC accounts often finance through Agile or Jump. Commission applies to the full premium including fees.",
    consequence:
      "Quoting commission off base premium alone understates it on ISC paper.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— NEXT Insurance —————
  {
    id: "next-portal-advisory",
    carrier: "NEXT Insurance",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Portal-First Service — No Named Underwriter Email Verified",
    detail:
      "NEXT is a direct carrier path: portal first, not an MGA desk. Per-certificate Additional Insured / Waiver of Subrogation (AI/WOS) issues in the portal for about $10; a blanket Waiver of Subrogation requires the customer to call NEXT directly. No named underwriter email is verified in the Harper underwriter database — use the portal or the insured-call path.",
    consequence:
      "Emailing an unverified NEXT address goes nowhere; blanket waiver asks routed to the portal stall because the portal cannot grant them.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "next-no-daycares",
    carrier: "NEXT Insurance",
    industryVertical: "Child Care / Daycare",
    kind: "restriction",
    severity: "warning",
    enforceable: false,
    title: "No Longer Available For Daycares",
    detail:
      "NEXT no longer writes daycare risks. Markel is the instant-quote daycare option; Integrity or Frank Winston Crumb take full daycare submissions via wholesale.",
    consequence:
      "A daycare submission to NEXT is a guaranteed decline and a wasted market touch.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— Coterie —————
  {
    id: "coterie-blanket-baked-in",
    carrier: "Coterie",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Blanket AI And WOS Usually Baked Into The Instant-Quote Price",
    detail:
      "On Coterie, blanket Additional Insured and Waiver of Subrogation are usually included in the instant-quote price. Verify the policy before requesting either as a new endorsement.",
    consequence:
      "Requesting an endorsement the policy already grants wastes a touch and can confuse the insured with a phantom charge.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "coterie-billing-direct",
    carrier: "Coterie",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Billing Changes Often Run Customer ↔ Coterie Directly",
    detail:
      "Billing changes on Coterie frequently need the customer to work with Coterie directly rather than through the desk.",
    consequence:
      "The desk chasing a billing change Coterie will only take from the insured adds days of delay.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "coterie-commission-15",
    carrier: "Coterie",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Commission 15% As Of July 1 (Was 12%)",
    detail: "Coterie commission moved to 15% as of July 1; it was previously 12%.",
    consequence: "Revenue projections using the old 12% rate understate Coterie accounts.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— Hiscox —————
  {
    id: "hiscox-coastal-bop",
    carrier: "Hiscox",
    coverageLine: "Business Owners Policy (BOP)",
    kind: "restriction",
    severity: "warning",
    enforceable: false,
    title: "BOP Not Available In Coastal Zones; Building Coverage Often Excluded",
    detail:
      "Hiscox Business Owners Policy (BOP) is not available in coastal zones, and building coverage is often excluded where it does write.",
    consequence:
      "A coastal BOP submission declines; assuming building coverage exists on a bound Hiscox BOP leaves a gap.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "hiscox-service-by-email",
    carrier: "Hiscox",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Partner Portal Is For Quoting — Service Runs By Email",
    detail:
      "The Hiscox partner portal is a quoting tool. Service requests run by email to the underwriter on the account.",
    consequence: "Service asks filed in the quoting portal are not worked.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— AmTrust —————
  {
    id: "amtrust-garage-acord-30",
    carrier: "AmTrust",
    coverageLine: "Garage Liability",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Garage Certificates Go Out On ACORD 30",
    detail:
      "The AmTrust garage program (dealer / repair / tow) issues its certificates on ACORD 30, not ACORD 25.",
    consequence:
      "A garage certificate issued on ACORD 25 is the wrong form and comes back from the holder.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
  {
    id: "amtrust-bindability-issues",
    carrier: "AmTrust",
    kind: "past_issue",
    severity: "warning",
    enforceable: false,
    title: "Recurring Bindability Issues On Producer-Sold Policies",
    detail:
      "Producers have sometimes sold AmTrust approval-required policies without flagging the approval requirement, leaving the desk with a sold-but-not-bindable account.",
    consequence:
      "Servicing starts on a policy that cannot bind as sold; the desk inherits the walk-back with the insured.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— Kinsale —————
  {
    id: "kinsale-surplus-paperwork",
    carrier: "Kinsale",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Surplus Lines Paperwork Required (NAIC 38920)",
    detail:
      "Kinsale Insurance Company (NAIC 38920) is surplus lines paper — surplus lines tax and filing paperwork required on every placement.",
    consequence: "Missing surplus lines filings are a compliance exposure on the agency.",
    source: "Carrier Documentation",
    recordedAt: "2026-08-08",
  },
  {
    id: "kinsale-email-named-uw",
    carrier: "Kinsale",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Email The Named Underwriter For Subjectivities And Endorsement Quotes",
    detail:
      "Kinsale is the desk's highest-volume surplus market for Additional Insured, Primary & Non-Contributory, and endorsement-extraction requests. Subjectivities and endorsement quotes go by email to the named underwriter on the account.",
    consequence: "Requests sent to a generic inbox instead of the named underwriter sit unworked.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— USLI —————
  {
    id: "usli-docusign-scope",
    carrier: "USLI",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "DocuSign Is For Bind Packets Only",
    detail:
      "USLI uses DocuSign on bind packets — not for Additional Insured or endorsement emails.",
    consequence:
      "Routing an endorsement ask through the DocuSign flow buries it in bind paperwork nobody is watching for endorsements.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— RT Specialty —————
  {
    id: "rt-named-underwriter-routing",
    carrier: "RT Specialty",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Send To The Named Underwriter, Not A Shared Desk",
    detail:
      "RT Specialty is a wholesale path: submissions and service go to the named RT underwriter on the account, not a shared default desk. RTConnect / Insurance Helper carries submissions and forms; email or call when the portal errors (effective-date unlock, DocuSign).",
    consequence: "Work sent to a shared inbox on a wholesale account loses its owner.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },

  // ————— TMR —————
  {
    id: "tmr-reinstatement-discretion",
    carrier: "TMR",
    kind: "practice_note",
    severity: "note",
    enforceable: false,
    title: "Reinstatement At Carrier Discretion",
    detail:
      "TMR reinstatement after cancellation is at the carrier's discretion; IPFS is sometimes used for financing.",
    consequence: "Promising a reinstatement TMR has not agreed to over-commits the desk.",
    source: "Desk Experience",
    recordedAt: "2026-08-08",
  },
];

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  restriction: "Restriction",
  state_law: "State Law",
  past_issue: "Past Issue",
  practice_note: "Practice Note",
};

export const KNOWLEDGE_SEVERITY_LABELS: Record<KnowledgeSeverity, string> = {
  blocker: "Blocker",
  warning: "Warning",
  note: "Note",
};

// ————————————————— Matching & Enforcement —————————————————

export interface KnowledgePolicyLike {
  carrier: string;
  coverages: string[];
}

/** Carrier + coverage-line scope check for one policy. */
export function policyMatchesEntry(
  entry: CarrierKnowledgeEntry,
  policy: KnowledgePolicyLike,
): boolean {
  if (entry.carrier.trim().toLowerCase() !== policy.carrier.trim().toLowerCase()) {
    return false;
  }
  const pattern = entry.match?.coverageLinePattern;
  if (pattern) {
    const re = new RegExp(pattern, "i");
    if (!policy.coverages.some((c) => re.test(c) || re.test(coverageLabel(c)))) {
      return false;
    }
  }
  return true;
}

export interface KnowledgeRequestContext {
  requestType: RequestTypeId;
  wording: string;
  policy: KnowledgePolicyLike;
  /** Account scope, when the caller has it — state/vertical matchers need it */
  account?: { state: string; industry: string } | null;
}

export interface KnowledgeHit {
  entry: CarrierKnowledgeEntry;
  /** Why it fired, for the trace record */
  basis: string;
}

/**
 * Every enforceable registry entry that forbids (or warns on) this request
 * against this policy. All matcher fields on an entry must pass; an entry
 * needing account scope (state / vertical) never fires without the account.
 * Blockers sort first.
 */
export function evaluateKnowledgeForRequest(
  ctx: KnowledgeRequestContext,
): KnowledgeHit[] {
  const hits: KnowledgeHit[] = [];
  for (const entry of CARRIER_KNOWLEDGE) {
    if (!entry.enforceable || !entry.match) continue;
    const m = entry.match;
    if (!policyMatchesEntry(entry, ctx.policy)) continue;
    if (m.requestTypes && !m.requestTypes.includes(ctx.requestType)) continue;
    if (m.wordingPattern && !new RegExp(m.wordingPattern, "i").test(ctx.wording)) {
      continue;
    }
    if (m.state) {
      if (!ctx.account || ctx.account.state.trim().toUpperCase() !== m.state) continue;
    }
    if (m.industryPattern) {
      if (!ctx.account || !new RegExp(m.industryPattern, "i").test(ctx.account.industry)) {
        continue;
      }
    }
    const scope = [
      entry.coverageLine,
      entry.industryVertical,
      entry.state,
    ]
      .filter(Boolean)
      .join(" · ");
    hits.push({
      entry,
      basis: `${entry.carrier}${scope ? ` — ${scope}` : ""} matched on ${ctx.policy.carrier} ${ctx.policy.coverages.join("/")}`,
    });
  }
  return hits.sort((a, b) =>
    a.entry.severity === b.entry.severity ? 0 : a.entry.severity === "blocker" ? -1 : 1,
  );
}

export interface KnowledgeCertHit {
  entry: CarrierKnowledgeEntry;
  /** The forbidden certificate provision that was claimed */
  flag: keyof CoiFlags;
}

/**
 * Certificate-preparation gate: enforceable entries whose forbidden
 * provisions (`certFlags`) are claimed on a matching policy section. The
 * caller turns each hit into a visible reject on the packet — a forbidden
 * provision never rides out silently.
 */
export function evaluateKnowledgeForCertSection(input: {
  policy: KnowledgePolicyLike;
  flags: Partial<Record<keyof CoiFlags, boolean>>;
  account?: { state: string; industry: string } | null;
}): KnowledgeCertHit[] {
  const hits: KnowledgeCertHit[] = [];
  for (const entry of CARRIER_KNOWLEDGE) {
    if (!entry.enforceable || !entry.certFlags?.length) continue;
    if (!policyMatchesEntry(entry, input.policy)) continue;
    const m = entry.match;
    if (m?.state) {
      if (!input.account || input.account.state.trim().toUpperCase() !== m.state) continue;
    }
    if (m?.industryPattern) {
      if (
        !input.account ||
        !new RegExp(m.industryPattern, "i").test(input.account.industry)
      ) {
        continue;
      }
    }
    for (const flag of entry.certFlags) {
      if (input.flags[flag]) hits.push({ entry, flag });
    }
  }
  return hits;
}

// ————————————————— Display Grouping —————————————————

export type KnowledgeGroupId =
  | "writing_companies"
  | "coverage_restrictions"
  | "industry_verticals"
  | "state_notes"
  | "past_issues"
  | "practice_notes";

export const KNOWLEDGE_GROUPS: { id: KnowledgeGroupId; title: string }[] = [
  { id: "writing_companies", title: "Writing Companies" },
  { id: "coverage_restrictions", title: "Coverage Line Restrictions" },
  { id: "industry_verticals", title: "Industry Verticals" },
  { id: "state_notes", title: "State Notes & Laws" },
  { id: "past_issues", title: "Past Issues" },
  { id: "practice_notes", title: "Practice Notes" },
];

export function knowledgeGroupFor(entry: CarrierKnowledgeEntry): KnowledgeGroupId {
  if (entry.writingCompany) return "writing_companies";
  if (entry.kind === "past_issue") return "past_issues";
  if (entry.kind === "state_law" || entry.state) return "state_notes";
  if (entry.industryVertical) return "industry_verticals";
  if (entry.coverageLine || entry.kind === "restriction") {
    return "coverage_restrictions";
  }
  return "practice_notes";
}

const SEVERITY_ORDER: Record<KnowledgeSeverity, number> = {
  blocker: 0,
  warning: 1,
  note: 2,
};

/** All entries for one carrier — committed registry plus operator additions. */
export function knowledgeForCarrier(
  carrier: string,
  operatorEntries: CarrierKnowledgeEntry[] = [],
): CarrierKnowledgeEntry[] {
  const name = carrier.trim().toLowerCase();
  return [...CARRIER_KNOWLEDGE, ...operatorEntries]
    .filter((e) => e.carrier.trim().toLowerCase() === name)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Entries grouped for the Carrier Intelligence region, in display order. */
export function groupKnowledgeEntries(
  entries: CarrierKnowledgeEntry[],
): { id: KnowledgeGroupId; title: string; entries: CarrierKnowledgeEntry[] }[] {
  return KNOWLEDGE_GROUPS.map((g) => ({
    ...g,
    entries: entries.filter((e) => knowledgeGroupFor(e) === g.id),
  }));
}
