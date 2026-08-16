import { describe, it, expect } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { flattenPdfBytesForSend, summariseLockOutcomes } from "@/lib/coi-engine/pdf-flatten";
import {
  conservesVisibleText,
  countUndrawableXObjects,
  isDrawableXObject,
  pageResources,
  resourceXObjects,
  visibleTextOperands,
} from "@/lib/coi-engine/pdf-drawn-content";

// ── THE VENDOR-APPEARANCE PIN ─────────────────────────────────────────────────
//
// Why this file exists, and why the flatten pins beside it could never have
// caught the bug it covers: they build their fixtures with `PDFDocument.create()`
// + `form.createTextField()`, so every appearance stream is one pdf-lib wrote
// and already carries `/Subtype /Form`. Real carrier blanks do not. A widget
// appearance is allowed to omit `/Subtype` inside `/AP` — the viewer knows what
// it is from context — but the moment a flatten mounts that same stream on the
// PAGE it becomes an XObject, where `/Subtype` is required (PDF 32000-1 §8.8),
// and every conforming renderer skips one it cannot type.
//
// Measured on the two real workers-comp ACORD 130s that went out blank
// (2026-08-04 / 2026-08-05): 79 of 422 page XObjects undrawable, 61 of 71
// answers unrenderable in PDFium, pdf.js and MuPDF alike, all of them restored
// by adding the one key. So these fixtures are minted pdf-lib-clean and then
// STRIPPED back to the vendor shape — the only way a synthetic fixture can
// stand in for a Silverlake blank without shipping customer bytes.
//
// Synthetic values only (the synthetic-names law).
const SYNTHETIC_INSURED = "Quillstone Auto Group LLC";
const SYNTHETIC_FEIN = "999124401";

/** Strip `/Subtype` (and `/Type`) from every widget appearance stream, turning
 * a pdf-lib-authored form into the shape a form vendor ships. */
function stripAppearanceSubtypes(doc: PDFDocument): number {
  let stripped = 0;
  for (const field of doc.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const normal = widget.getAppearances()?.normal;
      const streams: PDFStream[] = [];
      if (normal instanceof PDFStream) streams.push(normal);
      else if (normal instanceof PDFDict) {
        for (const [, ref] of normal.entries()) {
          const state = doc.context.lookupMaybe(ref, PDFStream);
          if (state) streams.push(state);
        }
      }
      for (const stream of streams) {
        if (stream.dict.get(PDFName.of("Subtype"))) stripped += 1;
        stream.dict.delete(PDFName.of("Subtype"));
        stream.dict.delete(PDFName.of("Type"));
      }
    }
  }
  return stripped;
}

/** A one-page form carrying the three widget kinds an ACORD actually uses,
 * filled, with vendor-shaped (subtype-less) appearance streams. */
async function vendorShapedForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 260]);
  const form = doc.getForm();

  const insured = form.createTextField("applicant.name");
  insured.setText(SYNTHETIC_INSURED);
  insured.addToPage(page, { x: 20, y: 210, width: 260, height: 22 });

  const fein = form.createTextField("applicant.fein");
  fein.setText(SYNTHETIC_FEIN);
  fein.addToPage(page, { x: 20, y: 175, width: 160, height: 22 });

  const entity = form.createCheckBox("entity.llc");
  entity.addToPage(page, { x: 20, y: 140, width: 16, height: 16 });
  entity.check();

  const billing = form.createRadioGroup("billing.plan");
  billing.addOptionToPage("AGENCY", page, { x: 20, y: 105, width: 16, height: 16 });
  billing.addOptionToPage("DIRECT", page, { x: 60, y: 105, width: 16, height: 16 });
  billing.select("AGENCY");

  form.updateFieldAppearances();
  expect(stripAppearanceSubtypes(doc)).toBeGreaterThanOrEqual(4);
  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

function pageXObjectStreams(doc: PDFDocument): PDFStream[] {
  return doc.getPages().flatMap((page) => resourceXObjects(doc, pageResources(doc, page.node)));
}

describe("the outbound lock keeps a vendor-authored form readable", () => {
  it("flattens a vendor form without making a single mark undrawable", async () => {
    const bytes = await vendorShapedForm();
    const before = await load(bytes);
    // The form draws its answers today — as annotations, the way a viewer
    // paints an un-flattened AcroForm.
    expect(countUndrawableXObjects(before)).toBe(0);
    const drewBefore = visibleTextOperands(before);
    expect(drewBefore.size).toBeGreaterThan(0);

    const out = await flattenPdfBytesForSend(bytes);
    expect(out.flattened).toBe(true);
    expect(out.rewritten).toBe(true);
    expect(out.refused).toBeUndefined();
    // One stamp per vendor appearance stream the flatten was about to mount.
    expect(out.repaired).toBeGreaterThanOrEqual(4);

    const after = await load(out.bytes);
    // Locked: nothing interactive is left to offer.
    expect(after.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
    // THE GUARANTEE, structurally: every mark the page mounts can be drawn.
    // This is the half that covers the checkbox tick and the radio dot, which
    // show no text for an operand check to compare.
    expect(countUndrawableXObjects(after)).toBe(0);
    for (const stream of pageXObjectStreams(after)) {
      expect(isDrawableXObject(stream.dict)).toBe(true);
    }
    // THE GUARANTEE, textually: every operand the original drew is still drawn.
    expect(conservesVisibleText(drewBefore, visibleTextOperands(after))).toMatchObject({ ok: true, lost: 0 });
  });

  it("heals a document that arrived already flattened into undrawable XObjects", async () => {
    // The shape BigBrother's flatten and the forms renderer both produce, and
    // which HTA used to forward untouched because it has no AcroForm left to
    // notice: page-mounted appearance streams with no /Subtype.
    const source = await vendorShapedForm();
    const doc = await load(source);
    doc.getForm().flatten();
    doc.catalog.delete(PDFName.of("AcroForm"));
    const damaged = new Uint8Array(await doc.save({ updateFieldAppearances: false }));

    const arrived = await load(damaged);
    expect(arrived.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
    expect(countUndrawableXObjects(arrived)).toBeGreaterThan(0);

    const out = await flattenPdfBytesForSend(damaged);
    // Nothing to flatten — there is no form left — but the bytes still change,
    // because the marks were unreadable and now are not.
    expect(out.flattened).toBe(false);
    expect(out.rewritten).toBe(true);
    expect(out.repaired).toBeGreaterThan(0);
    expect(out.refused).toBeUndefined();

    const healed = await load(out.bytes);
    expect(countUndrawableXObjects(healed)).toBe(0);
    const operands = visibleTextOperands(healed);
    // The answers the recipient could not see are drawn again.
    expect(operands.size).toBeGreaterThan(0);
    expect(conservesVisibleText(visibleTextOperands(arrived), operands).ok).toBe(true);
  });

  it("never strips widgets off a form it cannot enumerate fields for", async () => {
    // An AcroForm shell with an empty /Fields array but a live widget on the
    // page — an already-flattened document, or a form pdf-lib cannot read
    // (XFA). The lock used to fall through such a document to the finishing
    // strokes: widgets removed, AcroForm deleted, nothing flattened, success
    // reported. That is a total wipe of everything the page showed.
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const form = doc.getForm();
    const field = form.createTextField("policy.number");
    field.setText(SYNTHETIC_INSURED);
    field.addToPage(page, { x: 20, y: 100, width: 240, height: 24 });
    form.updateFieldAppearances();
    const acro = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    acro.set(PDFName.of("Fields"), doc.context.obj([]));
    const shell = new Uint8Array(await doc.save({ updateFieldAppearances: false }));

    const before = await load(shell);
    const widgetsBefore = before.getPages()[0].node.Annots()?.size() ?? 0;
    expect(widgetsBefore).toBe(1);

    const out = await flattenPdfBytesForSend(shell);
    expect(out.flattened).toBe(false);
    expect(out.rewritten).toBe(false);
    expect(out.bytes).toBe(shell);

    const after = await load(out.bytes);
    expect(after.getPages()[0].node.Annots()?.size() ?? 0).toBe(widgetsBefore);
    expect(visibleTextOperands(after).size).toBeGreaterThan(0);
  });
});

describe("the conservation check", () => {
  it("passes an identical document and a document that gained content", () => {
    const before = new Set(["4162", "4344"]);
    expect(conservesVisibleText(before, new Set(before)).ok).toBe(true);
    expect(conservesVisibleText(before, new Set([...before, "99"])).ok).toBe(true);
  });

  it("fails, with a count, when the copy can no longer draw something", () => {
    const verdict = conservesVisibleText(new Set(["4162", "4344", "5150"]), new Set(["4162"]));
    expect(verdict).toMatchObject({ ok: false, lost: 2, before: 3 });
  });

  it("reads a real flatten's loss when the /Subtype is taken back off", async () => {
    // The exact production defect, reconstructed end to end: a correctly
    // locked document, then the one key removed from its mounted appearances.
    // The reader must see the loss the recipient would have seen.
    const locked = await flattenPdfBytesForSend(await vendorShapedForm());
    expect(locked.rewritten).toBe(true);
    const good = await load(locked.bytes);
    const drewGood = visibleTextOperands(good);

    const broken = await load(locked.bytes);
    for (const stream of pageXObjectStreams(broken)) {
      stream.dict.delete(PDFName.of("Subtype"));
      stream.dict.delete(PDFName.of("Type"));
    }
    const brokenDoc = await load(new Uint8Array(await broken.save({ updateFieldAppearances: false })));

    expect(countUndrawableXObjects(brokenDoc)).toBeGreaterThan(0);
    const verdict = conservesVisibleText(drewGood, visibleTextOperands(brokenDoc));
    expect(verdict.ok).toBe(false);
    expect(verdict.lost).toBeGreaterThan(0);
  });
});

describe("the lock's receipt", () => {
  it("counts what the lock did so a send can record it", async () => {
    const flattenedOut = await flattenPdfBytesForSend(await vendorShapedForm());
    const untouchedOut = await flattenPdfBytesForSend(new Uint8Array([1, 2, 3]));
    const receipt = summariseLockOutcomes([flattenedOut, untouchedOut, null]);
    expect(receipt.files).toBe(2);
    expect(receipt.rewritten).toBe(1);
    expect(receipt.repaired).toBeGreaterThanOrEqual(4);
    expect(receipt.refused).toBe(0);
  });
});

describe("the conservation reader stays browser-safe", () => {
  it("decodes content with TextDecoder, never Node Buffer", async () => {
    // Raised on review: Buffer.from(...).toString("latin1") throws in the
    // attachment preview when Buffer is missing, fail-opens the lock, and
    // leaves the fillable original on screen.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/lib/coi-engine/pdf-drawn-content.ts", import.meta.url), "utf8");
    const arm = src.slice(src.indexOf("export function drawnTextOperands"));
    expect(arm.slice(0, 500)).toMatch(/TextDecoder\("latin1"\)/);
    expect(arm.slice(0, 500)).not.toMatch(/Buffer\.from/);
  });
});
