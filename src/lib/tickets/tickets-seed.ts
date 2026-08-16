import type { AccountDoc, RequestTypeId, TicketSource } from "../types";

/**
 * Intake feed. Every one of these is a real request that arrived somehow —
 * inbound email, a producer relaying what the insured told them, a portal
 * task, or someone on service opening one by hand.
 */

export interface SeedTicket {
  id: string;
  accountId: string;
  /** A cert or blanket request routinely spans policies */
  policyIds: string[];
  requestType: RequestTypeId;
  source: TicketSource;
  requestedBy: string;
  requestedByEmail: string | null;
  subject: string;
  holderName: string | null;
  holderAddress: string | null;
  wording: string;
  docs: AccountDoc[];
  /** Keeps the queue looking alive without pinning a date into the seed */
  receivedMinutesAgo: number;
}

export const SEED_TICKETS: SeedTicket[] = [
  {
    id: "tkt-apex-oak",
    accountId: "acct-apex",
    policyIds: ["pol-apex-gl"],
    requestType: "additional_insured",
    source: "email",
    requestedBy: "Apex Roofing Office",
    requestedByEmail: "office@apexroofing.example",
    subject: "Need AI added for Oak Street GC",
    holderName: "Oak Street Builders LLC",
    holderAddress: "685 Market St, San Francisco, CA 94105",
    wording:
      "Additional insured per written contract — Oak Street re-roof project.",
    docs: [
      { id: "d-apex-1", name: "Oak-Street-contract.pdf", kind: "customer_upload", sizeLabel: "1.2 MB", trusted: false },
      { id: "d-apex-2", name: "KIN-GL-884201-quote.pdf", kind: "quote", sizeLabel: "310 KB", trusted: true },
    ],
    receivedMinutesAgo: 320,
  },
  {
    id: "tkt-harbor-landlord",
    accountId: "acct-harbor",
    policyIds: ["pol-harbor-pkg"],
    requestType: "additional_insured",
    source: "email",
    requestedBy: "Harbor Medical Spa Front Desk",
    requestedByEmail: "frontdesk@harbormedspa.example",
    subject: "Landlord wants to be additional insured",
    holderName: "Bayview Property Partners LP",
    holderAddress: "1801 Shoreline Dr, Alameda, CA 94501",
    wording: "Landlord AI for premises — lease renewal requirement.",
    docs: [
      { id: "d-harbor-1", name: "lease-excerpt.pdf", kind: "customer_upload", sizeLabel: "840 KB", trusted: false },
      { id: "d-harbor-2", name: "HSX-PL-229110-binder.pdf", kind: "policy", sizeLabel: "500 KB", trusted: true },
    ],
    receivedMinutesAgo: 297,
  },
  {
    id: "tkt-northstar-port",
    accountId: "acct-northstar",
    policyIds: ["pol-northstar-gar"],
    requestType: "additional_insured",
    source: "email",
    requestedBy: "Northstar Dispatch",
    requestedByEmail: "dispatch@northstar.example",
    subject: "Add Port Terminal as AI on garage policy",
    holderName: "Long Beach Port Terminal Authority",
    holderAddress: "925 Harbor Plaza, Long Beach, CA 90802",
    wording: "Terminal access agreement requires AI + primary wording.",
    docs: [
      { id: "d-ns-1", name: "terminal-access-agmt.pdf", kind: "customer_upload", sizeLabel: "2.1 MB", trusted: false },
      { id: "d-ns-2", name: "AMT-GAR-778302-quote.pdf", kind: "quote", sizeLabel: "275 KB", trusted: true },
    ],
    receivedMinutesAgo: 271,
  },
  {
    id: "tkt-craft-foundry",
    accountId: "acct-craft",
    policyIds: ["pol-craft-liq"],
    requestType: "additional_insured",
    source: "email",
    requestedBy: "Craft & Barrel Events",
    requestedByEmail: "events@craftbarrel.example",
    subject: "Venue needs additional insured for Saturday",
    holderName: "The Foundry Event Hall",
    holderAddress: "777 N 1st St, San Jose, CA 95112",
    wording: "One-day event AI incl. liquor liability.",
    docs: [
      { id: "d-craft-1", name: "venue-agreement.pdf", kind: "customer_upload", sizeLabel: "640 KB", trusted: false },
      { id: "d-craft-2", name: "USLI-LL-445566-quote.pdf", kind: "quote", sizeLabel: "290 KB", trusted: true },
    ],
    receivedMinutesAgo: 226,
  },
  {
    id: "tkt-greenleaf-hoa",
    accountId: "acct-greenleaf",
    policyIds: ["pol-greenleaf-bop"],
    requestType: "additional_insured",
    source: "producer",
    requestedBy: "Maria Vega (Producer)",
    requestedByEmail: "maria@greenleaf.example",
    subject: "HOA asking for additional insured cert",
    holderName: "Willow Creek HOA",
    holderAddress: "1550 Newell Ave, Walnut Creek, CA 94596",
    wording: "Ongoing landscaping contract — blanket may already apply.",
    docs: [
      { id: "d-gl-1", name: "COT-BOP-331450-policy.pdf", kind: "policy", sizeLabel: "1.6 MB", trusted: true },
    ],
    receivedMinutesAgo: 191,
  },
  {
    id: "tkt-summit-cascade",
    accountId: "acct-summit",
    policyIds: ["pol-summit-gl"],
    requestType: "additional_insured",
    source: "email",
    requestedBy: "Summit Window Jobs Desk",
    requestedByEmail: "jobs@summitwindow.example",
    subject: "GC on Fremont build wants AI + waiver",
    holderName: "Cascade Construction Group Inc",
    holderAddress: "40910 Fremont Blvd, Fremont, CA 94538",
    wording: "AI per contract; waiver requested separately.",
    docs: [
      { id: "d-sum-1", name: "subcontract-agmt.pdf", kind: "customer_upload", sizeLabel: "1.9 MB", trusted: false },
      { id: "d-sum-2", name: "ISC-GL-551002-quote.pdf", kind: "quote", sizeLabel: "260 KB", trusted: true },
    ],
    receivedMinutesAgo: 153,
  },
  {
    id: "tkt-pixel-meridian",
    accountId: "acct-pixel",
    policyIds: ["pol-pixel-eo"],
    requestType: "additional_insured",
    source: "email",
    requestedBy: "PixelForge Ops",
    requestedByEmail: "ops@pixelforge.example",
    subject: "Client MSA requires additional insured",
    holderName: "Meridian Data Systems Corp",
    holderAddress: "1912 E Riverside Dr, Austin, TX 78741",
    wording: "MSA section 9.2 — AI on GL/tech E&O where applicable.",
    docs: [
      { id: "d-px-1", name: "MSA-signed.pdf", kind: "customer_upload", sizeLabel: "3.4 MB", trusted: false },
      { id: "d-px-2", name: "HSX-EO-990120-quote.pdf", kind: "quote", sizeLabel: "300 KB", trusted: true },
    ],
    receivedMinutesAgo: 115,
  },

  // ——— Non-email intake, so the queue shows every road in ———
  {
    id: "tkt-apex-blanket",
    accountId: "acct-apex",
    policyIds: ["pol-apex-gl", "pol-apex-umb"],
    requestType: "blanket_ai_wos",
    source: "internal",
    requestedBy: "Service Request — Renewal Prep",
    requestedByEmail: null,
    subject: "Move Apex to blanket AI + WofS across GL and umbrella",
    holderName: null,
    holderAddress: null,
    wording:
      "Apex is running three scheduled AI endorsements a month. Ask Kinsale to quote blanket AI and blanket waiver on the GL, and confirm the umbrella follows form.",
    docs: [],
    receivedMinutesAgo: 88,
  },
  {
    id: "tkt-summit-wos",
    accountId: "acct-summit",
    policyIds: ["pol-summit-gl"],
    requestType: "waiver_of_subrogation",
    source: "producer",
    requestedBy: "Dana Whitfield (Producer)",
    requestedByEmail: "dana.whitfield@harperinsure.com",
    subject: "Insured called — GC also wants the waiver",
    holderName: "Cascade Construction Group Inc",
    holderAddress: "40910 Fremont Blvd, Fremont, CA 94538",
    wording:
      "Same Fremont job as the AI request. GC wants a waiver of subrogation in their favor.",
    docs: [],
    receivedMinutesAgo: 54,
  },
  {
    id: "tkt-harbor-limit",
    accountId: "acct-harbor",
    policyIds: ["pol-harbor-pkg"],
    requestType: "limit_change",
    source: "portal",
    requestedBy: "Portal Task HSX-44821",
    requestedByEmail: null,
    subject: "Increase professional liability to $2M each claim",
    holderName: null,
    holderAddress: null,
    wording:
      "New hospital affiliation requires $2M each claim on the professional liability section. Confirm premium.",
    docs: [
      { id: "d-harbor-3", name: "affiliation-requirements.pdf", kind: "customer_upload", sizeLabel: "410 KB", trusted: false },
    ],
    receivedMinutesAgo: 22,
  },
];
