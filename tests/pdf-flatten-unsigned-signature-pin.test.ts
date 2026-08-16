import zlib from "node:zlib";
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { flattenPdfBytesForSend } from "@/lib/coi-engine/pdf-flatten";

// ── THE SIGNATURE CARVE-OUT IS FOR SIGNATURES, NOT FOR /Sig FIELDS ────────────
// The outbound lock leaves a digitally SIGNED document untouched, because
// re-saving a byte-range-signed PDF invalidates the signature. An UNSIGNED
// signature placeholder (a /Sig field with no /V) breaks nothing when the
// document is rewritten, so it must not buy the rest of the form a free ride:
// a placeholder sitting beside live text and checkbox fields used to send the
// whole document as-is, and the recipient got an editable form — the exact
// incident this lock exists to prevent.
//
// Synthetic values only (the synthetic-names law).
const SYNTHETIC_INSURED = "Fabrico Test Welding LLC";

/** Append a signature field to a document's existing AcroForm at the object
 * layer (pdf-lib has no signature creator). `sign: true` gives it a signature
 * DICTIONARY in /V — the shape a completed DocuSign document carries. */
function addSignatureField(doc: PDFDocument, opts: { sign: boolean }): void {
  const page = doc.getPages()[0];
  const sigDict = doc.context.obj({
    FT: "Sig",
    T: PDFString.of("Signature1"),
    Type: "Annot",
    Subtype: "Widget",
    Rect: [10, 10, 120, 40],
    P: page.ref,
    F: 4,
  });
  if (opts.sign) {
    sigDict.set(
      PDFName.of("V"),
      doc.context.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        SubFilter: "adbe.pkcs7.detached",
        ByteRange: [PDFNumber.of(0), PDFNumber.of(1), PDFNumber.of(2), PDFNumber.of(3)],
        Contents: PDFHexString.of("00".repeat(16)),
      }),
    );
  }
  const sigRef = doc.context.register(sigDict);
  doc.getForm().acroForm.addField(sigRef);
  const annots = page.node.Annots();
  if (annots) annots.push(sigRef);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([sigRef]));
}

/** A one-page form carrying a live text field and a live checkbox, plus a
 * signature field of the requested kind. */
async function pdfWithEditableFieldsAndSignature(opts: { sign: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const text = form.createTextField("insuredName");
  text.setText(SYNTHETIC_INSURED);
  text.addToPage(page, { x: 10, y: 250, width: 250, height: 20 });
  const check = form.createCheckBox("additionalInsured");
  check.check();
  check.addToPage(page, { x: 10, y: 200, width: 14, height: 14 });
  addSignatureField(doc, opts);
  return new Uint8Array(await doc.save());
}

/** Does the value survive as drawn page content? pdf-lib shows text with
 * hex-encoded codes and Flate-compresses the streams it writes, so the probe
 * searches the raw bytes and every inflatable stream body. */
function pdfShowsText(bytes: Uint8Array, value: string): boolean {
  const hex = Buffer.from(value, "latin1").toString("hex").toLowerCase();
  const carries = (chunk: string) => chunk.includes(value) || chunk.toLowerCase().includes(hex);
  const buf = Buffer.from(bytes);
  if (carries(buf.toString("latin1"))) return true;
  const start = Buffer.from("stream");
  const end = Buffer.from("endstream");
  for (let cursor = 0; ; ) {
    const open = buf.indexOf(start, cursor);
    if (open < 0) return false;
    let bodyStart = open + start.length;
    if (buf[bodyStart] === 0x0d) bodyStart += 1;
    if (buf[bodyStart] === 0x0a) bodyStart += 1;
    const close = buf.indexOf(end, bodyStart);
    if (close < 0) return false;
    try {
      if (carries(zlib.inflateSync(buf.subarray(bodyStart, close)).toString("latin1"))) return true;
    } catch {
      // Not a Flate stream (or not one we can read) — skip it.
    }
    cursor = close + end.length;
  }
}

async function interactiveFieldCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  if (!doc.catalog.get(PDFName.of("AcroForm"))) return 0;
  return doc.getForm().getFields().length;
}

describe("an unsigned signature placeholder never buys the form a free ride", () => {
  it("flattens the editable fields beside an unsigned /Sig field", async () => {
    const bytes = await pdfWithEditableFieldsAndSignature({ sign: false });
    expect(await interactiveFieldCount(bytes)).toBe(3);

    const out = await flattenPdfBytesForSend(bytes);
    expect(out.flattened).toBe(true);
    expect(out.fieldCount).toBe(3);

    // Locked: no AcroForm, zero interactive fields, and the placeholder's own
    // widget annotation is gone too — nothing interactive is left to offer.
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
    expect(await interactiveFieldCount(out.bytes)).toBe(0);
    for (const page of doc.getPages()) {
      expect(page.node.Annots()?.size() ?? 0).toBe(0);
    }

    // The filled value still rides the document, so the lock kept it readable.
    expect(pdfShowsText(out.bytes, SYNTHETIC_INSURED)).toBe(true);
  });

  it("keeps sending a truly signed document (a /V signature dictionary) untouched", async () => {
    const bytes = await pdfWithEditableFieldsAndSignature({ sign: true });
    const out = await flattenPdfBytesForSend(bytes);
    expect(out.flattened).toBe(false);
    expect(out.bytes).toBe(bytes);
    expect(out.fieldCount).toBe(3);
    // The signature — and the fields it signs over — are still there.
    expect(await interactiveFieldCount(out.bytes)).toBe(3);
  });

  it("leaves a document whose only fields are signature placeholders alone", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.getForm(); // mint the AcroForm the placeholder attaches to
    addSignatureField(doc, { sign: false });
    const bytes = new Uint8Array(await doc.save());

    const out = await flattenPdfBytesForSend(bytes);
    expect(out.flattened).toBe(false);
    expect(out.bytes).toBe(bytes);
    expect(out.fieldCount).toBe(1);
  });
});
