/**
 * Which market wrote a policy, when the record only names the paper.
 *
 * An MGA's policies carry the fronting carrier's name in the carrier field,
 * because that company is the insurer. But the desk works the MGA: Coterie
 * is reached through partners.coterie.com, not through Spinnaker. Import
 * that names Spinnaker leaves the account with no reachable market desk and
 * loses the carrier knowledge filed under the brand.
 *
 * The policy number gives it away. Coterie numbers begin C + the fronting
 * carrier's initial: CSG and CSB on Spinnaker, CEG and CEP on Everspan, CBG
 * on Benchmark. That is 92 of the 400 policies in a real in-force pull, the
 * largest program on the book.
 *
 * A prefix alone is not enough to relabel a policy, though — three letters
 * are easy to collide with. Both signals have to agree: the number looks
 * like the brand's, and the paper is one the brand is known to write on.
 * When they disagree the policy keeps the carrier its record states, and
 * the disagreement is reported rather than resolved by guess.
 */

export interface MarketBrand {
  /** Brand as it appears on policy records and in the underwriter table. */
  brand: string;
  /** Seeded market desk for the brand. */
  underwriterId: string;
  /**
   * An MGA's brand is not the insurer, so relabelling a policy risks naming
   * the wrong company on the certificate — it takes two agreeing signals.
   * A direct carrier's brand *is* the insurer, so the name alone is enough
   * and there is nothing to misattribute.
   */
  kind: "mga" | "direct";
  /** Policy-number prefixes the brand issues under. MGAs only. */
  prefixes?: RegExp;
  /** Carrier names the brand writes on, as the record spells them. */
  papers: RegExp;
}

export const MARKET_BRANDS: readonly MarketBrand[] = [
  {
    brand: "Coterie",
    underwriterId: "uw-coterie-1",
    kind: "mga",
    // C + fronting carrier initial + product letter.
    prefixes: /^C[SEB][A-Z]-/i,
    papers: /spinnaker|everspan|benchmark|clear\s*spring/i,
  },
  {
    brand: "ISC",
    underwriterId: "uw-isc-1",
    kind: "mga",
    // ISC stamps itself into the number rather than prefixing it uniformly:
    // GLSISTC… on Third Coast, ISCP…/ISCCX… on Sutton, ISCSP… on
    // SiriusPoint, HSIC-ISC01… on Hadron. Matching the stamp anywhere in the
    // number catches all four; the paper still has to agree.
    prefixes: /ISTC|ISC|ICX|HSIC/i,
    papers: /hadron|sutton|siriuspoint|third\s*coast/i,
  },
  // Direct markets. The record prints the legal name; the desk is filed
  // under the brand, so without this an account sits on the placeholder
  // desk next to a policy from a carrier the desk has a portal for.
  {
    brand: "Hiscox",
    underwriterId: "uw-hiscox-1",
    kind: "direct",
    papers: /^hiscox\b/i,
  },
  {
    brand: "NEXT Insurance",
    underwriterId: "uw-next-1",
    kind: "direct",
    papers: /^next insurance\b/i,
  },
  {
    brand: "Kinsale",
    underwriterId: "uw-kinsale-1",
    kind: "direct",
    papers: /^kinsale\b/i,
  },
  {
    brand: "USLI",
    underwriterId: "uw-usli-1",
    kind: "direct",
    papers: /united states liability/i,
  },
];

export interface MarketResolution {
  /** The brand to record as the policy's carrier. */
  brand: string;
  /** The desk that works it. */
  underwriterId: string;
  /**
   * The writing company, kept so the certificate names the real insurer.
   *
   * Null for a direct market, where the brand *is* the insurer: recording a
   * writer there would override the brand's own verified NAIC rule with an
   * unverified name off the record, and the code cell would go blank.
   */
  issuingCarrier: string | null;
}

/**
 * Resolve the market, or null when nothing corroborates one.
 *
 * `paper` is the carrier name the record states. It is returned as the
 * issuing carrier so the ACORD INSURER line still names the company that
 * actually wrote the policy — an MGA has no business printing there.
 */
export function resolveMarket(
  policyNumber: string | null | undefined,
  paper: string | null | undefined,
): MarketResolution | null {
  const number = policyNumber?.trim() ?? "";
  const carrier = paper?.trim() ?? "";
  if (!number || !carrier) return null;

  for (const m of MARKET_BRANDS) {
    if (m.kind === "mga") {
      if (!m.prefixes?.test(number)) continue;
      // The number says the brand; the paper has to agree.
      if (!m.papers.test(carrier)) return null;
    } else if (!m.papers.test(carrier)) {
      continue;
    }
    return {
      brand: m.brand,
      underwriterId: m.underwriterId,
      issuingCarrier: m.kind === "mga" ? carrier : null,
    };
  }
  return null;
}

/**
 * The desk to work, from the number alone, when the record names no paper.
 *
 * Two different decisions hide behind "which market is this". Relabelling
 * the policy's carrier changes what prints on a certificate and needs the
 * paper to corroborate. Choosing a desk does not print anywhere — it is who
 * to call and which portal to open — so a number that unambiguously carries
 * the brand's stamp is enough on its own.
 *
 * Only when the paper is silent. A stated carrier that the brand does not
 * write on is a contradiction, and `unmatchedMarket` reports it rather than
 * letting a desk be picked over the top of it.
 */
export function resolveDesk(
  policyNumber: string | null | undefined,
  paper: string | null | undefined,
): { brand: string; underwriterId: string } | null {
  const number = policyNumber?.trim() ?? "";
  if (!number) return null;
  const carrier = paper?.trim() ?? "";
  if (carrier && carrier.toLowerCase() !== "unassigned") return null;

  for (const m of MARKET_BRANDS) {
    if (m.kind !== "mga") continue;
    if (m.prefixes?.test(number)) {
      return { brand: m.brand, underwriterId: m.underwriterId };
    }
  }
  return null;
}

/**
 * A number that looks like a brand's but sits on paper the brand is not
 * known to write. Worth a human's attention: either the brand added a
 * fronting carrier, or the number means something else entirely. Reported,
 * never resolved by guess.
 */
export function unmatchedMarket(
  policyNumber: string | null | undefined,
  paper: string | null | undefined,
): { brand: string; paper: string } | null {
  const number = policyNumber?.trim() ?? "";
  const carrier = paper?.trim() ?? "";
  if (!number || !carrier) return null;
  for (const m of MARKET_BRANDS) {
    if (m.kind !== "mga") continue;
    if (m.prefixes?.test(number) && !m.papers.test(carrier)) {
      return { brand: m.brand, paper: carrier };
    }
  }
  return null;
}
