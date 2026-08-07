import type { CarrierIntel } from "./carriers";

/**
 * How Harper reaches the market — distinct from admitted/surplus paperwork.
 *
 * Direct: Harper works the carrier (or its agency portal) as the market.
 * MGA: Harper works an MGA desk (e.g. ISC) that places with carriers behind it.
 * Wholesale: Harper works a wholesaler (e.g. RT Specialty) that markets out.
 * Direct-bill IQ: insured pays carrier; agency services via portal/Ramp.
 */
export type PlacementPath = "direct" | "mga" | "wholesale" | "direct_bill";

export function placementPathFor(
  kind: CarrierIntel["kind"],
): PlacementPath {
  switch (kind) {
    case "mga":
      return "mga";
    case "wholesale":
      return "wholesale";
    case "direct_bill":
      return "direct_bill";
    case "admitted":
    case "surplus":
      return "direct";
  }
}

export function placementPathLabel(path: PlacementPath): string {
  switch (path) {
    case "direct":
      return "Direct Carrier";
    case "mga":
      return "MGA Path";
    case "wholesale":
      return "Wholesale Path";
    case "direct_bill":
      return "Direct-Bill IQ";
  }
}

export function placementPathBlurb(path: PlacementPath): string {
  switch (path) {
    case "direct":
      return "Harper works this carrier (or its agency portal) as the market of record for service.";
    case "mga":
      return "Harper works the MGA desk directly — bind, endorsements, and docs run through the MGA portal, not a flattened carrier inbox.";
    case "wholesale":
      return "Harper works the wholesaler on the account. Send to the named underwriter on file — not a shared default desk.";
    case "direct_bill":
      return "Insured pays the carrier; agency service is portal / Ramp oriented.";
  }
}

export function isMgaDesk(carrierName: string): boolean {
  const n = carrierName.toLowerCase();
  return n === "isc" || n.includes("byberg") || n.includes("bywork");
}

export function isWholesaleDesk(carrierName: string): boolean {
  const n = carrierName.toLowerCase();
  return (
    n.includes("rt specialty") ||
    n.includes("amwins") ||
    n === "rps" ||
    n.startsWith("rt ")
  );
}
