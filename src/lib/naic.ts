/**
 * Verified NAIC identities — the carrier brand on the policy record mapped
 * to the issuing company's legal name and NAIC company code.
 *
 * Every entry below traces to `docs/acord-forms-research.md` §3 ("Verified
 * NAIC Company Codes"), where each code is confirmed against AM Best rating
 * disclosures, state DOI directories, surplus lines stamping offices, or the
 * carrier's own statutory page. Anything the research marked
 * "UNVERIFIED — do not use" is deliberately absent: a brand with no entry
 * here gets a blank NAIC cell on the certificate, never a guess.
 *
 * ACORD rule the research stresses: the cert lists the *issuing carrier's*
 * legal name and NAIC code — never the MGA's (Coterie has no code of its
 * own; its paper issues on Spinnaker / Benchmark / Clear Spring).
 */

/** Source cite shown on extraction-review chips for these values. */
export const NAIC_SOURCE = "NAIC registry (verified)";

export interface NaicIdentity {
  /** Writing company legal name as it prints on the INSURER line */
  issuingCompany: string;
  /** NAIC company code, verified — see docs/acord-forms-research.md §3 */
  naic: string;
  /** Provenance worth surfacing where the brand ≠ the paper */
  note?: string;
}

interface NaicRule {
  /** Carrier brand as it appears on the policy record */
  brand: string;
  /**
   * Narrows by coverage code when a group writes different companies per
   * line (Progressive: commercial auto rides on United Financial Casualty).
   */
  coverageMatch?: RegExp;
  identity: NaicIdentity;
}

const NAIC_RULES: NaicRule[] = [
  {
    brand: "Kinsale",
    identity: { issuingCompany: "Kinsale Insurance Company", naic: "38920" },
  },
  {
    // Markel's surplus-lines paper is Evanston — successor by merger to
    // Essex (6/30/2016, now retired; never issue on Essex). The desk's
    // Markel policies are E&S-flavored, so Evanston is the writer here.
    // Markel Insurance Company 38970 (admitted) is a different company.
    brand: "Markel",
    identity: {
      issuingCompany: "Evanston Insurance Company",
      naic: "35378",
      note: "Markel E&S paper — Evanston Insurance Company (successor to Essex, merged 2016; never Essex)",
    },
  },
  {
    brand: "AmTrust",
    identity: {
      issuingCompany: "Technology Insurance Company, Inc.",
      naic: "42376",
      note: "AmTrust group writing company — the group has many writers, the dec page governs",
    },
  },
  {
    brand: "Hiscox",
    identity: { issuingCompany: "Hiscox Insurance Company Inc.", naic: "10200" },
  },
  {
    brand: "USLI",
    identity: {
      issuingCompany: "United States Liability Insurance Company",
      naic: "25895",
    },
  },
  {
    // Coterie is an MGA — no NAIC code of its own. Its current carrier list
    // is Spinnaker 24376 / Benchmark 41394 / Clear Spring P&C 15563; the
    // desk's demo program issues on Spinnaker paper.
    brand: "Coterie",
    identity: {
      issuingCompany: "Spinnaker Insurance Company",
      naic: "24376",
      note: "Coterie is the MGA — no NAIC code of its own; this program issues on Spinnaker Insurance Company paper (Coterie also writes via Benchmark 41394 and Clear Spring P&C 15563)",
    },
  },
  {
    brand: "NEXT Insurance",
    identity: { issuingCompany: "Next Insurance US Company", naic: "16285" },
  },
  {
    // Progressive's principal commercial-auto writing company — the code
    // most likely on a commercial cert. Checked before the flagship rule.
    brand: "Progressive",
    coverageMatch: /^(CA|COMM)$/,
    identity: {
      issuingCompany: "United Financial Casualty Company",
      naic: "11770",
      note: "Progressive's principal commercial-auto writing company",
    },
  },
  {
    brand: "Progressive",
    identity: {
      issuingCompany: "Progressive Casualty Insurance Company",
      naic: "24260",
      note: "Progressive group flagship code — dec page governs",
    },
  },
  {
    brand: "Geico",
    identity: {
      issuingCompany: "Government Employees Insurance Company",
      naic: "22063",
      note: "GEICO flagship — a commercial cert on GEICO paper is unusual",
    },
  },
];

/**
 * ISC (Instant Specialty / iscmga.com) is an MGA — no NAIC code of its own.
 * Its paper issues on one of these writing companies; the dec page governs
 * which one, so the desk records the writer per policy (`issuingCarrier`)
 * rather than guessing from the brand. Codes verified 2026-08:
 *
 * - Hadron Specialty 17534 — hadroninsurance.com regulatory disclosures,
 *   MSLA Bulletin 2023-24, SLTX insurer summary (E&S, AR domicile, AM Best A-)
 * - Sutton National 25798 — MO / CA / MS DOI directories, NY DFS, AM Best
 *   AMB 020625 (admitted, OK domicile, fka Unigard Indemnity)
 * - SiriusPoint America 38776 — AM Best AMB 002642, CA DOI, MS DOI
 *   (NY domicile, fka Sirius America Insurance Company)
 * - Third Coast 10713 — AM Best AMB 011876, NAIC company listing, SLTX
 *   (WI domicile, AmeriTrust Group, AM Best A)
 */
export const ISC_WRITERS: readonly NaicIdentity[] = [
  {
    issuingCompany: "Hadron Specialty Insurance Company",
    naic: "17534",
    note: "ISC (MGA) writer — Hadron Specialty, E&S paper, Arkansas domicile",
  },
  {
    issuingCompany: "Sutton National Insurance Company",
    naic: "25798",
    note: "ISC (MGA) writer — Sutton National, admitted paper, Oklahoma domicile",
  },
  {
    issuingCompany: "SiriusPoint America Insurance Company",
    naic: "38776",
    note: "ISC (MGA) writer — SiriusPoint America, New York domicile",
  },
  {
    issuingCompany: "Third Coast Insurance Company",
    naic: "10713",
    note: "ISC (MGA) writer — Third Coast, Wisconsin domicile (AmeriTrust Group)",
  },
];

/**
 * Match a dec-page writing company name to a verified identity. Exact-ish:
 * the candidate must contain the writer's distinctive name; anything else
 * returns null and the NAIC cell stays blank.
 */
export function identityForIssuingCompany(
  name: string | null | undefined,
): NaicIdentity | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n) return null;
  for (const w of ISC_WRITERS) {
    const full = w.issuingCompany.toLowerCase();
    const distinctive = full.replace(/\s+insurance company$/, "");
    if (n === full || n.includes(distinctive)) return w;
  }
  return null;
}

/**
 * Verified issuing identity for a policy, or null when the research has no
 * confirmed code — the NAIC cell then prints blank. When the policy record
 * carries the dec-page writer (`issuingCarrier`, MGA paper like ISC), that
 * identity wins over any brand rule: the dec page governs.
 */
export function naicForPolicy(
  carrier: string,
  coverages: string[] = [],
  issuingCarrier?: string | null,
): NaicIdentity | null {
  const fromDec = identityForIssuingCompany(issuingCarrier);
  if (fromDec) return fromDec;
  const brand = carrier.trim().toLowerCase();
  for (const rule of NAIC_RULES) {
    if (rule.brand.toLowerCase() !== brand) continue;
    if (rule.coverageMatch && !coverages.some((c) => rule.coverageMatch!.test(c))) {
      continue;
    }
    return rule.identity;
  }
  return null;
}

/**
 * Every issuing legal name a brand verifiably prints under — the verifier
 * accepts these on the INSURER line in place of the brand itself. ISC paper
 * may print any of its four verified writers.
 */
export function issuingCompaniesFor(carrier: string): string[] {
  const brand = carrier.trim().toLowerCase();
  if (brand === "isc") return ISC_WRITERS.map((w) => w.issuingCompany);
  return NAIC_RULES.filter((r) => r.brand.toLowerCase() === brand).map(
    (r) => r.identity.issuingCompany,
  );
}
