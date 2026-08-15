/**
 * The insured's mailing address, from the company record.
 *
 * `data policy-state read` carries coverage and terms but no address, so an
 * imported account had nothing for the certificate's INSURED box and printed
 * it blank. `knowledge companies export` carries the address, keyed by the
 * same company id the policy row already has.
 *
 * Shaped into the ACORD 125 prefill the account mapper already reads, so
 * there is one path into an Account whether the address came from the
 * mechanical prefill or from here.
 */

import type { HarperPrefill } from "./policy-state";

export interface HarperCompanyAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export interface HarperCompany {
  address?: HarperCompanyAddress | null;
  industry?: string | null;
  sub_industry?: string | null;
}

/**
 * The export spells states both ways — 170 of 278 companies in a real pull
 * carry "CA", the rest carry "California". The ACORD box is two characters,
 * so a full name has to resolve or the cell would overflow into nonsense.
 */
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC", "washington dc": "DC",
  "puerto rico": "PR", "virgin islands": "VI", guam: "GU",
  "american samoa": "AS", "northern mariana islands": "MP",
};

/**
 * A two-letter USPS code, or "" when the record says something this table
 * cannot resolve. Blank is the honest answer: a guessed state on a
 * certificate names the wrong jurisdiction.
 */
export function stateCode(raw: string | null | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return STATE_CODES[value.toLowerCase().replace(/\s+/g, " ")] ?? "";
}

/** The company record as the ACORD 125 prefill the account mapper reads. */
export function prefillFromCompany(company: HarperCompany): HarperPrefill {
  const a = company.address ?? {};
  const prefill: HarperPrefill = {};
  const set = (key: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) prefill[key] = v;
  };
  // Trailing punctuation is common in keyed addresses ("9419 South K14
  // Highway,") and would print on the certificate exactly as stored.
  set("NamedInsured_MailingAddress_LineOne_A", a.street1?.replace(/[,\s]+$/, ""));
  set("NamedInsured_MailingAddress_LineTwo_A", a.street2?.replace(/[,\s]+$/, ""));
  set("NamedInsured_MailingAddress_CityName_A", a.city);
  set("NamedInsured_MailingAddress_StateOrProvinceCode_A", stateCode(a.state));
  set("NamedInsured_MailingAddress_PostalCode_A", a.postal_code);
  return prefill;
}

/** The industry line for the account header, or null when unstated. */
export function industryFromCompany(company: HarperCompany): string | null {
  const industry = company.industry?.trim();
  const sub = company.sub_industry?.trim();
  if (industry && sub) return `${industry} · ${sub}`;
  return industry || sub || null;
}
