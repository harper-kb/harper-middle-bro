/**
 * Coterie form library — verbatim titles and notes we treat as checked-in
 * knowledge for the carrier desk. Policy schedules attach from this catalog.
 */

export type CarrierFormKind =
  | "coverage"
  | "ai"
  | "wos"
  | "pnc"
  | "exclusion"
  | "other";

export interface CarrierFormDef {
  form: string;
  edition: string;
  title: string;
  kind: CarrierFormKind;
  verbatim: string;
  notes?: string;
}

export const COTERIE_FORMS: CarrierFormDef[] = [
  {
    form: "BP 00 03",
    edition: "07 13",
    title: "Businessowners Coverage Form",
    kind: "coverage",
    verbatim:
      "Businessowners Coverage Form — Section I Property and Section II Liability. Occurrence liability with aggregate limits as shown on the Declarations.",
    notes: "Core BOP form on Coterie IQ policies",
  },
  {
    form: "BP 00 03 §II",
    edition: "07 13",
    title: "Businessowners Liability Section",
    kind: "coverage",
    verbatim:
      "Section II — Liability. Coverage for bodily injury and property damage on an occurrence basis, subject to the Each Occurrence and General Aggregate limits on the Declarations.",
  },
  {
    form: "BP 04 48",
    edition: "07 13",
    title: "Additional Insured — Managers or Lessors of Premises / Written Contract (Blanket)",
    kind: "ai",
    verbatim:
      "Who Is An Insured is amended to include as an additional insured any person or organization for whom you are performing operations when you and such person or organization have agreed in writing in a contract or agreement that such person or organization be added as an additional insured on your policy, but only with respect to liability arising out of your ongoing operations performed for that insured.",
    notes:
      "Blanket AI — usually baked into Coterie IQ. Verify on Declarations / schedule before requesting scheduled AI.",
  },
  {
    form: "BP 04 97",
    edition: "07 13",
    title: "Waiver of Transfer of Rights of Recovery Against Others To Us (Blanket)",
    kind: "wos",
    verbatim:
      "We waive any right of recovery we may have against the person or organization shown in the Schedule because of payments we make for injury or damage arising out of your ongoing operations or your work done under a written contract with that person or organization.",
    notes: "Blanket WOS — confirm before a separate endorsement request",
  },
  {
    form: "BP 04 17",
    edition: "07 13",
    title: "Employment-Related Practices Exclusion",
    kind: "exclusion",
    verbatim:
      "This insurance does not apply to bodily injury or personal and advertising injury arising out of any employment-related practices, policies, acts or omissions.",
  },
  {
    form: "BP 05 15",
    edition: "01 15",
    title: "Disclosure Pursuant to Terrorism Risk Insurance Act",
    kind: "other",
    verbatim:
      "Disclosure of premium attributable to coverage for certified acts of terrorism under the Terrorism Risk Insurance Act, as amended.",
  },
];

export function coterieFormKey(form: string, edition: string): string {
  return `${form}::${edition}`;
}
