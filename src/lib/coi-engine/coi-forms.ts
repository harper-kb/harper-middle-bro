// ── The certificate form catalog (the ACORD form-type seam) ──────────────────
//
// The certificates bench used to render exactly one form: the vendored ACORD 25
// template, hardcoded at every seam (the fill, the preview route, the editor,
// the edit log's formType). That produced the garage-liability misfire Pratik
// flagged 2026-07-14: a garage policy's certificate rendered as a Certificate
// of LIABILITY Insurance when the line needs the ACORD 30 garage certificate
// (the service runbook's own rule: ACORD 25 for GL/WC/commercial auto,
// ACORD 30 for garage, evidence-of-property forms for property).
//
// This module is the ONE catalog of certificate forms the bench can name:
// which forms exist, which ones Harper actually holds a fillable template for,
// and the honest label for each. Which form a POLICY should get is judgment
// and lives in the certificate-form-selection playbook (src/playbooks/) — this
// file is deliberately just the catalog + the validation seam, importable from
// client and server alike (no template bytes here; the heavy base64 modules
// stay server-only inside coi-generate.ts).

export type CoiFormType = "acord25" | "acord30" | "acord28";

export interface CoiFormDef {
  id: CoiFormType;
  // The short picker label ("ACORD 25").
  label: string;
  // What the form IS, for titles/tooltips.
  title: string;
  // Whether Harper holds a committed fillable AcroForm template + field
  // schema for this form. False = the pick is honest about the gap (the UI
  // says "no template on file" instead of silently rendering an ACORD 25 —
  // the do-not-fake law applied to form types).
  templateAvailable: boolean;
}

export const COI_FORMS: Record<CoiFormType, CoiFormDef> = {
  acord25: {
    id: "acord25",
    label: "ACORD 25",
    title: "Certificate of Liability Insurance (GL / auto / umbrella / workers comp)",
    templateAvailable: true,
  },
  acord30: {
    id: "acord30",
    label: "ACORD 30",
    title: "Certificate of Garage Insurance (garage liability / garagekeepers)",
    templateAvailable: true,
  },
  acord28: {
    id: "acord28",
    label: "ACORD 28",
    title: "Evidence of Commercial Property Insurance",
    // No ACORD 28 AcroForm template exists in Harper's estate yet (BigBrother
    // carries only acord25/acord30 under public/forms). The picker shows the
    // option with the honest gap instead of hiding the form's existence.
    // Acquisition/wiring contract: docs/coi-generation/ACORD-28-TEMPLATE-ACQUISITION.md.
    templateAvailable: false,
  },
};

export const COI_FORM_ORDER: CoiFormType[] = ["acord25", "acord30", "acord28"];

// Validation seam for anything arriving over the wire (query params, POST
// bodies). Unknown/absent reads null — the caller falls back to its standing
// default, never a guessed form. Checked against the explicit ORDER list, not
// `in` (the security review's catch: `in` also answers true for inherited
// prototype keys like "constructor").
export function parseCoiFormType(v: unknown): CoiFormType | null {
  return typeof v === "string" && (COI_FORM_ORDER as string[]).includes(v) ? (v as CoiFormType) : null;
}

// The default the bench opens on, given the playbook's recommendation: the
// recommended form when Harper can actually render it; otherwise ACORD 25
// WITH the gap named (the caller surfaces `gapNote` beside the picker — the
// fallback is visible, never silent).
export function defaultFormSelection(recommended: CoiFormType): {
  selected: CoiFormType;
  gapNote: string | null;
} {
  const def = COI_FORMS[recommended];
  if (def.templateAvailable) return { selected: recommended, gapNote: null };
  return {
    selected: "acord25",
    gapNote: `The policy's coverage lines point at ${def.label} (${def.title}), but no fillable ${def.label} template is on file, so the preview below renders the ACORD 25 instead. Confirm the form choice before sending.`,
  };
}
