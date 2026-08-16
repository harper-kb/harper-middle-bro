// ── THE OUTBOUND PDF LOCK (DR's order, 2026-07-29) ────────────────────────────
//
// The receipt: on 2026-07-28 a certificate holder rejected a Harper COI
// because it arrived as a FILLABLE PDF ("they require an official,
// non-editable, locked PDF generated, not a fillable or editable form").
// Generated ACORD forms carry live AcroForm fields so the workbench reviewer
// can edit them in-app; those live fields must never ride an OUTBOUND send.
//
// THE LAW, IN CODE: every PDF attachment leaving through a byte-bearing
// outbound transport (the Gmail door in gmail.ts, the service-actions relay,
// the follow-ups relay's inline files) is FLATTENED at the transport: the
// form fields are drawn into static page content and the AcroForm is
// removed, so the recipient gets a locked, non-editable document that still
// shows every filled value.
//
// AND THE SECOND LAW, ADDED 2026-08-05 — TRUTH BEATS LOCK. The sentence above
// ("still shows every filled value") was false for a year of vendor-authored
// forms, and it was false silently. Two workers-comp ACORD 130s went out with
// every typed answer invisible — applicant name, mailing address, and the FEIN
// an underwriter had asked for by name — in an email that said the corrected
// form was attached. Root cause, measured: pdf-lib's `form.flatten()` mounts
// each widget's EXISTING appearance stream on the page as an XObject and never
// stamps it, and a page XObject without a `/Subtype` is skipped by every
// conforming renderer (PDF 32000-1 §8.8). Appearance streams pdf-lib itself
// wrote already carry the key, so our own generated certificates were fine and
// the tests — which build their fixtures with pdf-lib — could never see it.
// Streams a form VENDOR wrote do not, so on a Silverlake ACORD blank the
// FILLED fields are exactly the ones that vanish (pdf-lib regenerates the
// empty ones and leaves the answered ones alone). Measured on the real file:
// 79 of 422 page XObjects undrawable, 61 of 71 answers gone, 806 characters
// lost — and every one of them restored by adding the missing key.
//
// So this door now does three things instead of one:
//   1. REPAIR what arrives already broken. A file BigBrother or the forms
//      renderer flattened before we saw it carries the same undrawable
//      XObjects, and HTA was faithfully forwarding them. A page-mounted
//      stream with a /BBox and no /Subtype is a form XObject by construction;
//      stamping it can only make it render.
//   2. STAMP before flattening, so the class cannot be minted here again.
//   3. PROVE it, per send. The rewrite is compared against the input with
//      pdf-drawn-content.ts: every text operand the original DREW must still
//      be drawn by the copy. If it is not, the copy is thrown away and the
//      ORIGINAL bytes ride. That backstop is the actual guarantee — it holds
//      for the next bug in this transformation as well as this one — and it
//      is why the lock can no longer quietly ship less than it was handed.
//
// The cost of (3) is deliberate and named: a refusal means the recipient may
// get a document that is still fillable, the very thing the 2026-07-29 lock
// exists to prevent. A correct fillable form beats a locked blank one, so
// truth wins and the refusal is logged rather than hidden.
//
// Where this can NOT run (the documented exceptions):
//   · Submissions dispatch and the follow-ups/Jade attachment_ids lanes send
//     ARTIFACT IDS; Agora / the gateway resolve the bytes on THEIR side, so
//     the bytes never pass through this repo to flatten. Those lanes forward
//     stored bytes unchanged, so they cannot lose content — but they also
//     cannot be repaired here.
//   · The DocuSign envelope engine needs LIVE fields for signing, and
//     DocuSign itself flattens the completed/downloaded document.
//
// Failure posture: a PDF that cannot be parsed or flattened sends AS-IS with
// a loud server log. The fail-open branch exists for third-party documents,
// where blocking the whole send on one exotic PDF would be the worse failure.

import { PDFDict, PDFDocument, PDFName, PDFSignature, PDFStream } from "pdf-lib";
import { removeResidualWidgetAnnotations } from "./coi-pdf";
import {
  asDict,
  conservesVisibleText,
  countUndrawableXObjects,
  isDrawableXObject,
  pageResources,
  resourceXObjects,
  stampFormXObject,
  stampWidgetAppearanceSubtypes,
  visibleTextOperands,
} from "./pdf-drawn-content";

export interface FlattenOutcome {
  bytes: Uint8Array;
  /** True = the document carried interactive fields and they were flattened.
   * False = no fields were flattened (not a PDF, already static, signed, or
   * unflattenable — see the log). NOT the same question as "did the bytes
   * change": a repair-only pass rewrites without flattening. */
  flattened: boolean;
  /** Interactive AcroForm fields found before flattening (0 = already static). */
  fieldCount: number;
  /** True = `bytes` is a NEW buffer. False = the input bytes ride by reference. */
  rewritten: boolean;
  /** Appearance streams given the /Subtype a page XObject must carry — either
   * healed on arrival or stamped before this door flattened them. */
  repaired: number;
  /** Set when the conservation check refused the rewrite: the copy drew less
   * than the input, so the ORIGINAL bytes ride and nothing was locked. */
  refused?: "value_loss";
}

// "%PDF-" — the spec allows a small preamble before the header, so the sniff
// scans the first 1KB, the same tolerance real PDF readers apply.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function looksLikePdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  outer: for (let i = 0; i + PDF_MAGIC.length <= limit; i += 1) {
    for (let j = 0; j < PDF_MAGIC.length; j += 1) {
      if (bytes[i + j] !== PDF_MAGIC[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Heal a document that arrived carrying undrawable page XObjects — the shape
 * an upstream pdf-lib flatten (BigBrother's, the forms renderer's) leaves
 * behind. Walks nested form resources too, since a repaired XObject can mount
 * its own. */
function repairUndrawablePageXObjects(doc: PDFDocument): number {
  const seen = new Set<PDFStream>();
  let repaired = 0;

  const walk = (resources: PDFDict | undefined, depth: number): void => {
    if (!resources || depth > 8) return;
    for (const stream of resourceXObjects(doc, resources)) {
      if (seen.has(stream)) continue;
      seen.add(stream);
      if (stampFormXObject(stream)) repaired += 1;
      if (isDrawableXObject(stream.dict)) {
        walk(asDict(doc, stream.dict.get(PDFName.of("Resources"))), depth + 1);
      }
    }
  };

  for (const page of doc.getPages()) walk(pageResources(doc, page.node), 0);
  return repaired;
}

function untouched(bytes: Uint8Array, fieldCount: number, refused?: "value_loss"): FlattenOutcome {
  return { bytes, flattened: false, fieldCount, rewritten: false, repaired: 0, ...(refused ? { refused } : {}) };
}

export async function flattenPdfBytesForSend(bytes: Uint8Array): Promise<FlattenOutcome> {
  if (!looksLikePdf(bytes)) return untouched(bytes, 0);
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

    // The conservation baseline, taken BEFORE a single mutation: what this
    // document draws today is the floor the copy has to clear. Two halves,
    // because they see different things — the operands catch lost TEXT, the
    // count catches lost MARKS (a radio dot or a vector tick shows no text at
    // all, so an operand comparison is blind to it).
    const drewBefore = visibleTextOperands(doc);
    const undrawableBefore = countUndrawableXObjects(doc);

    let repaired = repairUndrawablePageXObjects(doc);
    let flattened = false;
    let fieldCount = 0;

    // No AcroForm = nothing interactive to lock. (Checked on the catalog
    // directly — doc.getForm() would CREATE an AcroForm on a document that
    // never had one.) A repair may still have work to do, so this is no
    // longer an early return.
    if (doc.catalog.get(PDFName.of("AcroForm"))) {
      const form = doc.getForm();
      const fields = form.getFields();
      fieldCount = fields.length;
      // A DIGITALLY SIGNED document never flattens (Greptile's P1 on this
      // change): re-saving a byte-range-signed PDF invalidates the signature,
      // so flattening a DocuSign-completed policy or any certified document
      // would destroy exactly the assurance it carries. A signed document is
      // already tamper-evident — editing its fields breaks the certification —
      // so it is the locked shape by construction and rides through untouched.
      //
      // SIGNED means an actual signature dictionary in /V. A /Sig field with no
      // value is only a PLACEHOLDER — nothing is signed, so nothing can break —
      // and treating the mere presence of one as "signed" handed the recipient
      // every live text and checkbox field beside it (Greptile's second P1).
      const signatures = fields.filter((f): f is PDFSignature => f instanceof PDFSignature);
      // A real signature dictionary carries /ByteRange (the signed span of the
      // file); requiring it keeps a bare or junk /V from reading as "signed".
      // HONEST LIMIT (the agentic security review's medium, accepted): this is
      // a STRUCTURAL check, not cryptographic validation — a deliberately
      // crafted fake signature dictionary can still ride through unflattened.
      // The adversary in that story is an authenticated Harper operator
      // attaching a PDF they crafted to stay editable, which was every
      // attachment's behavior before this lock existed; verifying signatures
      // cryptographically at the transport is out of scope for this hook.
      const signed = signatures.some((f) => {
        const v = f.acroField.V();
        return v instanceof PDFDict && v.has(PDFName.of("ByteRange"));
      });
      const lockableCount = fieldCount - signatures.length;
      if (signed) return untouched(bytes, fieldCount);
      // NOTHING LOCKABLE, SO NOTHING IS TOUCHED (2026-08-05). This used to
      // cover only the signature-placeholder case; it now covers every
      // document pdf-lib reads zero lockable fields from — an already-flattened
      // AcroForm shell, or a form whose fields pdf-lib cannot enumerate (XFA).
      // The old code fell THROUGH such a document to the finishing strokes
      // below, stripping every widget annotation and deleting the AcroForm
      // while flattening nothing: a demonstrated total wipe of visible content
      // that still reported success. There is nothing here to lock, so the
      // document leaves exactly as it came (a repair, if one was needed, still
      // ships — that only ever adds).
      if (lockableCount === 0) {
        if (repaired === 0) return untouched(bytes, fieldCount);
      } else {
        // A placeholder carries no normal appearance stream, and pdf-lib's
        // flatten throws on a widget without one — which would drop the WHOLE
        // send into the fail-open branch below. So the placeholders leave the
        // AcroForm by dict surgery first; their widget annotations go with the
        // residual sweep.
        for (const sig of signatures) form.acroForm.removeField(sig.acroField);
        // What flatten() does first, done explicitly so the stamping below
        // lands on the appearances that will actually be mounted: regenerate
        // ONLY where a field is dirty or has none (pdf-lib's
        // needsAppearancesUpdate walk), so the COI fill's own custom checkbox
        // X marks survive.
        form.updateFieldAppearances();
        repaired += stampWidgetAppearanceSubtypes(form);
        // Flatten WITHOUT a second appearance pass: the one above already ran,
        // and re-running it would replace streams this door just stamped.
        form.flatten({ updateFieldAppearances: false });
        // The same two finishing strokes the COI fill's own flatten applies
        // (coi-pdf.ts): residual widget annotations go, and the AcroForm dict
        // itself goes, so a viewer has nothing interactive left to offer.
        removeResidualWidgetAnnotations(doc);
        doc.catalog.delete(PDFName.of("AcroForm"));
        flattened = true;
      }
    }

    if (!flattened && repaired === 0) return untouched(bytes, fieldCount);

    const out = new Uint8Array(await doc.save({ updateFieldAppearances: false }));

    // THE PROOF. Re-read the copy and require it to draw everything the input
    // drew. A rewrite that cannot clear that floor is thrown away.
    const copy = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    const verdict = conservesVisibleText(drewBefore, visibleTextOperands(copy));
    const undrawableAfter = countUndrawableXObjects(copy);
    if (!verdict.ok || undrawableAfter > undrawableBefore) {
      console.error(
        `[pdf-flatten] REFUSED an outbound rewrite: it would have dropped ${verdict.lost} of ${verdict.before} drawn text operands and left ${undrawableAfter} undrawable XObject(s) against ${undrawableBefore} on the way in. Sending the original bytes instead (they may still be fillable).`,
      );
      return untouched(bytes, fieldCount, "value_loss");
    }
    if (repaired > 0) {
      console.warn(
        `[pdf-flatten] stamped ${repaired} appearance stream(s) that lacked the /Subtype a page XObject requires — without it a recipient's viewer draws nothing there.`,
      );
    }
    return { bytes: out, flattened, fieldCount, rewritten: true, repaired };
  } catch (e) {
    console.warn(
      `[pdf-flatten] could not flatten an outbound PDF — sending the original bytes (${(e as Error).message})`,
    );
    return untouched(bytes, 0);
  }
}

/** The base64 face of the same lock, for wire shapes that carry base64
 * payloads. Answers the locked payload AND the outcome, so a send path can
 * write a receipt for what the lock did to the bytes it shipped. */
export async function lockBase64PdfForSend(
  base64: string,
): Promise<{ base64: string; outcome: FlattenOutcome | null }> {
  const raw = (base64 ?? "").trim();
  if (!raw) return { base64, outcome: null };
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 0) return { base64, outcome: null };
  const outcome = await flattenPdfBytesForSend(new Uint8Array(decoded));
  return {
    base64: outcome.rewritten ? Buffer.from(outcome.bytes).toString("base64") : base64,
    outcome,
  };
}

/** Non-PDF content answers the input string unchanged. */
export async function flattenBase64PdfForSend(base64: string): Promise<string> {
  return (await lockBase64PdfForSend(base64)).base64;
}

export interface Base64AttachmentLike {
  base64: string;
}

/** Lock a transport's attachment list: PDFs flatten, everything else rides
 * through by reference (identity-preserving so callers and tests can tell
 * an untouched attachment from a rewritten one). */
export async function flattenAttachmentsForSend<T extends Base64AttachmentLike>(attachments: T[]): Promise<T[]> {
  return Promise.all(
    attachments.map(async (a) => {
      const locked = await flattenBase64PdfForSend(a.base64);
      return locked === a.base64 ? a : { ...a, base64: locked };
    }),
  );
}

/** What the lock did to one send's attachments — the receipt a send path
 * records so this guarantee is auditable rather than believed. */
export interface OutboundPdfLockReceipt {
  /** PDFs the lock inspected. */
  files: number;
  /** How many left as new bytes (flattened and/or repaired). */
  rewritten: number;
  /** Appearance streams stamped with the /Subtype a page XObject requires. */
  repaired: number;
  /** Rewrites thrown away because the copy drew less than the input. */
  refused: number;
}

export function summariseLockOutcomes(outcomes: Array<FlattenOutcome | null>): OutboundPdfLockReceipt {
  const seen = outcomes.filter((o): o is FlattenOutcome => o !== null);
  return {
    files: seen.length,
    rewritten: seen.filter((o) => o.rewritten).length,
    repaired: seen.reduce((n, o) => n + o.repaired, 0),
    refused: seen.filter((o) => o.refused).length,
  };
}
