// ── THE DESCRIPTION-BOX FIT LAW (Tanya's 7/9 re-test, finding #6) ─────────────
// "A lot of things in description of box that wouldn't fit. So maybe if we can
// change the font size for us to kind of make sure everything does fit."
//
// The ACORD 25 description-of-operations box is where additional-insured and
// contract language goes — content that silently truncates is a WRONG
// customer-facing document. The law this module enforces, pure and client-safe:
//   · the box AUTO-FITS — the font steps down from the template's print size
//     toward a legibility floor until the text fits;
//   · when the text still does not fit at the floor, the plan says so
//     EXPLICITLY (`fits: false`) — the renderer warns, and the pre-send gate
//     grows a flagged line (never a silent pass, never a silent cut).
//
// The PDF fill path (coi-pdf.ts) runs this plan with the REAL embedded
// Helvetica metrics; the default approximation here exists so tests and any
// metric-less caller get the same shape deterministically.

export const DESCRIPTION_FIELD_ID = "descriptionOfOperations";

// The box's AcroForm rect from acord25-schema.json
// (CertificateOfLiabilityInsurance_ACORDForm_RemarkText_A) — the schema's own
// rect is preferred at fill time; this is the client-safe default.
export const DESCRIPTION_BOX = { width: 568, height: 66 } as const;

// The template prints its neighborhood at ~7pt; below 5pt the box stops being
// readable on a printed certificate — that is the floor, not a target.
export const DESCRIPTION_FONT_MAX = 7;
export const DESCRIPTION_FONT_MIN = 5;
const FONT_STEP = 0.5;

// pdf-lib's multiline layout leading neighborhood (fontSize × factor per line).
const LINE_HEIGHT_FACTOR = 1.18;
// AcroForm widget inner padding, per side.
const CELL_PADDING = 2;

export interface DescriptionFitPlan {
  // The size the box should render at (the largest that fits, or the floor).
  fontSize: number;
  // False = even at the floor the text overflows — warn + flag, never cut quietly.
  fits: boolean;
  linesNeeded: number;
  linesAvailable: number;
}

export type WidthOfText = (text: string, fontSize: number) => number;

// Helvetica average-advance approximation (lowercase ≈ 0.50em, caps ≈ 0.72em,
// digits 0.556em). Deliberately slightly WIDE per char so the approximation
// errs toward warning, never toward silently blessing an overflow.
function approximateHelveticaWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[A-Z@#%&WM]/.test(ch)) w += 0.72;
    else if (/[0-9]/.test(ch)) w += 0.556;
    else if (ch === " " || ch === "." || ch === "," || ch === "'") w += 0.28;
    else w += 0.52;
  }
  return w * fontSize;
}

function wrappedLineCount(text: string, fontSize: number, usableWidth: number, widthOf: WidthOfText): number {
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1; // a deliberate blank line still occupies a row
      continue;
    }
    let current = "";
    lines += 1;
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (widthOf(candidate, fontSize) <= usableWidth) {
        current = candidate;
        continue;
      }
      // The word starts a new line; a word wider than the box consumes as
      // many rows as its own width demands (the viewer hard-breaks it).
      const wordWidth = widthOf(word, fontSize);
      const rows = Math.max(1, Math.ceil(wordWidth / usableWidth));
      lines += rows;
      current = rows > 1 ? "" : word;
    }
  }
  return lines;
}

export function descriptionFitPlan(
  text: string | null | undefined,
  opts?: {
    box?: { width: number; height: number };
    maxFontSize?: number;
    minFontSize?: number;
    widthOfText?: WidthOfText;
  },
): DescriptionFitPlan {
  const box = opts?.box ?? DESCRIPTION_BOX;
  const widthOf = opts?.widthOfText ?? approximateHelveticaWidth;
  const maxFont = opts?.maxFontSize ?? DESCRIPTION_FONT_MAX;
  const minFont = opts?.minFontSize ?? DESCRIPTION_FONT_MIN;
  const usableWidth = Math.max(1, box.width - CELL_PADDING * 2);
  const usableHeight = Math.max(1, box.height - CELL_PADDING * 2);

  const clean = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!clean) {
    return {
      fontSize: maxFont,
      fits: true,
      linesNeeded: 0,
      linesAvailable: Math.floor(usableHeight / (maxFont * LINE_HEIGHT_FACTOR)),
    };
  }

  let plan: DescriptionFitPlan | null = null;
  for (let size = maxFont; size >= minFont - 1e-9; size -= FONT_STEP) {
    const linesNeeded = wrappedLineCount(clean, size, usableWidth, widthOf);
    const linesAvailable = Math.max(1, Math.floor(usableHeight / (size * LINE_HEIGHT_FACTOR)));
    plan = { fontSize: size, fits: linesNeeded <= linesAvailable, linesNeeded, linesAvailable };
    if (plan.fits) return plan;
  }
  // The floor plan, honestly not fitting — the caller warns and the gate flags.
  return plan as DescriptionFitPlan;
}

// The one warning sentence, shared by the preview chip, the sheet, and the
// pre-send receipt — one vocabulary for one fact.
export function descriptionOverflowSentence(plan: DescriptionFitPlan): string {
  return `The description of operations does not fit its box even at the smallest font (${plan.fontSize}pt — needs ${plan.linesNeeded} lines, the box holds ${plan.linesAvailable}). Shorten it or move detail to an attached schedule; a cut-off description is a wrong certificate.`;
}
