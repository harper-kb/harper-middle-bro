import { coverageLabel } from "./catalog";
import { getPolicyFormSetFromStore } from "./policy-store";
import type { Policy } from "./types";

/**
 * Per-policy coverage parts, limits, and endorsement schedule with form numbers.
 * Reference data for the AI Desk rail — what's actually on the paper,
 * so operators (and the desk) learn forms, not vibes.
 *
 * This is also the source of truth a certificate gets checked against:
 * a cert may only claim a limit or an endorsement that exists here.
 */

export type EndorsementKind = "ai" | "wos" | "pnc" | "exclusion" | "other";

/**
 * How the endorsement grants status. `blanket` = automatic when a written
 * contract requires it (no UW touch needed for a cert); `scheduled` = the
 * holder must be named on the policy by the market. Deterministic — set from
 * the form itself, never inferred from prose.
 */
export type EndorsementScope = "blanket" | "scheduled";

/** ACORD-style limit boxes. A cert can only fill a box the policy actually has. */
export type LimitSlot =
  | "gl_each_occurrence"
  | "gl_damage_premises"
  | "gl_med_exp"
  | "gl_personal_adv"
  | "gl_general_aggregate"
  | "gl_products_completed_ops"
  | "liquor_each_common_cause"
  | "auto_combined_single"
  // ACORD 30 garage liability: an auto-only per-accident limit plus the
  // other-than-auto pair (each accident / aggregate).
  | "gar_auto_only_each_accident"
  | "gar_other_than_auto_each_accident"
  | "gar_other_than_auto_aggregate"
  // Garagekeepers physical-damage perils — per-location limits (see
  // PolicyLimit.loc for the LOC write-in that pairs with each).
  | "gk_comp_otc"
  | "gk_specified_perils"
  | "gk_collision"
  | "umb_each_occurrence"
  | "umb_aggregate"
  | "wc_el_each_accident"
  | "wc_el_disease_employee"
  | "wc_el_disease_policy"
  | "prof_each_claim"
  | "prof_aggregate"
  | "cyber_aggregate";

export const LIMIT_SLOT_LABELS: Record<LimitSlot, string> = {
  gl_each_occurrence: "Each Occurrence",
  gl_damage_premises: "Damage To Rented Premises",
  gl_med_exp: "Medical Expense",
  gl_personal_adv: "Personal & Advertising Injury",
  gl_general_aggregate: "General Aggregate",
  gl_products_completed_ops: "Products / Completed Operations Aggregate",
  liquor_each_common_cause: "Liquor Liability — Each Common Cause",
  auto_combined_single: "Combined Single Limit",
  gar_auto_only_each_accident: "Garage Liability — Auto Only (Ea Accident)",
  gar_other_than_auto_each_accident:
    "Garage Liability — Other Than Auto Only (Ea Accident)",
  gar_other_than_auto_aggregate:
    "Garage Liability — Other Than Auto Only (Aggregate)",
  gk_comp_otc: "Garagekeepers — Comp / OTC",
  gk_specified_perils: "Garagekeepers — Specified Perils",
  gk_collision: "Garagekeepers — Collision",
  umb_each_occurrence: "Umbrella — Each Occurrence",
  umb_aggregate: "Umbrella — Aggregate",
  wc_el_each_accident: "E.L. Each Accident",
  wc_el_disease_employee: "E.L. Disease — Each Employee",
  wc_el_disease_policy: "E.L. Disease — Policy Limit",
  prof_each_claim: "Professional Liability — Each Claim",
  prof_aggregate: "Professional Liability — Aggregate",
  cyber_aggregate: "Cyber Liability — Aggregate",
};

export interface CoveragePart {
  code: string;
  label: string;
  form: string;
  edition: string;
}

/**
 * How a dec page states a limit line. Real GL declarations don't leave
 * sub-coverage boxes blank: a line is a dollar amount, "Included" (covered
 * within another limit, e.g. Products–Comp/Op Agg included in the General
 * Aggregate), or "Excluded" (e.g. Med Pay bought out on E&S paper).
 */
export type LimitMode = "amount" | "included" | "excluded";

export interface PolicyLimit {
  slot: LimitSlot;
  /** Omitted = "amount". */
  mode?: LimitMode;
  /** Cents — present exactly when the line is stated as a dollar amount. */
  amountCents?: number;
  /**
   * Dec-page location reference for per-location limits — the LOC write-in
   * that pairs with each garagekeepers perils row on ACORD 30.
   */
  loc?: string;
}

export function limitMode(l: PolicyLimit): LimitMode {
  return l.mode ?? "amount";
}

/** Dec-page text for a limit line: "$1,000,000", "Included", or "Excluded". */
export function limitStatement(l: PolicyLimit): string {
  const mode = limitMode(l);
  if (mode === "included") return "Included";
  if (mode === "excluded") return "Excluded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((l.amountCents ?? 0) / 100);
}

export interface EndorsementForm {
  form: string;
  edition: string;
  title: string;
  kind: EndorsementKind;
  note?: string;
  /** Blanket vs scheduled grant — omitted when the form doesn't carry the distinction (e.g. follow-form) */
  scope?: EndorsementScope;
}

export interface PolicyFormSet {
  coverages: CoveragePart[];
  limits: PolicyLimit[];
  endorsements: EndorsementForm[];
  /**
   * True when this set is the bare-code fallback — no schedule of record on
   * file, only the policy record's coverage codes expanded to their catalog
   * names. An unscheduled set places the policy in its coverage section
   * (identity cells fill from the policy record), but claims nothing else:
   * no checkbox resolves, no limit box prints — blank, never "Excluded",
   * because there is no dec page to state an exclusion.
   */
  unscheduled?: boolean;
}

export function endorsementKindLabel(kind: EndorsementKind): string {
  switch (kind) {
    case "ai":
      return "AI";
    case "wos":
      return "WOS";
    case "pnc":
      return "P&NC";
    case "exclusion":
      return "Excl";
    case "other":
      return "Form";
  }
}

export function limitSlotLabel(slot: LimitSlot): string {
  return LIMIT_SLOT_LABELS[slot];
}

const M = (millions: number) => Math.round(millions * 1_000_000 * 100);
const K = (thousands: number) => Math.round(thousands * 1_000 * 100);

/** Seed schedules — synced into SQLite; getPolicyFormSet prefers DB. */
export const FORM_SETS: Record<string, PolicyFormSet> = {
  "pol-apex-gl": {
    coverages: [
      { code: "GL", label: "Commercial General Liability (occurrence)", form: "CG 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_damage_premises", amountCents: K(100) },
      // Kinsale E&S form: medical payments deleted, not bought back.
      { slot: "gl_med_exp", mode: "excluded" },
      { slot: "gl_personal_adv", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      { slot: "gl_products_completed_ops", amountCents: M(2) },
    ],
    endorsements: [
      { form: "CG 20 10", edition: "04 13", title: "Additional Insured — Owners, Lessees or Contractors (ongoing ops)", kind: "ai", scope: "scheduled", note: "Scheduled — holder must be named" },
      { form: "CG 20 37", edition: "04 13", title: "Additional Insured — Completed Operations", kind: "ai", scope: "scheduled", note: "Often required with 20 10 on construction" },
      { form: "CG 24 04", edition: "05 09", title: "Waiver of Transfer of Rights (WOS)", kind: "wos", scope: "scheduled" },
      { form: "KIN-EX 01", edition: "01 24", title: "Roofing Ops — Open Flame Exclusion", kind: "exclusion", note: "Torch-down work excluded" },
      { form: "KIN-EX 07", edition: "01 24", title: "Medical Payments Exclusion", kind: "exclusion", note: "Med Exp box prints Excluded" },
    ],
  },
  "pol-apex-umb": {
    coverages: [
      { code: "EXCESS_UMB", label: "Excess / Umbrella Liability", form: "CU 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "umb_each_occurrence", amountCents: M(5) },
      { slot: "umb_aggregate", amountCents: M(5) },
    ],
    endorsements: [
      { form: "CU 24 30", edition: "12 19", title: "Follow-Form Additional Insured", kind: "ai", note: "Follows underlying GL schedule" },
    ],
  },
  "pol-harbor-pkg": {
    coverages: [
      { code: "GL", label: "Commercial General Liability", form: "CG 00 01", edition: "04 13" },
      { code: "PL", label: "Professional Liability (claims-made)", form: "HSX-PL 100", edition: "06 22" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      { slot: "gl_damage_premises", amountCents: K(100) },
      { slot: "prof_each_claim", amountCents: M(1) },
      { slot: "prof_aggregate", amountCents: M(1) },
    ],
    endorsements: [
      { form: "CG 20 11", edition: "04 13", title: "Additional Insured — Managers or Lessors of Premises", kind: "ai", scope: "scheduled", note: "Right form for landlord AI" },
      { form: "CG 21 44", edition: "07 98", title: "Limitation of Coverage to Designated Premises", kind: "exclusion" },
    ],
  },
  "pol-harbor-cyber": {
    coverages: [
      { code: "CL", label: "Cyber Liability", form: "HSX-CY 200", edition: "03 23" },
    ],
    limits: [{ slot: "cyber_aggregate", amountCents: M(1) }],
    endorsements: [],
  },
  "pol-northstar-gar": {
    // Garage program stated the way a CA 00 05 dec actually reads: an
    // auto-only each-accident limit, the other-than-auto pair, and
    // garagekeepers perils with per-location (LOC) limits — the schedule
    // ACORD 30's garage sections print from.
    coverages: [
      { code: "Garage", label: "Garage Liability", form: "CA 00 05", edition: "10 13" },
      { code: "GK", label: "Garagekeepers — Legal Liability", form: "CA 99 37", edition: "10 13" },
      { code: "HNOA", label: "Hired & Non-Owned Auto", form: "CA 20 54", edition: "10 13" },
    ],
    limits: [
      { slot: "gar_auto_only_each_accident", amountCents: M(1) },
      { slot: "gar_other_than_auto_each_accident", amountCents: M(1) },
      { slot: "gar_other_than_auto_aggregate", amountCents: M(2) },
      { slot: "gk_comp_otc", amountCents: K(250), loc: "LOC 1" },
      { slot: "gk_collision", amountCents: K(250), loc: "LOC 1" },
    ],
    endorsements: [
      { form: "CA 20 48", edition: "10 13", title: "Designated Insured — Covered Autos Liability", kind: "ai", scope: "scheduled", note: "Auto-side AI equivalent" },
      { form: "CA 04 44", edition: "10 13", title: "Waiver of Transfer of Rights (Auto)", kind: "wos", scope: "scheduled" },
    ],
  },
  "pol-northstar-wc": {
    coverages: [
      { code: "WC", label: "Workers Compensation & Employers Liability", form: "WC 00 00 00", edition: "C" },
    ],
    limits: [
      { slot: "wc_el_each_accident", amountCents: M(1) },
      { slot: "wc_el_disease_employee", amountCents: M(1) },
      { slot: "wc_el_disease_policy", amountCents: M(1) },
    ],
    endorsements: [
      { form: "WC 04 03 06", edition: "04 84", title: "Waiver of Our Right to Recover (CA)", kind: "wos", scope: "scheduled", note: "Per-entity schedule, premium bearing" },
    ],
  },
  "pol-craft-liq": {
    coverages: [
      { code: "GL", label: "Commercial General Liability", form: "CG 00 01", edition: "04 13" },
      { code: "Liquor", label: "Liquor Liability", form: "CG 00 33", edition: "04 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      { slot: "liquor_each_common_cause", amountCents: M(1) },
    ],
    endorsements: [
      { form: "CG 20 33", edition: "04 13", title: "Additional Insured — Owners, Lessees or Contractors — Automatic Status When Required by Written Contract", kind: "ai", scope: "blanket", note: "Blanket — venue certs issue on wording alone" },
      { form: "CG 20 26", edition: "04 13", title: "Additional Insured — Designated Person or Organization", kind: "ai", scope: "scheduled", note: "Broad scheduled AI — venue requests" },
      { form: "USLI-LL 22", edition: "09 21", title: "Assault & Battery Sublimit", kind: "exclusion" },
    ],
  },
  "pol-greenleaf-bop": {
    coverages: [
      { code: "BOP", label: "Businessowners Package", form: "BP 00 03", edition: "07 13" },
      { code: "GL", label: "Liability Section", form: "BP 00 03 §II", edition: "07 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      { slot: "gl_damage_premises", amountCents: K(50) },
      // BOP §II states these lines, but not as separate dollars:
      // P&AI and Products–Comp/Op ride inside the liability limits; the
      // med-pay option is deleted on this program.
      { slot: "gl_personal_adv", mode: "included" },
      { slot: "gl_products_completed_ops", mode: "included" },
      { slot: "gl_med_exp", mode: "excluded" },
    ],
    endorsements: [
      { form: "BP 04 48", edition: "07 13", title: "Additional Insured — Blanket (written contract)", kind: "ai", scope: "blanket", note: "Blanket — may already satisfy HOA" },
      { form: "BP 04 97", edition: "07 13", title: "Waiver of Subrogation — Blanket", kind: "wos", scope: "blanket" },
      { form: "BP 14 01", edition: "07 13", title: "Exclusion — Medical Payments", kind: "exclusion", note: "Med Exp box prints Excluded" },
    ],
  },
  "pol-summit-gl": {
    coverages: [
      { code: "GL", label: "Commercial General Liability", form: "CG 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      { slot: "gl_products_completed_ops", amountCents: M(2) },
    ],
    endorsements: [
      { form: "CG 20 33", edition: "04 13", title: "Additional Insured — Owners, Lessees or Contractors — Automatic Status When Required by Written Contract", kind: "ai", scope: "blanket", note: "Blanket — GC certs issue on wording alone" },
      { form: "CG 20 10", edition: "04 13", title: "Additional Insured — Owners, Lessees or Contractors", kind: "ai", scope: "scheduled", note: "Scheduled — for holders who must be named" },
      { form: "CG 24 04", edition: "05 09", title: "Waiver of Transfer of Rights (WOS)", kind: "wos", scope: "blanket", note: "Schedule reads: any person or organization as required by written contract" },
      { form: "CG 20 01", edition: "04 13", title: "Primary & Noncontributory", kind: "pnc" },
      { form: "ISC-GL 40", edition: "02 25", title: "Subcontractor Warranty", kind: "other" },
    ],
  },
  // ——— Ridgeline Automation — the kitchen-sink program (4 carriers, A–D) ———
  "pol-ridgeline-gl": {
    coverages: [
      { code: "GL", label: "Commercial General Liability (occurrence)", form: "CG 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_damage_premises", amountCents: K(100) },
      // Kinsale E&S: med pay deleted program-wide.
      { slot: "gl_med_exp", mode: "excluded" },
      { slot: "gl_personal_adv", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      // Dec states products-completed ops within the General Aggregate.
      { slot: "gl_products_completed_ops", mode: "included" },
    ],
    endorsements: [
      { form: "CG 20 10", edition: "04 13", title: "Additional Insured — Owners, Lessees or Contractors (ongoing ops)", kind: "ai", scope: "scheduled", note: "Scheduled — holder must be named" },
      { form: "CG 20 01", edition: "04 13", title: "Primary & Noncontributory — Other Insurance Condition", kind: "pnc" },
      { form: "CG 24 04", edition: "05 09", title: "Waiver of Transfer of Rights (WOS)", kind: "wos", scope: "scheduled" },
      { form: "KIN-EX 07", edition: "01 24", title: "Medical Payments Exclusion", kind: "exclusion", note: "Med Exp box prints Excluded" },
    ],
  },
  "pol-ridgeline-auto": {
    coverages: [
      { code: "CA", label: "Business Auto — Any Auto (Symbol 1)", form: "CA 00 01", edition: "11 20" },
    ],
    limits: [{ slot: "auto_combined_single", amountCents: M(1) }],
    endorsements: [
      { form: "CA 20 48", edition: "10 13", title: "Designated Insured — Covered Autos Liability", kind: "ai", scope: "scheduled", note: "Auto-side AI equivalent" },
      { form: "CA 04 44", edition: "10 13", title: "Waiver of Transfer of Rights (Auto)", kind: "wos", scope: "scheduled" },
    ],
  },
  "pol-ridgeline-umb": {
    coverages: [
      { code: "EXCESS_UMB", label: "Excess / Umbrella Liability", form: "CU 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "umb_each_occurrence", amountCents: M(5) },
      { slot: "umb_aggregate", amountCents: M(5) },
    ],
    endorsements: [
      { form: "CU 24 30", edition: "12 19", title: "Follow-Form Additional Insured", kind: "ai", note: "Follows underlying GL & auto schedule" },
    ],
  },
  "pol-ridgeline-wc": {
    coverages: [
      { code: "WC", label: "Workers Compensation & Employers Liability", form: "WC 00 00 00", edition: "C" },
    ],
    limits: [
      { slot: "wc_el_each_accident", amountCents: M(1) },
      { slot: "wc_el_disease_employee", amountCents: M(1) },
      { slot: "wc_el_disease_policy", amountCents: M(1) },
    ],
    endorsements: [
      { form: "WC 00 03 13", edition: "04 84", title: "Waiver of Our Right to Recover From Others", kind: "wos", scope: "blanket", note: "Blanket where the state allows it" },
    ],
  },
  "pol-ridgeline-eo": {
    coverages: [
      { code: "TECH_EO", label: "Technology E&O (claims-made)", form: "MKL-TE 100", edition: "05 24" },
      { code: "CL", label: "Cyber Liability", form: "MKL-CY 210", edition: "05 24" },
    ],
    limits: [
      { slot: "prof_each_claim", amountCents: M(2) },
      { slot: "prof_aggregate", amountCents: M(2) },
      { slot: "cyber_aggregate", amountCents: M(1) },
    ],
    endorsements: [
      { form: "MKL-TE 115", edition: "05 24", title: "Additional Insured — Client Contract", kind: "ai", scope: "scheduled", note: "E&O AI is rare — confirm UW intent" },
    ],
  },
  // ——— Meridian Reach Marketing — COI overflow stress fixture (6 policies,
  // 4 carriers; E&O + Cyber + Liquor + a second GL exceed the printed rows) ———
  "pol-meridian-gl": {
    coverages: [
      { code: "GL", label: "Commercial General Liability (occurrence)", form: "CG 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_damage_premises", amountCents: K(100) },
      { slot: "gl_med_exp", amountCents: K(5) },
      { slot: "gl_personal_adv", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      // Dec states products-completed ops within the General Aggregate.
      { slot: "gl_products_completed_ops", mode: "included" },
    ],
    endorsements: [
      { form: "CG 20 26", edition: "04 13", title: "Additional Insured — Designated Person or Organization", kind: "ai", scope: "scheduled", note: "Scheduled — holder must be named" },
      { form: "CG 20 01", edition: "04 13", title: "Primary & Noncontributory — Other Insurance Condition", kind: "pnc" },
      { form: "CG 24 04", edition: "05 09", title: "Waiver of Transfer of Rights (WOS)", kind: "wos", scope: "scheduled" },
    ],
  },
  "pol-meridian-auto": {
    coverages: [
      { code: "CA", label: "Business Auto — Hired & Non-Owned (Symbols 8, 9)", form: "CA 00 01", edition: "11 20" },
    ],
    limits: [{ slot: "auto_combined_single", amountCents: M(1) }],
    endorsements: [
      { form: "CA 04 44", edition: "10 13", title: "Waiver of Transfer of Rights (Auto)", kind: "wos", scope: "scheduled" },
    ],
  },
  "pol-meridian-umb": {
    coverages: [
      { code: "EXCESS_UMB", label: "Excess / Umbrella Liability", form: "CU 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "umb_each_occurrence", amountCents: M(5) },
      { slot: "umb_aggregate", amountCents: M(5) },
    ],
    endorsements: [
      { form: "CU 24 30", edition: "12 19", title: "Follow-Form Additional Insured", kind: "ai", note: "Follows underlying GL & auto schedule" },
    ],
  },
  "pol-meridian-wc": {
    coverages: [
      { code: "WC", label: "Workers Compensation & Employers Liability", form: "WC 00 00 00", edition: "C" },
    ],
    limits: [
      { slot: "wc_el_each_accident", amountCents: M(1) },
      { slot: "wc_el_disease_employee", amountCents: M(1) },
      { slot: "wc_el_disease_policy", amountCents: M(1) },
    ],
    endorsements: [
      { form: "WC 00 03 13", edition: "04 84", title: "Waiver of Our Right to Recover From Others", kind: "wos", scope: "blanket", note: "Blanket where the state allows it" },
    ],
  },
  "pol-meridian-eo": {
    coverages: [
      { code: "PL", label: "Media & Advertising E&O (claims-made)", form: "HSX-ME 410", edition: "02 25" },
      { code: "CL", label: "Cyber Liability", form: "HSX-CY 200", edition: "03 23" },
    ],
    limits: [
      { slot: "prof_each_claim", amountCents: M(2) },
      { slot: "prof_aggregate", amountCents: M(2) },
      { slot: "cyber_aggregate", amountCents: M(1) },
    ],
    endorsements: [],
  },
  "pol-meridian-events": {
    coverages: [
      { code: "GL", label: "Special Events General Liability", form: "CG 00 01", edition: "04 13" },
      { code: "Liquor", label: "Host Liquor Liability", form: "CG 00 33", edition: "04 13" },
    ],
    limits: [
      { slot: "gl_each_occurrence", amountCents: M(1) },
      { slot: "gl_general_aggregate", amountCents: M(2) },
      { slot: "liquor_each_common_cause", amountCents: M(1) },
    ],
    endorsements: [
      { form: "CG 20 26", edition: "04 13", title: "Additional Insured — Designated Person or Organization", kind: "ai", scope: "scheduled", note: "Venue AI for event certs" },
    ],
  },
  "pol-pixel-eo": {
    coverages: [
      { code: "TECH_EO", label: "Technology E&O (claims-made)", form: "HSX-TE 300", edition: "01 24" },
      { code: "CL", label: "Cyber Liability", form: "HSX-CY 200", edition: "03 23" },
    ],
    limits: [
      { slot: "prof_each_claim", amountCents: M(2) },
      { slot: "prof_aggregate", amountCents: M(2) },
      { slot: "cyber_aggregate", amountCents: M(1) },
    ],
    endorsements: [
      { form: "HSX-TE 315", edition: "01 24", title: "Additional Insured — Client Contract", kind: "ai", scope: "scheduled", note: "E&O AI is rare — confirm UW intent" },
    ],
  },
};

/**
 * Coverage-code names for the bare fallback where the catalog label doesn't
 * read the way a dec page (and the ACORD section matchers) spell the line.
 * Deterministic code expansion — the code IS on the policy record.
 */
const BARE_CODE_LABELS: Record<string, string> = {
  // Catalog says "Workers' Compensation"; the section matcher and every
  // dec page print it without the apostrophe.
  WC: "Workers Compensation",
};

/**
 * The bare-code fallback set for a policy with no schedule of record: each
 * coverage code expands to its catalog name (so the coverage section that
 * owns the line can claim the policy), with no limits and no endorsements —
 * and `unscheduled` marking that nothing beyond identity may print.
 */
export function bareFormSet(coverages: string[]): PolicyFormSet {
  return {
    coverages: coverages.map((code) => ({
      code,
      label: BARE_CODE_LABELS[code] ?? coverageLabel(code),
      form: "—",
      edition: "",
    })),
    limits: [],
    endorsements: [],
    unscheduled: true,
  };
}

/** Forms on file for a policy; DB schedule first, then seed, then bare codes. */
export function getPolicyFormSet(policy: Policy): PolicyFormSet {
  const fromDb = getPolicyFormSetFromStore(policy.id);
  if (fromDb) return fromDb;
  const known = FORM_SETS[policy.id];
  if (known) return known;
  return bareFormSet(policy.coverages);
}

/** First endorsement of a kind carried on the policy, if any. */
export function findEndorsement(
  set: PolicyFormSet,
  kind: EndorsementKind,
): EndorsementForm | null {
  return set.endorsements.find((e) => e.kind === kind) ?? null;
}

/**
 * The blanket form of a kind on this policy, if the schedule carries one.
 * This is the deterministic answer to "does the paper already grant this?" —
 * a certificate can cite it without touching the market.
 */
export function findBlanketForm(
  set: PolicyFormSet,
  kind: "ai" | "wos",
): EndorsementForm | null {
  return (
    set.endorsements.find((e) => e.kind === kind && e.scope === "blanket") ??
    null
  );
}

export function hasBlanketAi(set: PolicyFormSet): boolean {
  return findBlanketForm(set, "ai") != null;
}

export function hasBlanketWos(set: PolicyFormSet): boolean {
  return findBlanketForm(set, "wos") != null;
}

/** Endorsement whose title matches a pattern — for coverage grants without a kind. */
export function findEndorsementByTitle(
  set: PolicyFormSet,
  pattern: RegExp,
): EndorsementForm | null {
  return set.endorsements.find((e) => pattern.test(e.title)) ?? null;
}

export function limitFor(set: PolicyFormSet, slot: LimitSlot): PolicyLimit | null {
  return set.limits.find((l) => l.slot === slot) ?? null;
}
