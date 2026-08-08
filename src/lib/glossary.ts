/**
 * The desk glossary — plain-English definitions of every term and
 * abbreviation the platform uses. Written for teammates without an
 * insurance background: state the abbreviation once, define it precisely,
 * and note how the desk uses it. UI copy elsewhere follows the same rule —
 * no abbreviation appears before it has been spelled out.
 */

export interface GlossaryTerm {
  term: string;
  /** Abbreviation or short form, shown in parentheses after the term */
  abbreviation: string | null;
  definition: string;
  /** How the term shows up in day-to-day desk work */
  onTheDesk: string | null;
}

export interface GlossarySection {
  id: string;
  title: string;
  terms: GlossaryTerm[];
}

export const GLOSSARY: GlossarySection[] = [
  {
    id: "certificates",
    title: "Certificates",
    terms: [
      {
        term: "Certificate Of Insurance",
        abbreviation: "COI",
        definition:
          "A one-page summary showing that coverage exists: the carrier, policy numbers, limits, and effective dates. It is evidence of insurance only — it is not a policy and does not change coverage by itself.",
        onTheDesk:
          "The desk issues certificates from the policy page (the schedule of record) through the Certificate Studio.",
      },
      {
        term: "ACORD 25",
        abbreviation: null,
        definition:
          "The industry-standard Certificate Of Liability Insurance form published by ACORD. Most certificate requests are fulfilled on this form.",
        onTheDesk: null,
      },
      {
        term: "Certificate Holder",
        abbreviation: null,
        definition:
          "The person or company the certificate is issued to — typically a landlord, general contractor, lender, or client who requires proof of the insured's coverage.",
        onTheDesk:
          "The holder's name and address must appear exactly as the contract spells them.",
      },
      {
        term: "Description Of Operations",
        abbreviation: null,
        definition:
          "The free-text block on a certificate where required wording is written out — for example, that the holder is included as an additional insured under a specific endorsement form.",
        onTheDesk:
          "When form rows overflow, the desk continues the schedule here rather than inventing extra rows.",
      },
    ],
  },
  {
    id: "endorsements",
    title: "Endorsements & Wording",
    terms: [
      {
        term: "Endorsement",
        abbreviation: null,
        definition:
          "A written amendment attached to the policy that changes its terms — adding a party, changing a limit, or granting new wording. Endorsements may or may not carry a premium charge.",
        onTheDesk: null,
      },
      {
        term: "Additional Insured",
        abbreviation: "AI",
        definition:
          "A party added to the insured's liability coverage by endorsement, so the policy also protects them for liability arising out of the insured's work for them.",
        onTheDesk:
          "The most common certificate request on the desk. Whether it costs anything usually depends on whether a blanket form already applies.",
      },
      {
        term: "Blanket Endorsement",
        abbreviation: null,
        definition:
          "An endorsement that grants status automatically to any party the insured agrees in a written contract to include — no individual naming required. Contrast with a scheduled endorsement.",
        onTheDesk:
          "If the policy carries a blanket additional insured form and the holder accepts wording, the desk issues the certificate without touching the market (the fast path).",
      },
      {
        term: "Scheduled Endorsement",
        abbreviation: null,
        definition:
          "An endorsement that lists each covered party by name. Adding a new party requires going back to the carrier for a new or amended endorsement.",
        onTheDesk:
          "When a holder's contract requires being specifically named on the policy, blanket wording is not enough and the request goes to the underwriter.",
      },
      {
        term: "Waiver Of Subrogation",
        abbreviation: "WOS",
        definition:
          "The carrier gives up its right to recover a loss it paid from the named party. Contracts commonly require it alongside additional insured status.",
        onTheDesk:
          "Frequently a small flat charge or a percentage of premium; workers' compensation waivers almost always carry a charge.",
      },
      {
        term: "Primary & Non-Contributory",
        abbreviation: "P&NC",
        definition:
          "Wording that makes the insured's policy pay first (primary) and prevents it from asking the holder's own insurance to share the loss (non-contributory).",
        onTheDesk:
          "Usually wording-only with no premium charge when the policy already carries the endorsement form.",
      },
      {
        term: "30-Day Notice Of Cancellation",
        abbreviation: null,
        definition:
          "An endorsement obligating the carrier to notify a named party a set number of days (commonly 30) before cancelling the policy.",
        onTheDesk:
          "Usually premium-bearing — operators commonly see a flat charge near $100.",
      },
      {
        term: "Notice Of Cancellation",
        abbreviation: "NOC",
        definition:
          "An endorsement obligating the carrier to notify a named party a set number of days before cancelling the policy. The day count varies: 30-day notice is the common contract ask; a 10-day notice typically applies to cancellation for non-payment of premium.",
        onTheDesk:
          "Not every market offers every day count everywhere — ISC does not offer the 10-day non-payment notice in the contractors/lease vertical in Colorado, so the desk blocks that promise before it is made.",
      },
      {
        term: "Additional Named Insured",
        abbreviation: "ANI",
        definition:
          "Another legal entity added as a named insured on the policy, with the full rights and obligations of the policyholder. Broader and more consequential than certificate-holder or additional-insured status.",
        onTheDesk:
          "A new legal entity is an underwriting event — expect review, subjectivities, and possibly premium.",
      },
    ],
  },
  {
    id: "policy-market",
    title: "Policy & Market",
    terms: [
      {
        term: "Named Insured",
        abbreviation: null,
        definition:
          "The person or business the policy is issued to — the policyholder whose name appears on the declarations page.",
        onTheDesk: null,
      },
      {
        term: "Carrier",
        abbreviation: null,
        definition:
          "The insurance company that issues the policy and pays covered claims.",
        onTheDesk: null,
      },
      {
        term: "Managing General Agent",
        abbreviation: "MGA",
        definition:
          "A specialized intermediary with underwriting authority delegated by one or more carriers. The desk works with some markets directly and others through an MGA.",
        onTheDesk:
          "ISC is an example — requests route to the MGA's desk rather than to the carrier directly.",
      },
      {
        term: "Surplus Lines",
        abbreviation: null,
        definition:
          "Coverage placed with a non-admitted carrier when the standard (admitted) market will not write the risk. It carries its own tax and filing paperwork.",
        onTheDesk: null,
      },
      {
        term: "Underwriter",
        abbreviation: "UW",
        definition:
          "The person at the carrier or MGA who evaluates the risk and decides terms, pricing, and whether to approve a requested change.",
        onTheDesk: null,
      },
      {
        term: "Subjectivities",
        abbreviation: null,
        definition:
          "Conditions an underwriter attaches to a quote or binder that must be satisfied — documents, signatures, inspections — before or shortly after coverage is bound.",
        onTheDesk: null,
      },
      {
        term: "Binder",
        abbreviation: null,
        definition:
          "A temporary written confirmation that coverage is in force while the formal policy is being issued.",
        onTheDesk: null,
      },
      {
        term: "Quote Versus Indication",
        abbreviation: null,
        definition:
          "A quote is a bindable offer from the market. An indication is a ballpark estimate only — useful for setting expectations, never something to bind or promise on.",
        onTheDesk:
          "Desk price guidance is an indication drawn from recorded history and is labeled as such; only the market's answer is a quote.",
      },
      {
        term: "Premium-Bearing",
        abbreviation: null,
        definition:
          "A request that is expected to change what the insured pays. The desk grades request types as Rarely, Sometimes, or Usually Premium.",
        onTheDesk: null,
      },
      {
        term: "Excess Liability",
        abbreviation: null,
        definition:
          "Coverage that sits above a primary liability policy and pays after the underlying limits are exhausted. Often written together with or as umbrella liability.",
        onTheDesk:
          "Excess lines carry their own endorsement rules — on ISC paper an excess line cannot take Additional Insured status, and the desk enforces that in code.",
      },
      {
        term: "Writing Company",
        abbreviation: null,
        definition:
          "The licensed insurance company whose paper the policy actually issues on, identified by its NAIC code. When the market is a Managing General Agent (MGA), the writing company sits behind the brand — the declarations page governs which one.",
        onTheDesk:
          "The certificate's INSURER line prints the writing company and its verified NAIC code, never the MGA.",
      },
      {
        term: "General Liability",
        abbreviation: "GL",
        definition:
          "Coverage for bodily injury and property damage the business causes to others, including many contract-driven certificate requirements.",
        onTheDesk: null,
      },
      {
        term: "Workers' Compensation",
        abbreviation: "WC",
        definition:
          "Statutorily required coverage for employee injuries on the job. Waivers of subrogation on this line almost always carry a charge.",
        onTheDesk: null,
      },
      {
        term: "Errors & Omissions",
        abbreviation: "E&O",
        definition:
          "Professional liability coverage for financial harm caused by mistakes or failures in professional services. Also written as professional liability.",
        onTheDesk: null,
      },
    ],
  },
  {
    id: "desk",
    title: "Desk Terms",
    terms: [
      {
        term: "Service Request",
        abbreviation: "SR",
        definition:
          "The desk's ticket number for one client request (for example, SR-10012). Every piece of work traces back to one.",
        onTheDesk:
          "Clients receive their SR number in the acknowledgment email and can track it on the portal.",
      },
      {
        term: "Schedule Of Record",
        abbreviation: null,
        definition:
          "The policy data on the account page, treated as the single source of truth. Certificates and answers are generated from it — never from memory.",
        onTheDesk: null,
      },
      {
        term: "Fast Path",
        abbreviation: null,
        definition:
          "Issuing a certificate without contacting the market because the policy's blanket endorsement already grants what the holder needs and the holder accepts wording.",
        onTheDesk:
          "The ticket shows the exact form cited as the basis. A holder who must be named on the policy never rides the fast path.",
      },
      {
        term: "Pending",
        abbreviation: null,
        definition:
          "The board where raw communications (emails, texts, calls) wait to become tickets. Distinct from the Ticket Queue, which holds established tickets being worked.",
        onTheDesk:
          "Nothing merges into an existing ticket without an operator's confirmation.",
      },
      {
        term: "Carrier Intelligence",
        abbreviation: null,
        definition:
          "The desk's registry of institutional knowledge per carrier, writing company, coverage line, industry vertical, and state — restrictions, state notes, past issues, and practice notes, each with a source and a recorded-on date.",
        onTheDesk:
          "Rendered as cards on every carrier desk page. Entries marked as enforced in code hard-block the matching request or certificate, citing the entry as the reason; operator-added entries warn but never silently enforce.",
      },
      {
        term: "Pre-Bind",
        abbreviation: null,
        definition:
          "An account whose coverage has been quoted or is being placed but where payment has not been received. Documents can be prepared but not issued.",
        onTheDesk:
          "The Certificate Studio runs in Prepare Only mode until payment is recorded.",
      },
    ],
  },
];
