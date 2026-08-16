/**
 * Pure geometry for the in-place form editor — no pdf.js on the import graph,
 * so vitest exercises this under Node without touching DOM globals.
 *
 * PDF user-space has its origin at the BOTTOM-left with y growing UP the
 * page; CSS positions from the TOP-left with y growing down. The flip is
 * against the page's base height, then everything scales by the ratio of the
 * rendered CSS width to the page's base width.
 */

/** What control a widget is, read off the PDF's own AcroForm field type — a
 * checkbox must never render as a type box (the value the operator sees would
 * be the raw `/AS` token: `Off`, `Yes`, `choice1`). */
export type FieldKind = "text" | "checkbox" | "radio" | "choice";

export interface FieldWidgetRect {
  /** pdf.js's annotation id for THIS widget ("53R"), the key its
   * `annotationStorage` uses. Absent on older callers. The field name will not
   * do: every kid of a radio group shares one name but needs its own value. */
  id?: string | null;
  fieldName: string;
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The widget's CURRENT AcroForm value, when the annotation carries one —
   * lets the editor synthesize editable fields from the PDF alone. */
  value?: string | null;
  /** The control this widget is. Absent on older callers → treated as text. */
  kind?: FieldKind;
  /** checkbox/radio: the `/AS` state name that means ON for THIS widget (the
   * PDF's export value — `Yes`, `1`, `choice1`, …). A widget is ticked when its
   * value equals this, never when it equals the literal string "true". */
  exportValue?: string | null;
  /** choice widgets: the selectable options, in the PDF's own order. */
  options?: { value: string; label: string }[] | null;
  /** The field's own type size in PDF points (from its default appearance).
   * 0 or absent = auto-sized / unknown; the overlay falls back to a
   * box-height heuristic. Lets typed text match the printed text exactly. */
  fontSize?: number | null;
  /** The widget's box as a FRACTION of the rendered page (0..1 from the top
   * left), computed by pdf.js's own viewport transform.
   *
   * The x1/y1/x2/y2 above are raw PDF user space, and flipping them by hand
   * assumes the page is unrotated with its origin at (0,0). That holds for the
   * forms in this repo but not for every carrier PDF: a `/Rotate 90` page, or
   * one whose MediaBox/CropBox starts anywhere but the origin, lands every box
   * in the wrong place. `viewport.convertToViewportRectangle` handles both, so
   * the engine precomputes it and the overlay just scales. */
  box?: { left: number; top: number; width: number; height: number } | null;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Translate one widget rect into CSS px against a page rendered at
 * `cssWidth`. Returns null on degenerate input (a zero-size page). */
export function widgetRectToCss(
  rect: Pick<FieldWidgetRect, "x1" | "y1" | "x2" | "y2"> & {
    box?: FieldWidgetRect["box"];
  },
  pageSize: PdfPageSize,
  cssWidth: number,
): CssBox | null {
  if (!(pageSize.width > 0) || !(pageSize.height > 0) || !(cssWidth > 0)) {
    return null;
  }
  // Prefer the viewport-derived fractions: they already account for page
  // rotation and a non-origin view box, which the flip below cannot.
  if (rect.box) {
    const cssHeight = (cssWidth * pageSize.height) / pageSize.width;
    return {
      left: rect.box.left * cssWidth,
      top: rect.box.top * cssHeight,
      width: rect.box.width * cssWidth,
      height: rect.box.height * cssHeight,
    };
  }
  const scale = cssWidth / pageSize.width;
  return {
    left: rect.x1 * scale,
    top: (pageSize.height - rect.y2) * scale,
    width: (rect.x2 - rect.x1) * scale,
    height: (rect.y2 - rect.y1) * scale,
  };
}

/** Grow a box to a minimum clickable size AROUND ITS CENTRE, so the smallest
 * widgets on a form (ACORD checkboxes) stay hittable without the box drifting
 * off the mark it covers. Never shrinks. Floors stay modest for the reason the
 * artifact estate records: big floors visually spill into neighbouring cells on
 * dense grids. Replaces the old "drop anything under 8×6" rule, which lost a
 * field from the page AND from the off-page list. */
export function inflateCssBox(
  box: CssBox,
  minWidth: number,
  minHeight: number,
): CssBox {
  const width = Math.max(box.width, minWidth);
  const height = Math.max(box.height, minHeight);
  return {
    left: box.left - (width - box.width) / 2,
    top: box.top - (height - box.height) / 2,
    width,
    height,
  };
}
