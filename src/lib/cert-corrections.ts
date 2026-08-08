import "server-only";
import type { PlacementMap } from "./acord25";
import {
  getIntelligenceDb,
  listCertHolders,
  listPlacementRules,
  type CertHolderRecord,
  type PlacementRuleRecord,
} from "./policy-intelligence";

/**
 * Desk placement corrections — server-side reads for the account page and
 * the Certificate Studio. The rules themselves live in policy-intelligence's
 * `desk_placement_rules` table (cert-domain persistence); this module shapes
 * them for the resolver (`PlacementMap`) and the studio UI (provenance list).
 *
 * LEARNING BOUNDARY. What the desk teaches the system is fenced to two
 * correction classes, and the fence is structural:
 *
 * - "routing"    — where on the printed form a policy's row lands
 *                  (desk_placement_rules). A placement rule moves a section;
 *                  the values inside the section always re-resolve off the
 *                  schedule of record, so a rule cannot change a limit, a
 *                  checkbox, an endorsement selection, or a word of the
 *                  Description Of Operations.
 * - "formatting" — holder name/address rows the desk saved for reuse
 *                  (desk_cert_holders). Carried verbatim from a request on
 *                  file or typed by an operator; never inferred.
 *
 * Nothing learned may pre-fill or alter coverage facts. Every learned rule
 * is versioned by its row (id + correctedBy + createdAt), visible in the
 * studio with provenance, and revocable. `assertLearnableCorrection` is the
 * write-side gate: persistence paths for learned behavior must pass it, so
 * adding a coverage-class "learning" means changing this module in review,
 * not slipping a row into a table.
 */

export type CorrectionClass = "routing" | "formatting";

/** Correction kinds the system may learn, mapped to their class. */
export const LEARNABLE_CORRECTIONS: Record<string, CorrectionClass> = {
  placement: "routing",
  holder_rail: "formatting",
};

/** Correction kinds that must NEVER be learned — listed so review sees them. */
export const FORBIDDEN_CORRECTION_KINDS = [
  "coverage",
  "limits",
  "endorsement_selection",
  "description_of_operations",
] as const;

export function assertLearnableCorrection(kind: string): CorrectionClass {
  const cls = LEARNABLE_CORRECTIONS[kind];
  if (!cls) {
    throw new Error(
      `Correction kind "${kind}" is outside the learning boundary — only routing and formatting corrections may be persisted.`,
    );
  }
  return cls;
}

export function getAccountPlacementRules(
  accountId: string,
): PlacementRuleRecord[] {
  return listPlacementRules(getIntelligenceDb(), accountId);
}

/** policyId → sectionKey, the shape resolveCertSheet takes. */
export function placementMapOf(rules: PlacementRuleRecord[]): PlacementMap {
  return Object.fromEntries(rules.map((r) => [r.policyId, r.sectionKey]));
}

/**
 * Saved rail holders for an account — the desk-typed entries that persist
 * across reloads (table `desk_cert_holders`, same cert-domain home as the
 * placement rules).
 */
export function getAccountCertHolders(accountId: string): CertHolderRecord[] {
  return listCertHolders(getIntelligenceDb(), accountId);
}
