// ── WHAT A CONFORMING VIEWER CAN ACTUALLY DRAW ────────────────────────────────
//
// The outbound PDF lock (pdf-flatten.ts) rewrites a document on its way to a
// recipient. This module answers the one question that makes such a rewrite
// safe to ship: does the new file still DRAW everything the old one drew?
//
// The receipt: on 2026-08-04 and 2026-08-05 two workers-comp ACORD 130s left
// HTA with every typed answer invisible — the applicant name, the mailing
// address, the FEIN an underwriter had explicitly asked for. The values were
// still inside the bytes. Nothing rendered them, in Chrome/Gmail (PDFium),
// Firefox (pdf.js) or MuPDF alike, because the flatten had mounted each
// widget's appearance stream on the page as an XObject WITHOUT the /Subtype a
// page XObject is required to carry (PDF 32000-1 §8.8). A viewer that cannot
// type an XObject skips it, so the form arrived pristine and blank.
//
// Reading a PDF the way a renderer does is a large job. This module does the
// small, exact part that catches that whole class: it collects the raw text
// operands of every DRAWABLE surface — page content, drawable form XObjects
// (recursively), and the appearance streams annotations paint with — and
// nothing else. An undrawable XObject contributes nothing here, which is
// precisely why the comparison catches one being created.
//
// WHY RAW OPERANDS AND NOT DECODED TEXT: a flatten re-mounts the SAME
// appearance stream bytes it was given, so a conserved value is byte-identical
// on both sides. Comparing raw operands therefore needs no font decoding, no
// encoding table, and no judgement — and because the same extractor runs over
// both documents, an imperfect extractor stays SOUND: it can only fail to
// notice a loss, never invent one. The check is a floor, not a renderer.
//
// Isomorphic on purpose (the attachment preview imports the lock in the
// browser): pdf-lib's own decoder, never node:zlib.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  type PDFForm,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";

/** How deep a form XObject may nest before we stop walking. Real documents
 * nest a couple of levels; the cap is a cycle/pathology guard, and a stream we
 * decline to walk simply contributes nothing to EITHER side of a comparison. */
const MAX_XOBJECT_DEPTH = 8;

// TOTAL RESOLUTION, NEVER THROWING. pdf-lib's `lookupMaybe(obj, Type)` returns
// undefined only for a MISSING object — a present object of the wrong type
// raises UnexpectedObjectTypeError. Every lookup here reads a shape a
// third-party PDF is free to get wrong (an /AP /N is a stream OR a dictionary,
// /Contents is a stream OR an array), so a typed lookup would turn a merely
// unusual document into a thrown send. These resolve or answer undefined.

/** Resolve to a stream, or undefined if it is anything else. */
export function asStream(doc: PDFDocument, obj: unknown): PDFStream | undefined {
  const resolved = doc.context.lookup(obj as never);
  return resolved instanceof PDFStream ? resolved : undefined;
}

/** Resolve to a dictionary, or undefined if it is anything else. A stream's
 * own dictionary is deliberately NOT returned here: a caller asking for a dict
 * wants a dict. */
export function asDict(doc: PDFDocument, obj: unknown): PDFDict | undefined {
  const resolved = doc.context.lookup(obj as never);
  return resolved instanceof PDFDict ? resolved : undefined;
}

/** Resolve to an array, or undefined if it is anything else. */
export function asArray(doc: PDFDocument, obj: unknown): PDFArray | undefined {
  const resolved = doc.context.lookup(obj as never);
  return resolved instanceof PDFArray ? resolved : undefined;
}

/** A page-mounted XObject only renders when it declares what it is. Anything
 * else is skipped by conforming viewers, so it draws nothing. */
export function isDrawableXObject(dict: PDFDict): boolean {
  const subtype = dict.get(PDFName.of("Subtype"))?.toString();
  return subtype === "/Form" || subtype === "/Image";
}

/** Make one stream drawable, when that can be said with certainty rather than
 * guessed. A stream carrying a `/BBox` is a form XObject — that entry is
 * required of one and meaningless on anything else. An image missing its own
 * subtype is left alone: inventing a colour space is a guess, and it is not
 * this defect's class. */
export function stampFormXObject(stream: PDFStream): boolean {
  if (isDrawableXObject(stream.dict)) return false;
  if (!stream.dict.get(PDFName.of("BBox"))) return false;
  stream.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  stream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  return true;
}

/** Stamp every widget appearance BEFORE a flatten mounts it on the page.
 *
 * This is the fix for the class itself. `form.flatten()` re-mounts each
 * widget's EXISTING appearance stream as a page XObject; inside `/AP` that
 * stream may legally omit `/Subtype`, on a page it may not, and pdf-lib never
 * adds it. Checkbox and radio appearances are a dictionary of per-state
 * streams, so each state is stamped — which one is live can change between here
 * and the page. Lives beside the drawability reader, not in the lock, so the
 * COI fill can call it without importing the send door (and without a cycle). */
export function stampWidgetAppearanceSubtypes(form: PDFForm): number {
  let stamped = 0;
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      let normal: unknown;
      try {
        normal = widget.getAppearances()?.normal;
      } catch {
        // A widget whose appearance dictionary cannot be read is left alone.
        continue;
      }
      if (normal instanceof PDFStream) {
        if (stampFormXObject(normal)) stamped += 1;
        continue;
      }
      if (normal instanceof PDFDict) {
        for (const [, ref] of normal.entries()) {
          const state = asStream(form.doc, ref);
          if (state && stampFormXObject(state)) stamped += 1;
        }
      }
    }
  }
  return stamped;
}

/** Decoded bytes of any stream, whatever filter it arrived under. Never
 * throws: an unreadable stream contributes nothing rather than failing a send. */
export function decodedStreamBytes(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(stream).decode();
    } catch {
      return stream.contents ?? new Uint8Array();
    }
  }
  try {
    return stream.getContents();
  } catch {
    return new Uint8Array();
  }
}

// Text-showing operators: `(literal) Tj`, `<hex> Tj`, and the `[ … ] TJ` array
// form, whose elements are the same two string shapes interleaved with kerning
// numbers. `'` and `"` (show-on-next-line) carry a literal operand too.
const SHOW_TEXT = /(\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|'|")|\[([\s\S]*?)\]\s*TJ/g;
const ARRAY_PIECE = /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g;

/** The raw text operands a content stream shows, normalised for comparison.
 * Whitespace-only and single-character operands are dropped: they are noise a
 * layout change can legitimately reshape, and keeping them would make the
 * conservation check fire on documents that lost nothing. */
export function drawnTextOperands(content: Uint8Array): string[] {
  // latin1 keeps every byte addressable as a character — PDF content streams
  // are byte soup, not UTF-8, and any decoding here would corrupt the operands.
  // TextDecoder, never Buffer: this module loads in the browser via the
  // attachment preview's lock path, and a missing Buffer would throw the
  // conservation baseline and fail-open the lock.
  const text = new TextDecoder("latin1").decode(content);
  const out: string[] = [];
  for (const match of text.matchAll(SHOW_TEXT)) {
    const single = match[1];
    const array = match[2];
    if (single) {
      const token = normaliseOperand(single);
      if (token) out.push(token);
      continue;
    }
    if (array) {
      for (const piece of array.match(ARRAY_PIECE) ?? []) {
        const token = normaliseOperand(piece);
        if (token) out.push(token);
      }
    }
  }
  return out;
}

function normaliseOperand(raw: string): string | null {
  const body = raw.startsWith("<")
    ? raw.slice(1, -1).replace(/\s+/g, "").toLowerCase()
    : raw.slice(1, -1);
  const trimmed = body.trim();
  // A one-character operand carries too little signal to be worth a refusal.
  return trimmed.length > 1 ? trimmed : null;
}

/** Every drawable text operand in a document: page content, the form XObjects
 * that content can draw, and the appearance streams its annotations paint. */
export function visibleTextOperands(doc: PDFDocument): Set<string> {
  const operands = new Set<string>();
  const seen = new Set<PDFStream>();

  for (const page of doc.getPages()) {
    for (const stream of pageContentStreams(doc, page.node)) {
      collect(doc, stream, operands, seen, 0);
    }
    // Resources may be inherited from an ancestor Pages node, which
    // page.node.Resources() already resolves for us.
    walkXObjects(doc, pageResources(doc, page.node), operands, seen, 0);
    for (const stream of annotationAppearanceStreams(doc, page.node)) {
      collect(doc, stream, operands, seen, 0);
    }
  }
  return operands;
}

function collect(
  doc: PDFDocument,
  stream: PDFStream,
  operands: Set<string>,
  seen: Set<PDFStream>,
  depth: number,
): void {
  if (seen.has(stream) || depth > MAX_XOBJECT_DEPTH) return;
  seen.add(stream);
  for (const token of drawnTextOperands(decodedStreamBytes(stream))) operands.add(token);
  // A form XObject draws its own XObjects; follow them at the same budget.
  walkXObjects(doc, asDict(doc, stream.dict.get(PDFName.of("Resources"))), operands, seen, depth + 1);
}

/** A page's resource dictionary, inheritance resolved, never throwing. */
export function pageResources(doc: PDFDocument, page: PDFDict): PDFDict | undefined {
  const own = asDict(doc, page.get(PDFName.of("Resources")));
  if (own) return own;
  // Inherited from an ancestor Pages node.
  let parent = asDict(doc, page.get(PDFName.of("Parent")));
  for (let depth = 0; parent && depth < MAX_XOBJECT_DEPTH; depth += 1) {
    const inherited = asDict(doc, parent.get(PDFName.of("Resources")));
    if (inherited) return inherited;
    parent = asDict(doc, parent.get(PDFName.of("Parent")));
  }
  return undefined;
}

/** The XObject entries a resource dictionary offers, never throwing. */
export function resourceXObjects(doc: PDFDocument, resources: PDFDict | undefined): PDFStream[] {
  if (!resources) return [];
  const xObjects = asDict(doc, resources.get(PDFName.of("XObject")));
  if (!xObjects) return [];
  const streams: PDFStream[] = [];
  for (const [, ref] of xObjects.entries()) {
    const stream = asStream(doc, ref);
    if (stream) streams.push(stream);
  }
  return streams;
}

function walkXObjects(
  doc: PDFDocument,
  resources: PDFDict | undefined,
  operands: Set<string>,
  seen: Set<PDFStream>,
  depth: number,
): void {
  if (!resources || depth > MAX_XOBJECT_DEPTH) return;
  for (const stream of resourceXObjects(doc, resources)) {
    // THE POINT OF THE WHOLE MODULE: an XObject the page cannot type is not
    // drawn, so it contributes nothing. That asymmetry is what makes creating
    // one show up as a loss.
    if (!isDrawableXObject(stream.dict)) continue;
    collect(doc, stream, operands, seen, depth + 1);
  }
}

/** Content streams of one page (`/Contents` is a stream OR an array of them). */
function pageContentStreams(doc: PDFDocument, page: PDFDict): PDFStream[] {
  const contents = page.get(PDFName.of("Contents"));
  const single = asStream(doc, contents);
  if (single) return [single];
  const array = asArray(doc, contents);
  if (!array) return [];
  const streams: PDFStream[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const stream = asStream(doc, array.get(i));
    if (stream) streams.push(stream);
  }
  return streams;
}

/** The normal appearance each annotation on the page actually paints. For a
 * checkbox/radio the appearance is a dictionary of states and `/AS` names the
 * live one; with no `/AS` the drawn state is ambiguous, so it is left out —
 * omitting from BOTH sides can only make the check more forgiving, never
 * produce a false refusal. */
function annotationAppearanceStreams(doc: PDFDocument, page: PDFDict): PDFStream[] {
  const annots = asArray(doc, page.get(PDFName.of("Annots")));
  if (!annots) return [];
  const streams: PDFStream[] = [];
  for (let i = 0; i < annots.size(); i += 1) {
    const annot = asDict(doc, annots.get(i));
    if (!annot) continue;
    const ap = asDict(doc, annot.get(PDFName.of("AP")));
    if (!ap) continue;
    const normal = ap.get(PDFName.of("N"));
    const direct = asStream(doc, normal);
    if (direct) {
      streams.push(direct);
      continue;
    }
    const states = asDict(doc, normal);
    if (!states) continue;
    const as = annot.get(PDFName.of("AS"))?.toString();
    if (!as || as === "/Off") continue;
    const state = asStream(doc, states.get(PDFName.of(as.slice(1))));
    if (state) streams.push(state);
  }
  return streams;
}

/** Page-mounted XObjects a conforming viewer will skip.
 *
 * THE TEXT CHECK CANNOT SEE EVERY MARK. A radio dot, a checkbox tick drawn as
 * vectors, a scanned signature — none of them show text, so an operand
 * comparison is blind to losing them. Counting the undrawable XObjects is the
 * structural half of the same question, and it covers exactly those marks:
 * whatever the appearance paints, if the page cannot type the XObject the
 * paint never lands. Compared as a COUNT before against after, so a document
 * that arrived with an XObject we cannot honestly type (no /BBox to prove it
 * is a form) does not get its lock refused for a defect it came with.
 *
 * EMPTY STREAMS DO NOT COUNT. A widget with an appearance that paints nothing
 * is not a mark, and flattening one produces an untypable page XObject through
 * no fault of the flatten — measured on a real ACORD 130, exactly one of 422
 * widgets is a zero-byte appearance with no /BBox. Counting it would refuse
 * the lock on a document that lost nothing, which trades a real guarantee for
 * a superstition. */
export function countUndrawableXObjects(doc: PDFDocument): number {
  const seen = new Set<PDFStream>();
  let undrawable = 0;

  const walk = (resources: PDFDict | undefined, depth: number): void => {
    if (!resources || depth > MAX_XOBJECT_DEPTH) return;
    for (const stream of resourceXObjects(doc, resources)) {
      if (seen.has(stream)) continue;
      seen.add(stream);
      if (!isDrawableXObject(stream.dict)) {
        if (decodedStreamBytes(stream).length > 0) undrawable += 1;
        continue;
      }
      walk(asDict(doc, stream.dict.get(PDFName.of("Resources"))), depth + 1);
    }
  };

  for (const page of doc.getPages()) walk(pageResources(doc, page.node), 0);
  return undrawable;
}

export interface ConservationVerdict {
  /** True = every operand the input drew is still drawn by the output. */
  ok: boolean;
  /** How many distinct operands the output can no longer draw. */
  lost: number;
  /** How many the input drew in total (the denominator for a receipt). */
  before: number;
}

/** Did the rewrite keep everything the original drew? Extra content is fine —
 * healing an undrawable XObject ADDS operands — but losing any is not. */
export function conservesVisibleText(before: Set<string>, after: Set<string>): ConservationVerdict {
  let lost = 0;
  for (const operand of before) if (!after.has(operand)) lost += 1;
  return { ok: lost === 0, lost, before: before.size };
}
