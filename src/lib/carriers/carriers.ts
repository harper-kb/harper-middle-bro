/** URL slug for a carrier name. Safe to use from Client Components. */
export function carrierSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface CarrierIntel {
  name: string;
  kind: "admitted" | "surplus" | "mga" | "wholesale" | "direct_bill";
  lines: string[];
  portal?: string;
  /** Default channel for this market */
  channel: "portal" | "email" | "phone" | "hybrid";
  /**
   * Exception / service inbox — only when a real address is verified.
   * Never invent no-reply / support / `.example` placeholders.
   */
  serviceEmail?: string;
  /**
   * Carrier offers a real public instant-quote / endorsement API we could
   * connect to. Suggestion-only flag — no integration exists yet, and no
   * endpoint may be invented. Only set when the API is verifiably public
   * (Coterie's partner quoting API); portal-based markets (ISC, Kinsale…)
   * stay unset.
   */
  instantQuoteApi?: boolean;
  known: string[];
  whenOut?: string;
}

/** What we know about Harper markets — for the contacts book. */
export const CARRIER_INTEL: CarrierIntel[] = [
  {
    name: "Hiscox",
    kind: "admitted",
    lines: ["GL", "PL", "Cyber", "BOP", "Tech E&O"],
    portal: "https://partner.hiscox.com",
    channel: "email",
    known: [
      "Core partner for GL / PL / Cyber packages",
      "Partner portal is for quoting — service runs by email to the UW",
      "BOP not available in coastal zones; building coverage often excluded",
    ],
    whenOut: "Use backup Hiscox UW on the account, or escalate to RT Specialty for hard-to-place",
  },
  {
    name: "Coterie",
    kind: "admitted",
    lines: ["GL", "BOP"],
    portal: "https://partners.coterie.com",
    channel: "portal",
    instantQuoteApi: true,
    known: [
      "Direct carrier path — partners portal first (not an MGA desk)",
      "Blanket AI and WOS usually baked into IQ price — verify before requesting",
      "Billing changes often need customer ↔ Coterie directly",
      "Commission moved to 15% as of July 1 (was 12%)",
    ],
    whenOut: "Try NEXT or ISC for similar small-commercial GL/BOP",
  },
  {
    name: "AmTrust",
    kind: "admitted",
    lines: ["WC", "Garage"],
    channel: "email",
    known: [
      "Primary Workers' Comp IQ market",
      "Garage program (dealer / repair / tow) — garage certs go out on ACORD 30",
      "Recurring bindability issues — producers sometimes sell approval-required policies without flagging",
    ],
    whenOut: "Shop Byberg / ByWork (Pie) when AmTrust declines",
  },
  {
    name: "NEXT Insurance",
    kind: "admitted",
    lines: ["GL", "BOP"],
    portal: "https://www.nextinsurance.com",
    channel: "portal",
    known: [
      "Direct carrier path — portal first (not an MGA desk)",
      "No longer available for daycares",
      "Per-cert AI/WOS in portal (~$10); blanket WOS requires a customer call to NEXT",
      "No named underwriter email verified in Harper UW DB — use portal / insured call path",
    ],
    whenOut: "Coterie or ISC for GL; Markel / full submission for daycare",
  },
  {
    name: "Markel",
    kind: "admitted",
    lines: ["GL", "Property", "Daycare packages"],
    portal: "https://www.markel.com",
    channel: "email",
    known: ["Daycare IQ option", "Used when NEXT cannot write the risk"],
    whenOut: "Integrity or Frank Winston Crumb for full daycare submissions via wholesale",
  },
  {
    name: "Kinsale",
    kind: "surplus",
    lines: ["GL", "PL", "Excess"],
    portal: "https://portal.kinsaleins.com",
    channel: "email",
    known: [
      "Highest-volume surplus market for additional insured, primary & non-contributory, and endorsement extraction requests",
      "Email the named UW for subjectivities and endorsement quotes",
      "NAIC 38920 — surplus lines paperwork required",
    ],
    whenOut: "Use backup Kinsale UW on account; alternate via RT Specialty or AMWins",
  },
  {
    name: "Thimble",
    kind: "surplus",
    lines: ["GL"],
    channel: "email",
    known: ["Multi-location GL policies common"],
    whenOut: "USLI or ISC for similar GL",
  },
  {
    name: "USLI",
    kind: "surplus",
    lines: ["GL", "Liquor", "Specialty"],
    portal: "https://www.usli.com",
    channel: "email",
    known: [
      "Direct or agency bill",
      "DocuSign on bind packets — not for AI / endorsement emails",
    ],
    whenOut: "Thimble / ISC depending on risk class",
  },
  {
    name: "ISC",
    kind: "mga",
    lines: ["GL", "Garage", "WC", "Excess"],
    portal: "https://app.instantspecialty.com",
    channel: "hybrid",
    known: [
      "MGA path — Harper works Instant Specialty (ISC) directly; do not flatten to the behind-carrier inbox",
      "Paper issues on Hadron Specialty (17534), Sutton National (25798), SiriusPoint America (38776), or Third Coast (10713) — the dec page governs; record the writer at intake",
      "Portal for AI / name / address endorsements; countersign → bind → download docs → validate",
      "30-day notices & subjectivities (not on portal): prepare the certificate, email certs@iscmga.com, and approve the endorsement charge ISC quotes back — about $100 in desk history",
      "Session-based portal (drops ~6 PM); CO 10-day NOC not available (30-day only)",
      "Financing often via Agile or Jump; commission applies to full premium including fees",
    ],
    whenOut: "RT Specialty or RPS for wholesale; AmTrust for WC-only",
  },
  {
    name: "RT Specialty",
    kind: "wholesale",
    lines: ["GL", "WC", "Specialty"],
    portal: "https://www.rtconnect.com",
    channel: "portal",
    known: [
      "Wholesale path — send to the named underwriter on the account, not a shared default desk",
      "RTConnect / Insurance Helper portal for submissions / forms",
      "Email/call when portal errors (effective date unlock, DocuSign)",
    ],
    whenOut: "AMWins or RPS",
  },
  {
    name: "AMWins",
    kind: "wholesale",
    lines: ["GL", "Specialty"],
    channel: "email",
    known: ["Used for specialty GL binds (e.g. med spa path)"],
    whenOut: "RT Specialty",
  },
  {
    name: "Byberg / ByWork",
    kind: "mga",
    lines: ["WC"],
    channel: "email",
    known: ["Workers' Comp alternative when AmTrust declines"],
    whenOut: "Hanover / Employers as additional WC markets to try",
  },
  {
    name: "RPS",
    kind: "wholesale",
    lines: ["GL", "Contractor specialty"],
    channel: "email",
    known: ["Window / door contractor submissions"],
    whenOut: "RT Specialty or ISC",
  },
  {
    name: "Progressive",
    kind: "direct_bill",
    lines: ["Commercial Auto"],
    channel: "portal",
    known: ["Direct-bill IQ via Ramp card flows"],
    whenOut: "Geico / First Insurance / Symbol for similar IQ auto",
  },
  {
    name: "Geico",
    kind: "direct_bill",
    lines: ["Commercial Auto"],
    channel: "portal",
    known: ["Direct-bill IQ via Ramp"],
    whenOut: "Progressive / Symbol",
  },
  {
    name: "First Insurance",
    kind: "direct_bill",
    lines: ["Commercial Auto"],
    channel: "portal",
    known: ["Direct-bill IQ via Ramp"],
    whenOut: "Progressive / Geico",
  },
  {
    name: "Symbol",
    kind: "direct_bill",
    lines: ["Commercial Auto"],
    channel: "portal",
    known: ["Direct-bill IQ via Ramp"],
    whenOut: "Progressive / Geico",
  },
  {
    name: "TMR",
    kind: "admitted",
    lines: ["GL"],
    channel: "email",
    known: ["Reinstatement at carrier discretion", "IPFS sometimes used for financing"],
    whenOut: "ISC / Coterie depending on class",
  },
  {
    name: "Endurance",
    kind: "surplus",
    lines: ["Aviation Products", "Specialty GL"],
    channel: "email",
    known: [
      "Aviation specialist (future vertical)",
      "Suggested historically for backdated GL situations",
    ],
    whenOut: "Escalate to specialty wholesale",
  },
];

export function getCarrierIntel(name: string): CarrierIntel | undefined {
  return CARRIER_INTEL.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
}

export function kindLabel(kind: CarrierIntel["kind"]): string {
  switch (kind) {
    case "admitted":
      return "Admitted";
    case "surplus":
      return "Surplus";
    case "mga":
      return "MGA";
    case "wholesale":
      return "Wholesale";
    case "direct_bill":
      return "Direct-Bill IQ";
  }
}
