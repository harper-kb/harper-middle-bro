/**
 * pdf.js engine for the native in-place form editor — a port of the artifact
 * estate's canonical wrapper (harper-artifacts packages/sdk/src/pdf/engine.ts)
 * with the worker wiring translated from Vite (`?worker&inline`) to Next
 * (`new URL(..., import.meta.url)` asset resolution).
 *
 * This module must only ever be loaded via a dynamic import from browser
 * components — pdfjs touches DOM globals (DOMMatrix, Worker) at module load,
 * so it can never sit on a static import graph that vitest or react-dom/server
 * evaluates under Node. It is ~1MB, so the dynamic import also keeps it out of
 * the boot payload; it evaluates the first time a form page is rendered.
 */
import * as pdfjs from "pdfjs-dist";

/** Served from public/pdf/standard_fonts (copied from pdfjs-dist). Trailing
 * slash required — pdf.js appends the font file name to it. */
const STANDARD_FONT_DATA_URL = "/pdf/standard_fonts/";

let configured = false;
function ensureWorker(): void {
  if (configured) return;
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    // No resolvable worker asset (exotic bundler pass): pdf.js falls back to
    // its main-thread "fake worker" — slower, still correct for ≤10-page
    // ACORD forms.
  }
  configured = true;
}

export type PdfDocument = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;

/** Parse PDF bytes into a pdf.js document. Bytes are COPIED because pdf.js
 * transfers/detaches the buffer it is handed. */
export async function loadPdf(
  bytes: ArrayBuffer | Uint8Array,
): Promise<PdfDocument> {
  ensureWorker();
  const data =
    bytes instanceof Uint8Array
      ? bytes.slice(0)
      : new Uint8Array(bytes.slice(0));
  const task = pdfjs.getDocument({
    data,
    // pdfjs-dist ≥5 removed `isEvalSupported` from DocumentInitParameters;
    // eval-based paths are disabled by default there, which is the posture
    // the HTA source pinned explicitly.
    disableFontFace: false,
    // Base-14 font data, vendored from pdfjs-dist into public/. pdf.js needs it
    // to BUILD an appearance for a text field the operator has typed into (a
    // tick reuses the widget's existing stream and needs nothing). Without it
    // the worker warns "Ensure that the standardFontDataUrl API parameter is
    // provided" and a staged value can paint in the wrong metrics.
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
  return task.promise;
}

export interface RenderPageOptions {
  /** Hand the form widgets to an HTML annotation layer instead of painting
   * them (pdf.js `AnnotationMode.ENABLE_FORMS`).
   *
   * DEFAULT FALSE, and leave it that way unless you are also rendering a
   * pdf.js AnnotationLayer. The mode does the OPPOSITE of what its old
   * docstring here claimed: a widget annotation returns an EMPTY operator list
   * under it (pdfjs `WidgetAnnotation.getOperatorList`), so the canvas loses
   * every field's baked appearance — the box, the value, and the ACORD ✗ on a
   * ticked checkbox. Measured on GL_082.pdf: 15,036 paint ops at ENABLE vs
   * 12,648 at ENABLE_FORMS, and a filled field adds 20 ops at ENABLE and 0 at
   * ENABLE_FORMS. The dispatch link's viewer never passes this flag, which is
   * why forms look right there. */
  enableForms?: boolean;
  scaleClamp?: [min: number, max: number];
  dprCap?: number;
  signal?: AbortSignal;
}

/** Render one page onto a canvas fitted to `maxWidth` CSS px; returns the
 * rendered CSS size so the caller can size the overlay layer to match. */
export async function renderPage(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
  options: RenderPageOptions = {},
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(
    Math.min(Math.max(1, pageNumber), doc.numPages),
  );
  const base = page.getViewport({ scale: 1 });
  const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const dpr = options.dprCap ? Math.min(rawDpr, options.dprCap) : rawDpr;

  let scale = maxWidth / base.width;
  if (options.scaleClamp) {
    const [min, max] = options.scaleClamp;
    scale = Math.max(min, Math.min(max, scale));
  }
  const viewport = page.getViewport({ scale: scale * dpr });

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.ceil(viewport.height / dpr)}px`;

  const task = page.render({
    // pdfjs-dist ≥6 requires the canvas itself (RenderParameters.canvas);
    // the context still rides along for the paint target.
    canvas,
    canvasContext: ctx,
    viewport,
    // ENABLE_STORAGE, not ENABLE: identical output when the storage is empty
    // (measured — 954 ops either way on GL_082 p1), and when a value HAS been
    // staged pdf.js paints it through the field's own appearance machinery.
    // For a tick that means the widget's existing /AP /N /<onState> stream, so
    // the mark is the same size and in the same place as one the carrier
    // ticked. Drawing our own mark instead is what made a box check a
    // different size from its box.
    annotationMode: options.enableForms
      ? pdfjs.AnnotationMode.ENABLE_FORMS
      : pdfjs.AnnotationMode.ENABLE_STORAGE,
  });
  if (options.signal) {
    if (options.signal.aborted) task.cancel();
    else
      options.signal.addEventListener("abort", () => task.cancel(), {
        once: true,
      });
  }
  await task.promise;

  return { width: viewport.width / dpr, height: viewport.height / dpr };
}

/**
 * Stage one widget's value INTO THE DOCUMENT, so the next render paints it the
 * way the PDF would.
 *
 * `value` is deliberately typed by control:
 * - checkbox / radio → **boolean**. Never the on-state token: pdf.js treats the
 *   storage value as truthy/falsy for a tick, and `"Off"` is a non-empty
 *   string, so passing the PDF's own off-state token TICKS the box. Measured:
 *   `true` → +12 paint ops, `false` → +0, but `"Yes"` and `"Off"` → +12 each.
 * - text / choice → the string to show (`""` clears the field).
 *
 * Pass `null` to drop the entry entirely, which restores whatever the document
 * itself records — that is a take-back, not an edit to blank.
 */
export function setWidgetValue(
  doc: PdfDocument,
  annotationId: string,
  value: string | boolean | null,
): void {
  const storage = (doc as unknown as { annotationStorage?: AnnotationStorageLike })
    .annotationStorage;
  if (!storage) return;
  if (value === null) storage.remove(annotationId);
  else storage.setValue(annotationId, { value });
}

/** The slice of pdf.js's AnnotationStorage this module uses. */
interface AnnotationStorageLike {
  setValue(key: string, value: { value: string | boolean }): void;
  remove(key: string): void;
}

export type { FieldWidgetRect, PdfPageSize, FieldKind } from "./geometry";
import type { FieldKind, FieldWidgetRect, PdfPageSize } from "./geometry";

/** pdf.js annotation shape for one AcroForm widget — the fields we actually
 * read. `fieldType` is the PDF's own code: `Tx` text, `Btn` button
 * (checkbox/radio/pushbutton), `Ch` choice, `Sig` signature. */
interface WidgetAnnotationLike {
  /** pdf.js's own annotation id ("53R"). This — NOT the field name — is the
   * key `annotationStorage` uses, and a radio group's kids share a field name
   * while each has its own id. */
  id?: string;
  fieldName?: string;
  rect?: number[];
  fieldValue?: unknown;
  fieldType?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  /** A CHECKBOX's on-state name. */
  exportValue?: string;
  /** A RADIO kid's on-state name. pdf.js publishes it under a different key
   * than a checkbox's, and every kid of a group shares one `fieldName` while
   * carrying its OWN buttonValue — verified on the live GL_075: two widgets
   * both named `…Group2[0]`, one `buttonValue: "Choice1"`, the other
   * `"Choice2"`, with the group's `fieldValue` naming the chosen one. Reading
   * only `exportValue` left every radio with no on-state, so a ticked radio
   * read as unticked and its raw token ("Choice1") reached the operator. */
  buttonValue?: string;
  options?: unknown;
  /** The field's parsed default appearance — carries its own font size in
   * PDF points (0 = auto-size). */
  defaultAppearanceData?: { fontSize?: number };
}

/** The control a widget is. pdf.js already tells us — the editor used to throw
 * this away and render every widget as a text box. */
function widgetKind(a: WidgetAnnotationLike): FieldKind {
  if (a.checkBox) return "checkbox";
  if (a.radioButton) return "radio";
  if (a.fieldType === "Ch") return "choice";
  return "text";
}

/** Choice options as `{value,label}`. pdf.js hands back
 * `[{exportValue, displayValue}]`; either half may be missing. */
function widgetOptions(
  raw: unknown,
): { value: string; label: string }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: { value: string; label: string }[] = [];
  for (const entry of raw) {
    const o = entry as { exportValue?: unknown; displayValue?: unknown };
    const value =
      typeof o?.exportValue === "string"
        ? o.exportValue
        : typeof o?.displayValue === "string"
          ? o.displayValue
          : null;
    if (value === null) continue;
    const label =
      typeof o?.displayValue === "string" && o.displayValue ? o.displayValue : value;
    out.push({ value, label });
  }
  return out.length > 0 ? out : null;
}

/** Read every AcroForm widget's page + rect (and each page's base size) —
 * the geometry that positions an HTML input over its field box. One entry
 * per placement. */
export async function getFieldRects(
  doc: PdfDocument,
): Promise<{ rects: FieldWidgetRect[]; pageSizes: Map<number, PdfPageSize> }> {
  const rects: FieldWidgetRect[] = [];
  const pageSizes = new Map<number, PdfPageSize>();
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      pageSizes.set(p, { width: base.width, height: base.height });
      // pdf.js's own transform: rotation- and view-box-aware, unlike a hand
      // flip against the page height. pdfjs-dist ≥6 dropped
      // convertToViewportRectangle, so the rectangle is rebuilt from the two
      // corner conversions it was defined as.
      const toBox = (rect: number[]) => {
        const [vx1, vy1] = base.convertToViewportPoint(rect[0]!, rect[1]!) as [number, number];
        const [vx2, vy2] = base.convertToViewportPoint(rect[2]!, rect[3]!) as [number, number];
        const left = Math.min(vx1, vx2);
        const top = Math.min(vy1, vy2);
        return base.width > 0 && base.height > 0
          ? {
              left: left / base.width,
              top: top / base.height,
              width: Math.abs(vx2 - vx1) / base.width,
              height: Math.abs(vy2 - vy1) / base.height,
            }
          : null;
      };
      const annotations = await page.getAnnotations();
      for (const raw of annotations) {
        const a = raw as WidgetAnnotationLike;
        const { id, fieldName, rect, fieldValue } = a;
        if (!fieldName || !rect || rect.length < 4) continue;
        // A pushbutton ("Clear Form", "Print") is chrome, not an answer.
        if (a.pushButton) continue;
        const [ax1, ay1, ax2, ay2] = rect;
        const kind = widgetKind(a);
        rects.push({
          id: typeof id === "string" ? id : null,
          fieldName,
          page: p,
          x1: Math.min(ax1, ax2),
          y1: Math.min(ay1, ay2),
          x2: Math.max(ax1, ax2),
          y2: Math.max(ay1, ay2),
          value:
            typeof fieldValue === "string"
              ? fieldValue
              : fieldValue == null
                ? null
                : String(fieldValue),
          kind,
          // The ON-state name for THIS widget. Checkbox groups give each kid a
          // different one, so it can never be assumed to be "Yes".
          exportValue:
            kind === "checkbox" || kind === "radio"
              ? (a.exportValue ?? a.buttonValue ?? null)
              : null,
          options: kind === "choice" ? widgetOptions(a.options) : null,
          // The field's OWN type size (points): the overlay input types at
          // exactly the size the page prints, instead of guessing from the
          // box height (the "zoomed text" complaint, 2026-07-29).
          fontSize:
            typeof a.defaultAppearanceData?.fontSize === "number" && a.defaultAppearanceData.fontSize > 0
              ? a.defaultAppearanceData.fontSize
              : null,
          box: toBox(rect),
        });
      }
    } catch {
      /* a page that can't be read just contributes no rects */
    }
  }
  return { rects, pageSizes };
}
