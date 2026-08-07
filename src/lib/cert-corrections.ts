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
 */

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
