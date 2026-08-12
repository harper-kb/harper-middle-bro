import type { CoiFlags } from "./coi";
import type { CertSection } from "./certificate";
import {
  LIMIT_SLOT_LABELS,
  limitMode,
  type LimitSlot,
  type PolicyFormSet,
  type PolicyLimit,
} from "./forms";

/**
 * ACORD 25 (2025/12) section layer — data-driven, one descriptor per box.
 * (The 2025/12 edition kept every section, checkbox, and limit label of
 * 2016/03 — see docs/acord-forms-research.md §5.3/§5.4 — so these
 * descriptors carry over unchanged.)
 *
 * The printed form has four fixed coverage sections (General Liability,
 * Automobile Liability, Umbrella/Excess, Workers Compensation) plus one
 * additional write-in row. Each section is described by a `SectionDef` in
 * `SECTION_DEFS`: its type-cell layout (label + checkbox rows exactly as the
 * blank form prints them), its limit boxes with the schedule slot that backs
 * each one, and a `resolveChecks` that reads checkbox states off the feeder
 * policy's schedule of record.
 *
 * Adding a new form section (e.g. Garage Liability with carrier-specific
 * fill rules) means appending one descriptor here — the resolver, the
 * renderer, the extraction-review suggestions, and the edited-sheet verifier
 * all iterate SECTION_DEFS and pick it up with no new bespoke code.
 *
 * Accuracy contract: a resolver only fills a box the schedule backs. A
 * section with no backing policy prints entirely blank; inside a backed
 * section every slot box resolves to the dec-page statement — a dollar
 * amount, "Included", or (when the dec doesn't state the line) "Excluded".
 * Nothing is inferred: every checkbox state, every dollar, and every
 * Included mark traces to a form-set field; "Excluded" claims nothing.
 *
 * Unscheduled policies (bare coverage codes, no schedule of record) place
 * by coverage name into their section — identity cells fill straight from
 * the policy record — but the section claims nothing else: no checkbox
 * resolves and every limit box prints blank. There is no dec page on file,
 * so there is nothing to state; blank beats wrong.
 *
 * Desk placement rules (operator corrections persisted per policy) override
 * the coverage matcher: a policy with a rule feeds exactly the section the
 * desk assigned and no other. Rules carry provenance (`placedByRule`) so
 * the studio can show who put the row there — and let the desk revoke it.
 */

/** Identity cells shared by every section row. Flags come off the verified draft. */
export interface SectionPolicyRef {
  insurerLetter: string;
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  additionalInsured: boolean;
  subrogationWaived: boolean;
}

/** One checkbox printed inside a type cell (or the WC limits-head row). */
export interface CheckItemDef {
  key: string;
  /** Caption exactly as the blank form prints it */
  label: string;
  bold?: boolean;
  /** Free write-in line after the label (e.g. GL "OTHER:") */
  writeInKey?: string;
}

/** One line of the TYPE OF INSURANCE cell, in print order. */
export type TypeCellLine =
  | { kind: "title"; text: string }
  | { kind: "checks"; pre?: string; items: CheckItemDef[]; post?: string }
  | { kind: "text"; text: string };

/** One box in the LIMITS column. `slot: null` = no data source, prints blank. */
export interface LimitBoxDef {
  key: string;
  label: string;
  slot: LimitSlot | null;
  /**
   * Perils checkbox printed inside the limit row (ACORD 30 garagekeepers:
   * Comp/OTC · Specified Perils · Collision). Resolves checked exactly when
   * the schedule carries the row's slot.
   */
  check?: CheckItemDef;
  /**
   * LOC write-in between the label and the $ box (garagekeepers rows carry
   * per-location limits). Backed by `PolicyLimit.loc` on the schedule.
   */
  withLoc?: boolean;
}

export interface SectionDef {
  key: string;
  /** Rail / review-panel name for the section */
  name: string;
  /** Coverage-part matcher that claims a policy as this section's feeder */
  match: RegExp;
  /** Slots this section's boxes consume (kept off the additional rows) */
  slots: LimitSlot[];
  typeCell: TypeCellLine[];
  limitBoxes: LimitBoxDef[];
  /** Full-width checkbox row above the limit boxes (WC PER STATUTE / OTHER) */
  limitsHead?: CheckItemDef[];
  /**
   * Checkbox keys that map to verifier flags — turning one on routes through
   * `verifyCoi`'s endorsement check (with price guidance) instead of the
   * generic unbacked-box reject.
   */
  flagChecks?: Record<string, keyof CoiFlags>;
  /**
   * Check keys that cannot print together, in precedence order — the first
   * true key wins and the rest clear. Note that some boxes on the same row
   * ARE legitimately co-checked (hired and non-owned autos, for one), so
   * these are declared pair by pair rather than a row at a time.
   */
  exclusive?: string[][];
  /**
   * Which coverage parts this section may read when deciding its boxes.
   * Defaults to `match`. Widen it only where the form gives a row evidence
   * from elsewhere — ACORD 30's garage row carries the policy's auto
   * symbols because that form has no automobile section.
   */
  evidence?: RegExp;
  /** Checkbox states earned from this section's own evidence. */
  resolveChecks: (ev: SectionEvidence) => Record<string, boolean>;
}

/**
 * Everything a section is allowed to read when deciding its checkboxes.
 *
 * The resolvers used to receive the whole `CertSection` and each decided
 * for itself what to look at. Every one of them reached for a joined string
 * of every coverage label on the policy, so one coverage's wording drove
 * another's boxes: a part reading "excess" ticked EXCESS LIAB on the
 * umbrella row, and the general liability resolver fell back to the first
 * part on the policy when nothing named general liability — which is how a
 * cyber policy came to have OCCUR ticked under COMMERCIAL GENERAL
 * LIABILITY.
 *
 * Handing the resolver a scoped view instead of the policy makes that class
 * of mistake unavailable rather than merely corrected. `text` is empty when
 * the schedule names none of this section's coverage, and empty evidence
 * must earn no box — there is no fallback to look at something else.
 */
export interface SectionEvidence {
  /** Labels of the coverage parts belonging to this section, joined. */
  text: string;
  /**
   * Form numbers of those parts. The label is a product name and lies about
   * the distinction that matters — "Excess / Umbrella Liability" is sold as
   * both — where the form number is the coverage itself.
   */
  forms: string[];
  /** True when the schedule states this limit line. */
  carries: (slot: LimitSlot) => boolean;
  /**
   * Endorsement titles on the policy. Not part-scoped: an endorsement
   * amends the policy and names its own coverage in its title.
   */
  endorsementTitles: string[];
}

function coverageText(set: PolicyFormSet): string {
  return set.coverages.map((c) => c.label).join(" · ");
}

/**
 * Build the scoped view a section is allowed to read. Only the coverage
 * parts this section is about — and no fallback to the rest of the policy
 * when none match, because "we found nothing that names this coverage" has
 * to mean no box is earned, not "read something else instead".
 */
function evidenceFor(def: SectionDef, set: PolicyFormSet): SectionEvidence {
  const parts = set.coverages.filter((c) => (def.evidence ?? def.match).test(c.label));
  return {
    text: parts.map((c) => c.label).join(" · "),
    forms: parts.map((c) => c.form),
    carries: (slot) => set.limits.some((l) => l.slot === slot),
    endorsementTitles: set.endorsements.map((e) => e.title),
  };
}

/**
 * Boxes that cannot be true together on the printed form, applied after the
 * section resolves. Each group is in precedence order: the first true key
 * wins and the rest clear.
 *
 * This is a backstop, not the mechanism — a resolver should return at most
 * one side of a pair on its own. It exists because the failure mode is
 * silent and serious: a certificate ticking both UMBRELLA LIAB and EXCESS
 * LIAB certifies a policy that cannot exist, and nothing downstream was
 * positioned to notice.
 */
function applyExclusive(
  def: SectionDef,
  checks: Record<string, boolean>,
): Record<string, boolean> {
  if (!def.exclusive) return checks;
  const out = { ...checks };
  for (const group of def.exclusive) {
    let taken = false;
    for (const key of group) {
      if (!out[key]) continue;
      if (taken) out[key] = false;
      else taken = true;
    }
  }
  return out;
}

export const SECTION_DEFS: SectionDef[] = [
  {
    key: "gl",
    name: "Commercial General Liability",
    match: /general liability|liability section/i,
    slots: [
      "gl_each_occurrence",
      "gl_damage_premises",
      "gl_med_exp",
      "gl_personal_adv",
      "gl_general_aggregate",
      "gl_products_completed_ops",
    ],
    typeCell: [
      { kind: "title", text: "Commercial General Liability" },
      {
        kind: "checks",
        items: [
          { key: "claimsMade", label: "Claims-Made" },
          { key: "occur", label: "Occur" },
        ],
      },
      // The blank form carries two unlabeled write-in checkbox rows here.
      { kind: "checks", items: [{ key: "glCustom1", label: "", writeInKey: "glCustom1Text" }] },
      { kind: "checks", items: [{ key: "glCustom2", label: "", writeInKey: "glCustom2Text" }] },
      { kind: "text", text: "Gen'l Aggregate Limit Applies Per:" },
      {
        kind: "checks",
        items: [
          { key: "aggPolicy", label: "Policy" },
          { key: "aggProject", label: "Pro-ject" },
          { key: "aggLoc", label: "Loc" },
        ],
      },
      {
        kind: "checks",
        items: [{ key: "aggOther", label: "Other:", writeInKey: "aggOtherText" }],
      },
    ],
    limitBoxes: [
      { key: "eachOccurrence", label: "Each Occurrence", slot: "gl_each_occurrence" },
      {
        key: "damagePremises",
        label: "Damage To Rented Premises (Ea occurrence)",
        slot: "gl_damage_premises",
      },
      { key: "medExp", label: "Med Exp (Any one person)", slot: "gl_med_exp" },
      { key: "personalAdv", label: "Personal & Adv Injury", slot: "gl_personal_adv" },
      { key: "generalAggregate", label: "General Aggregate", slot: "gl_general_aggregate" },
      {
        key: "productsCompOp",
        label: "Products - Comp/Op Agg",
        slot: "gl_products_completed_ops",
      },
      { key: "glBlank", label: "", slot: null },
    ],
    flagChecks: { aggProject: "perProjectAggregate" },
    exclusive: [
      ["claimsMade", "occur"],
      ["aggProject", "aggLoc", "aggPolicy"],
    ],
    resolveChecks: (ev) => {
      // CG 00 01 is an occurrence form — claims-made only when the dec says
      // so. The statement lives in TWO places on real paper: the coverage
      // part's own label, or a scheduled claims-made endorsement (ISC decs
      // carry "Claims-Made and Reported Limitation", HS/SP CMR 00 00).
      // Checking OCCUR against claims-made paper overstates the coverage.
      // Every box below is earned only if the schedule names this coverage.
      // OCCUR and POLICY are the ISO defaults for CG 00 01, but a default is
      // a statement about a form that is on the policy — inferring them from
      // the absence of contrary wording ticks boxes for a coverage nothing
      // says is there.
      const named = ev.text.trim() !== "";
      const claimsMade =
        named &&
        (/claims-?made/i.test(ev.text) ||
          ev.endorsementTitles.some((t) => /claims-?made/i.test(t)));
      // Per policy unless a per-project / per-location aggregate form is scheduled.
      const perProject = ev.endorsementTitles.some((t) =>
        /per[- ]project/i.test(t),
      );
      const perLoc =
        !perProject &&
        ev.endorsementTitles.some((t) => /per[- ]location/i.test(t));
      return {
        claimsMade,
        occur: named && !claimsMade,
        aggPolicy: named && !perProject && !perLoc,
        aggProject: named && perProject,
        aggLoc: named && perLoc,
      };
    },
  },
  {
    key: "auto",
    name: "Automobile Liability",
    // Deliberately does NOT match garage liability. An ACORD 25 has no garage
    // block, so claiming a garage policy here prints "Excluded" against every
    // auto box the garage dec never states — certifying an exclusion that
    // isn't on the paper. A garage policy that also writes a business auto or
    // hired/non-owned part still lands here on the word "auto", and fills the
    // row from its own schedule.
    match: /\bautos?\b|automobile/i,
    slots: ["auto_combined_single"],
    typeCell: [
      { kind: "title", text: "Automobile Liability" },
      { kind: "checks", items: [{ key: "anyAuto", label: "Any Auto" }] },
      {
        kind: "checks",
        items: [
          { key: "ownedOnly", label: "Owned Autos Only" },
          { key: "scheduled", label: "Scheduled Autos" },
        ],
      },
      {
        kind: "checks",
        items: [
          { key: "hiredOnly", label: "Hired Autos Only" },
          { key: "nonOwnedOnly", label: "Non-Owned Autos Only" },
        ],
      },
      { kind: "checks", items: [{ key: "autoCustom", label: "", writeInKey: "autoCustomText" }] },
    ],
    limitBoxes: [
      {
        key: "combinedSingle",
        label: "Combined Single Limit (Ea accident)",
        slot: "auto_combined_single",
      },
      // Split BI/PD boxes have no LimitSlot on the schedule — always blank.
      { key: "biPerPerson", label: "Bodily Injury (Per person)", slot: null },
      { key: "biPerAccident", label: "Bodily Injury (Per accident)", slot: null },
      { key: "pdPerAccident", label: "Property Damage (Per accident)", slot: null },
      { key: "autoBlank", label: "", slot: null },
    ],
    // ANY AUTO is symbol 1 — it subsumes the narrower boxes, and each of
    // those reads "ONLY", so it cannot print beside them. Hired and
    // non-owned, by contrast, are routinely both on the same dec.
    exclusive: [
      ["anyAuto", "ownedOnly"],
      ["anyAuto", "scheduled"],
      ["anyAuto", "hiredOnly"],
      ["anyAuto", "nonOwnedOnly"],
    ],
    resolveChecks: (ev) => {
      // "Non-Owned" contains "Owned" — strip it before testing the owned box.
      const withoutNonOwned = ev.text.replace(/non-?owned/gi, "");
      return {
        anyAuto: /any auto/i.test(ev.text),
        ownedOnly: /owned autos?/i.test(withoutNonOwned),
        scheduled: /scheduled/i.test(ev.text),
        hiredOnly: /hired/i.test(ev.text),
        nonOwnedOnly: /non-?owned/i.test(ev.text),
      };
    },
  },
  {
    key: "umbrella",
    name: "Umbrella / Excess Liability",
    match: /umbrella|excess liab/i,
    slots: ["umb_each_occurrence", "umb_aggregate"],
    typeCell: [
      {
        kind: "checks",
        items: [
          { key: "umbrella", label: "Umbrella Liab", bold: true },
          { key: "occur", label: "Occur" },
        ],
      },
      {
        kind: "checks",
        items: [
          { key: "excess", label: "Excess Liab", bold: true },
          { key: "claimsMade", label: "Claims-Made" },
        ],
      },
      {
        kind: "checks",
        items: [
          { key: "ded", label: "Ded" },
          // No deductible / retention data on the schedule — blank, never invented.
          { key: "retention", label: "Retention $", writeInKey: "retentionText" },
        ],
      },
    ],
    limitBoxes: [
      { key: "eachOccurrence", label: "Each Occurrence", slot: "umb_each_occurrence" },
      { key: "aggregate", label: "Aggregate", slot: "umb_aggregate" },
      { key: "umbBlank", label: "", slot: null },
    ],
    exclusive: [
      ["umbrella", "excess"],
      ["claimsMade", "occur"],
    ],
    evidence: /umbrella|excess/i,
    resolveChecks: (ev) => {
      // CU 00 01 is occurrence — claims-made only when the dec states it,
      // on the part label or a scheduled claims-made endorsement.
      const text = ev.text;
      const named = text.trim() !== "";
      const claimsMade =
        named &&
        (/claims-?made/i.test(text) ||
          ev.endorsementTitles.some((t) => /claims-?made/i.test(t)));

      // UMBRELLA LIAB and EXCESS LIAB are alternatives on the printed form,
      // not two independent boxes. An umbrella can drop down and broaden;
      // excess only follows form above the underlying. A dec page states
      // one, and a certificate that ticks both certifies a policy that
      // cannot exist.
      //
      // The label alone can't decide it, because the product is routinely
      // sold as "Excess / Umbrella Liability" — which is what checked both.
      // The coverage form can: CU 00 01 is ISO's Commercial Liability
      // Umbrella. Excess paper is mostly proprietary follow-form with no
      // equivalent tell, so it is earned from an unambiguous label only.
      // When nothing distinguishes the two, neither box prints: the sheet
      // may not pick a coverage basis the schedule doesn't state.
      const umbrellaForm = ev.forms.some((f) => /\bCU\s*00\s*01\b/i.test(f));
      const saysUmbrella = /umbrella/i.test(text);
      const saysExcess = /excess/i.test(text);
      let umbrella = false;
      let excess = false;
      if (umbrellaForm || (saysUmbrella && !saysExcess)) umbrella = true;
      else if (saysExcess && !saysUmbrella) excess = true;

      return { umbrella, excess, occur: named && !claimsMade, claimsMade };
    },
  },
  {
    key: "wc",
    name: "Workers Compensation",
    match: /workers comp/i,
    slots: ["wc_el_each_accident", "wc_el_disease_employee", "wc_el_disease_policy"],
    typeCell: [
      { kind: "title", text: "Workers Compensation And Employers' Liability" },
      {
        kind: "checks",
        pre: "Any Proprietor/Partner/Executive Officer/Member Excluded?",
        items: [{ key: "excludedNA", label: "N / A" }],
        post: "Y / N (Mandatory in NH)",
      },
      { kind: "text", text: "If yes, describe under Description Of Operations below" },
    ],
    limitBoxes: [
      { key: "elEachAccident", label: "E.L. Each Accident", slot: "wc_el_each_accident" },
      {
        key: "elDiseaseEmployee",
        label: "E.L. Disease - Ea Employee",
        slot: "wc_el_disease_employee",
      },
      {
        key: "elDiseasePolicy",
        label: "E.L. Disease - Policy Limit",
        slot: "wc_el_disease_policy",
      },
    ],
    limitsHead: [
      { key: "perStatute", label: "Per Statute" },
      { key: "otherStatute", label: "Oth-er" },
    ],
    // Standard WC policy limits are statutory by definition.
    resolveChecks: () => ({ perStatute: true }),
  },
];

export function getSectionDef(key: string): SectionDef {
  const def = SECTION_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown ACORD 25 section: ${key}`);
  return def;
}

/* ————————————————— ACORD 30 — Certificate of Garage Insurance ————————————————— */

/**
 * ACORD 30 (2016/03) section descriptors, per docs/acord-forms-research.md §1.
 * The form is a structural sibling of ACORD 25 — same header, remarks and
 * footer plumbing — with a coverage grid that leads with Garage Liability and
 * Garage Keepers Liability, then CGL / Umbrella / WC rows. The registry was
 * built for this: the two garage sections are plain `SectionDef`s (plus the
 * one new `LimitBoxDef` concept the research called out, the per-row LOC
 * write-in), and the shared resolver / verifier / renderer pick them up.
 */

/** Garage Liability — Any Auto / Owned / Hired / Non-Owned Used In Garage Business. */
const GARAGE_LIABILITY_DEF: SectionDef = {
  key: "garageLiability",
  name: "Garage Liability",
  match: /garage liability/i,
  slots: [
    "gar_auto_only_each_accident",
    "gar_other_than_auto_each_accident",
    "gar_other_than_auto_aggregate",
  ],
  typeCell: [
    { kind: "title", text: "Garage Liability" },
    { kind: "checks", items: [{ key: "anyAuto", label: "Any Auto" }] },
    // 2016/03 wording — the 2010/12 blank said "All Owned Autos".
    { kind: "checks", items: [{ key: "ownedOnly", label: "Owned Autos Only" }] },
    { kind: "checks", items: [{ key: "hiredOnly", label: "Hired Autos Only" }] },
    {
      kind: "checks",
      items: [
        { key: "nonOwnedGarage", label: "Non-Owned Autos Used In Garage Business" },
      ],
    },
  ],
  limitBoxes: [
    {
      key: "autoOnlyEaAccident",
      label: "Auto Only (Ea accident)",
      slot: "gar_auto_only_each_accident",
    },
    {
      key: "otherThanEaAccident",
      label: "Other Than Auto Only - Ea Accident",
      slot: "gar_other_than_auto_each_accident",
    },
    {
      key: "otherThanAggregate",
      label: "Other Than Auto Only - Aggregate",
      slot: "gar_other_than_auto_aggregate",
    },
  ],
  exclusive: [
    ["anyAuto", "ownedOnly"],
    ["anyAuto", "hiredOnly"],
    ["anyAuto", "nonOwnedGarage"],
  ],
  // Garage AND auto parts: ACORD 30 has no separate Automobile Liability
  // section, so this row is where a garage policy's covered-auto symbols get
  // stated — including ones endorsed on as their own part, like a hired /
  // non-owned addition. Scoped to the garage part alone they vanish.
  evidence: /garage|\bautos?\b|automobile/i,
  resolveChecks: (ev) => {
    const withoutNonOwned = ev.text.replace(/non-?owned/gi, "");
    return {
      anyAuto: /any auto/i.test(ev.text),
      ownedOnly: /owned autos?/i.test(withoutNonOwned),
      hiredOnly: /hired/i.test(ev.text),
      nonOwnedGarage: /non-?owned/i.test(ev.text),
    };
  },
};

/**
 * Garage Keepers Liability — basis checkboxes (Legal Liability pays only on
 * negligence; Direct Basis pays regardless, qualified Primary or Excess) and
 * perils rows that each pair a checkbox with a LOC write-in and a $ box.
 */
const GARAGE_KEEPERS_DEF: SectionDef = {
  key: "garageKeepers",
  name: "Garage Keepers Liability",
  match: /garage ?keepers/i,
  slots: ["gk_comp_otc", "gk_specified_perils", "gk_collision"],
  typeCell: [
    { kind: "title", text: "Garage Keepers Liability" },
    { kind: "checks", items: [{ key: "legalLiability", label: "Legal Liability" }] },
    { kind: "checks", items: [{ key: "directBasis", label: "Direct Basis" }] },
    {
      kind: "checks",
      items: [
        { key: "primary", label: "Primary" },
        { key: "excess", label: "Excess" },
      ],
    },
  ],
  limitBoxes: [
    {
      key: "compOtc",
      label: "Comp / OTC",
      slot: "gk_comp_otc",
      check: { key: "compOtcPeril", label: "Comp / OTC" },
      withLoc: true,
    },
    {
      key: "specifiedPerils",
      label: "Specified Perils",
      slot: "gk_specified_perils",
      check: { key: "specifiedPerilsPeril", label: "Specified Perils" },
      withLoc: true,
    },
    {
      key: "collision",
      label: "Collision",
      slot: "gk_collision",
      check: { key: "collisionPeril", label: "Collision" },
      withLoc: true,
    },
    // The blank form carries an unlabeled spare LOC + $ row.
    { key: "gkSpare", label: "", slot: null, withLoc: true },
  ],
  exclusive: [
    // A garagekeepers is written on one basis, and Primary / Excess qualify
    // Direct Basis — neither pair can print together.
    ["legalLiability", "directBasis"],
    ["primary", "excess"],
  ],
  resolveChecks: (ev) => {
    const text = ev.text;
    return {
      // Basis is earned from the coverage part's own wording, never assumed.
      legalLiability: /legal liability/i.test(text),
      directBasis: /direct basis/i.test(text),
      primary: /direct basis/i.test(text) && /primary/i.test(text),
      excess: /direct basis/i.test(text) && /excess/i.test(text),
      // A perils box is checked exactly when the schedule states the row.
      compOtcPeril: ev.carries("gk_comp_otc"),
      specifiedPerilsPeril: ev.carries("gk_specified_perils"),
      collisionPeril: ev.carries("gk_collision"),
    };
  },
};

const GL_DEF = SECTION_DEFS.find((d) => d.key === "gl")!;
const UMBRELLA_DEF = SECTION_DEFS.find((d) => d.key === "umbrella")!;
const WC_DEF = SECTION_DEFS.find((d) => d.key === "wc")!;

/**
 * ACORD 30's GL type cell has no unlabeled write-in checkbox rows between
 * OCCUR and the aggregate-applies-per block (2010/12 blank; the 2016/03
 * specimens are consistent) — otherwise identical to the ACORD 25 GL.
 */
const ACORD30_GL_DEF: SectionDef = {
  ...GL_DEF,
  typeCell: GL_DEF.typeCell.filter(
    (line) =>
      !(line.kind === "checks" && line.items.every((i) => i.label === "")),
  ),
};

/**
 * ACORD 30 WC: same section, but overflow routes to REMARKS (the form has no
 * Description Of Operations box). `limitsHead` is inherited from ACORD 25 —
 * the research marked the ACORD 30 (2016/03) limits-head wording UNVERIFIED
 * (no retrieved specimen shows the cell legibly), so the ACORD 25 (2016/03)
 * "Per Statute / Oth-er" equivalent is used per instruction.
 */
const ACORD30_WC_DEF: SectionDef = {
  ...WC_DEF,
  typeCell: WC_DEF.typeCell.map((line) =>
    line.kind === "text"
      ? ({ kind: "text", text: "If yes, describe under Remarks below" } as const)
      : line,
  ),
};

export const ACORD30_SECTION_DEFS: SectionDef[] = [
  GARAGE_LIABILITY_DEF,
  GARAGE_KEEPERS_DEF,
  ACORD30_GL_DEF,
  UMBRELLA_DEF,
  ACORD30_WC_DEF,
];

/* ————————————————— Form descriptors — one per certificate type ————————————————— */

export type CertFormKey = "acord25" | "acord30";

export interface CertFormDef {
  key: CertFormKey;
  /** "ACORD 25" — footer + switcher label */
  formNumber: string;
  edition: string;
  /** Printed title, uppercase as on the blank */
  title: string;
  copyright: string;
  /** Head of the free-text box above the holder row */
  remarksHead: string;
  remarksNote: string;
  /** ACORD 30's coverages strip carries a PROD / CUSTOMER ID box */
  hasProdCustomerId: boolean;
  sections: SectionDef[];
}

export const CERT_FORMS: Record<CertFormKey, CertFormDef> = {
  acord25: {
    key: "acord25",
    formNumber: "ACORD 25",
    edition: "2025/12",
    title: "CERTIFICATE OF LIABILITY INSURANCE",
    copyright: "© 1988-2025 ACORD CORPORATION. All rights reserved.",
    remarksHead: "DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES",
    remarksNote:
      "(ACORD 101, Additional Remarks Schedule, may be attached if more space is required)",
    hasProdCustomerId: false,
    sections: SECTION_DEFS,
  },
  acord30: {
    key: "acord30",
    formNumber: "ACORD 30",
    edition: "2016/03",
    title: "CERTIFICATE OF GARAGE INSURANCE",
    copyright: "© 2010-2015 ACORD CORPORATION. All rights reserved.",
    // ACORD 30 calls this box REMARKS, not Description Of Operations.
    remarksHead: "REMARKS",
    remarksNote:
      "(Attach ACORD 101, Additional Remarks Schedule, if more space is required)",
    hasProdCustomerId: true,
    sections: ACORD30_SECTION_DEFS,
  },
};

/**
 * What a limit box resolves to off the schedule of record. Dec-page
 * semantics: a dollar amount, "Included" (covered within another limit),
 * or "Excluded" (the line is not covered). `null` = the box prints blank
 * (section has no backing policy, or the box has no data source at all).
 */
export type ResolvedLimit =
  | { kind: "amount"; cents: number }
  | { kind: "included" }
  | { kind: "excluded" };

/** A fixed section resolved against the selected policies. */
export interface ResolvedSection {
  def: SectionDef;
  feeder: CertSection | null;
  ref: SectionPolicyRef | null;
  /** Checkbox states earned from the schedule; missing key = unchecked */
  checks: Record<string, boolean>;
  /** Resolved value by limit-box key; null = the box prints blank */
  limits: Record<string, ResolvedLimit | null>;
  /** LOC write-in text by limit-box key, off the schedule (`PolicyLimit.loc`) */
  locs: Record<string, string>;
  /**
   * The schedule of record states at least one of this section's lines.
   * False means the policy landed on this row by its wording while the dec
   * says nothing about the coverage's limits — every box prints blank, and
   * none of them may print "Excluded".
   */
  backed: boolean;
  /** The feeder landed here via a desk placement rule, not the matcher */
  placedByRule?: boolean;
}

/** Desk placement overrides: policy id → the section key it belongs in. */
export type PlacementMap = Record<string, string>;

/** The additional row(s): Professional / Cyber / Liquor etc. when carried. */
export interface OtherRow {
  feeder: CertSection | null;
  ref: SectionPolicyRef | null;
  /** What the policy actually carries; "" on the blank placeholder row */
  label: string;
  lines: { slot: LimitSlot; label: string; value: ResolvedLimit }[];
}

/**
 * One coverage that didn't fit the printed form, carried as a compact
 * CSV-like line in Description Of Operations — the traditional broker
 * overflow practice. `Policy Number, Effective Date, Expiration Date,
 * Coverage, Each Occurrence, Aggregate`, with any stated line that fits
 * neither column appended as an extra detail. Deterministic from the
 * schedule of record: never invented, never reordered between runs.
 */
export interface OverflowLine {
  /** The resolved row backing this line — same data the grid would print */
  row: OtherRow;
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  coverage: string;
  /** "$1,000,000" | "Included" | "Excluded" | "—" (line not on the dec) */
  eachOccurrence: string;
  aggregate: string;
  /** Stated lines that fit neither column, e.g. a sublimit */
  extras: string[];
  /** The exact text printed in the description box */
  text: string;
}

export interface Acord25Sheet {
  sections: ResolvedSection[];
  /**
   * The printed additional row — the physical form carries exactly one
   * write-in block, so at most one backed row prints here (a single blank
   * row when nothing extra is carried).
   */
  others: OtherRow[];
  /** Coverages beyond the printed rows — Description Of Operations lines */
  overflow: OverflowLine[];
  /**
   * Placement rules that could not be honored, by policy id. A rule routes
   * a policy to a section; it cannot conjure coverage. One pointing at a
   * section the policy cannot feed is dropped rather than obeyed, and named
   * here so the desk learns its correction did not take.
   */
  unhonoredPlacements: string[];
}

function refFor(s: CertSection): SectionPolicyRef {
  return {
    insurerLetter: s.insurerLetter,
    policyNumber: s.policy.policyNumber,
    effectiveDate: s.policy.effectiveDate,
    expirationDate: s.policy.expirationDate,
    additionalInsured: s.draft.flags.additionalInsured,
    subrogationWaived: s.draft.flags.subrogationWaived,
  };
}

/** A carried limit line → its resolved dec-page value. */
function limitValue(l: PolicyLimit): ResolvedLimit {
  const mode = limitMode(l);
  if (mode === "amount") return { kind: "amount", cents: l.amountCents ?? 0 };
  return { kind: mode };
}

/**
 * Fill rule for a slot-backed box inside a section a policy feeds: the
 * schedule's stated value when the line is on the dec, otherwise "Excluded" —
 * a backed section never prints a blank limit box, exactly like a real
 * declarations page.
 */
function resolveBox(set: PolicyFormSet, slot: LimitSlot): ResolvedLimit {
  const l = set.limits.find((x) => x.slot === slot);
  return l ? limitValue(l) : { kind: "excluded" };
}

function carriesAny(set: PolicyFormSet, slots: LimitSlot[]): boolean {
  return set.limits.some((l) => slots.includes(l.slot));
}

/** ACORD box captions for the additional-row limit lines. */
const OTHER_LINE_LABELS: Partial<Record<LimitSlot, string>> = {
  prof_each_claim: "Each Claim",
  prof_aggregate: "Aggregate",
  cyber_aggregate: "Aggregate",
  liquor_each_common_cause: "Each Common Cause",
};

/** Coverage groups that claim the additional row, with their label lookup. */
const OTHER_GROUPS: { match: RegExp; fallback: string; slots: LimitSlot[] }[] = [
  {
    match: /professional|e&o|errors/i,
    fallback: "Professional Liability",
    slots: ["prof_each_claim", "prof_aggregate"],
  },
  { match: /cyber/i, fallback: "Cyber Liability", slots: ["cyber_aggregate"] },
  {
    match: /liquor/i,
    fallback: "Liquor Liability",
    slots: ["liquor_each_common_cause"],
  },
];

/**
 * The additional row(s): every carried limit that no fixed section consumed
 * lands here with a label from the coverage part — nothing drops silently.
 */
export function resolveOtherRows(
  sections: CertSection[],
  consumed: Map<string, Set<LimitSlot>>,
): OtherRow[] {
  const rows: OtherRow[] = [];
  for (const s of sections) {
    const done = consumed.get(s.policy.id) ?? new Set<LimitSlot>();
    const leftover = s.set.limits.filter((l) => !done.has(l.slot));
    const used = new Set<LimitSlot>();
    const claimedParts = new Set<string>();
    let placed = consumed.has(s.policy.id);

    for (const g of OTHER_GROUPS) {
      const lines = leftover.filter((l) => g.slots.includes(l.slot));
      if (lines.length === 0) continue;
      for (const l of lines) used.add(l.slot);
      const part = s.set.coverages.find((c) => g.match.test(c.label));
      if (part) claimedParts.add(part.label);
      rows.push({
        feeder: s,
        ref: refFor(s),
        label: part?.label ?? g.fallback,
        lines: lines.map((l) => ({
          slot: l.slot,
          label: OTHER_LINE_LABELS[l.slot] ?? LIMIT_SLOT_LABELS[l.slot],
          value: limitValue(l),
        })),
      });
      placed = true;
    }

    // Anything else unplaced (e.g. a second GL policy) still prints, labeled
    // by the coverage parts that didn't already claim their own row.
    const stray = leftover.filter((l) => !used.has(l.slot));
    if (stray.length > 0) {
      const strayLabel = s.set.coverages
        .filter((c) => !claimedParts.has(c.label))
        .map((c) => c.label)
        .join(" · ");
      rows.push({
        feeder: s,
        ref: refFor(s),
        label: strayLabel || coverageText(s.set) || s.policy.coverages.join(", "),
        lines: stray.map((l) => ({
          slot: l.slot,
          label: LIMIT_SLOT_LABELS[l.slot],
          value: limitValue(l),
        })),
      });
      placed = true;
    }

    // A selected policy with no limits and no fixed section still gets named.
    if (!placed) {
      rows.push({
        feeder: s,
        ref: refFor(s),
        label: coverageText(s.set) || s.policy.coverages.join(", "),
        lines: [],
      });
    }
  }
  if (rows.length === 0) rows.push({ feeder: null, ref: null, label: "", lines: [] });
  return rows;
}

/* ————————————————— Description Of Operations overflow ————————————————— */

/** Slots that answer the overflow line's Each Occurrence column. */
const OVERFLOW_EACH_SLOTS = new Set<LimitSlot>([
  "gl_each_occurrence",
  "auto_combined_single",
  "umb_each_occurrence",
  "wc_el_each_accident",
  "prof_each_claim",
  "liquor_each_common_cause",
  "gar_auto_only_each_accident",
]);

/** Slots that answer the overflow line's Aggregate column. */
const OVERFLOW_AGG_SLOTS = new Set<LimitSlot>([
  "gl_general_aggregate",
  "umb_aggregate",
  "prof_aggregate",
  "cyber_aggregate",
  "gar_other_than_auto_aggregate",
]);

/** ISO "YYYY-MM-DD" → "MM/DD/YYYY" for the overflow line. */
function overflowDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** Dec-page statement for an overflow value: "$1,000,000" / Included / Excluded. */
function overflowValue(v: ResolvedLimit): string {
  if (v.kind === "included") return "Included";
  if (v.kind === "excluded") return "Excluded";
  return (
    "$" + new Intl.NumberFormat("en-US").format(Math.round(v.cents / 100))
  );
}

/** A resolved row that didn't fit the printed form → its description line. */
function overflowLineFor(row: OtherRow): OverflowLine {
  const ref = row.ref!;
  let eachOccurrence = "—";
  let aggregate = "—";
  const extras: string[] = [];
  for (const line of row.lines) {
    if (eachOccurrence === "—" && OVERFLOW_EACH_SLOTS.has(line.slot)) {
      eachOccurrence = overflowValue(line.value);
    } else if (aggregate === "—" && OVERFLOW_AGG_SLOTS.has(line.slot)) {
      aggregate = overflowValue(line.value);
    } else {
      extras.push(`${line.label} ${overflowValue(line.value)}`);
    }
  }
  const text = [
    ref.policyNumber,
    overflowDate(ref.effectiveDate),
    overflowDate(ref.expirationDate),
    row.label,
    eachOccurrence,
    aggregate,
    ...extras,
  ].join(", ");
  return {
    row,
    policyNumber: ref.policyNumber,
    effectiveDate: ref.effectiveDate,
    expirationDate: ref.expirationDate,
    coverage: row.label,
    eachOccurrence,
    aggregate,
    extras,
    text,
  };
}

/**
 * The full description box: the packet's endorsement wording plus one
 * deterministic CSV line per coverage that didn't fit the printed form.
 */
export function certDescription(
  packet: { description: string },
  sheet: Acord25Sheet,
): string {
  if (sheet.overflow.length === 0) return packet.description;
  return [packet.description, ...sheet.overflow.map((l) => l.text)]
    .filter(Boolean)
    .join("\n");
}

/** Run every section descriptor over the same selected policies, independently. */
function resolveSections(
  defs: SectionDef[],
  sections: CertSection[],
  placements: PlacementMap = {},
): Acord25Sheet {
  const consumed = new Map<string, Set<LimitSlot>>();

  // A placement rule routes a policy to a section; it cannot conjure
  // coverage. The policy still has to be able to feed the section — carry
  // one of its lines, or name the coverage — because the ruled branch
  // bypasses the matcher entirely. Without this a rule pinned a cyber
  // policy to COMMERCIAL GENERAL LIABILITY, and the row printed that
  // policy's number and term under a coverage the insured does not have:
  // a general liability policy invented by a routing correction.
  //
  // An unhonorable rule is dropped rather than obeyed, so the matcher
  // places the policy where its own coverage belongs.
  const canFeed = (s: CertSection, def: SectionDef) =>
    carriesAny(s.set, def.slots) || def.match.test(coverageText(s.set));
  const effective: PlacementMap = {};
  const unhonoredPlacements: string[] = [];
  for (const [policyId, sectionKey] of Object.entries(placements)) {
    const s = sections.find((x) => x.policy.id === policyId);
    if (!s) continue;
    const def = defs.find((d) => d.key === sectionKey);
    if (def && canFeed(s, def)) effective[policyId] = sectionKey;
    else unhonoredPlacements.push(policyId);
  }

  const resolved: ResolvedSection[] = defs.map((def) => {
    // A desk placement rule pins its policy to exactly one section: the
    // ruled section claims it first, and the coverage matcher below skips
    // every ruled policy so a correction can't leave a duplicate behind.
    const ruled =
      sections.find((s) => effective[s.policy.id] === def.key) ?? null;
    const feeder =
      ruled ??
      sections.find(
        (s) => !effective[s.policy.id] && canFeed(s, def),
      ) ??
      null;
    if (feeder) {
      const set = consumed.get(feeder.policy.id) ?? new Set<LimitSlot>();
      for (const slot of def.slots) set.add(slot);
      consumed.set(feeder.policy.id, set);
    }
    // No schedule of record on file: the row identifies the policy and
    // claims nothing else — no checkbox, no limit statement (see header).
    const unscheduled = feeder?.set.unscheduled === true;
    // "Excluded" is a statement about a dec page: this coverage is on the
    // policy and this line is not granted. It is only sayable when the dec
    // states the coverage at all. A policy can reach a section on its
    // wording alone — the matcher reads coverage labels — and if the
    // schedule then states none of the section's lines, filling every box
    // with Excluded certifies that the policy excludes the whole coverage.
    // That is the opposite of what an unstated line means. Blank instead.
    const backed = feeder != null && carriesAny(feeder.set, def.slots);
    const locs: Record<string, string> = {};
    if (feeder && !unscheduled) {
      for (const b of def.limitBoxes) {
        if (!b.withLoc || !b.slot) continue;
        const loc = feeder.set.limits.find((l) => l.slot === b.slot)?.loc;
        if (loc) locs[b.key] = loc;
      }
    }
    return {
      def,
      feeder,
      ref: feeder ? refFor(feeder) : null,
      checks:
        feeder && !unscheduled
          ? applyExclusive(def, def.resolveChecks(evidenceFor(def, feeder.set)))
          : {},
      limits: Object.fromEntries(
        def.limitBoxes.map((b) => [
          b.key,
          feeder && !unscheduled && backed && b.slot
            ? resolveBox(feeder.set, b.slot)
            : null,
        ]),
      ),
      locs,
      backed,
      placedByRule: Boolean(ruled),
    };
  });

  // The printed form has exactly one additional write-in block. The first
  // leftover row prints there; every further row overflows into Description
  // Of Operations as a compact schedule-backed line (broker practice —
  // nothing drops, nothing stretches the form).
  const rows = resolveOtherRows(sections, consumed);
  return {
    sections: resolved,
    others: rows.slice(0, 1),
    overflow: rows.slice(1).map(overflowLineFor),
    unhonoredPlacements,
  };
}

export function resolveAcord25(
  sections: CertSection[],
  placements?: PlacementMap,
): Acord25Sheet {
  return resolveSections(SECTION_DEFS, sections, placements);
}

/** Same resolver, ACORD 30's registry — the descriptor layer is the only difference. */
export function resolveCertSheet(
  form: CertFormKey,
  sections: CertSection[],
  placements?: PlacementMap,
): Acord25Sheet {
  return resolveSections(CERT_FORMS[form].sections, sections, placements);
}
