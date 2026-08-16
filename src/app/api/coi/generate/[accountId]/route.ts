import { NextRequest, NextResponse } from "next/server";
import { getSessionOperator } from "@/lib/session";
import { getAccountDetail } from "@/lib/db";
import {
  coverageExtractionForPolicy,
  loadCoiContext,
} from "@/lib/coi-engine/context-adapter";
import {
  buildCompletion,
  completionToFieldValuesFor,
  fillBlankCoiFieldValues,
  fillHarperCoiForm,
  fillHarperCoiFormWithReport,
  MissingFormTemplateError,
  runChecker,
  stripUnattestedEndorsementCheckboxes,
  type CheckResult,
  type Completion,
} from "@/lib/coi-engine/coi-generate";
import {
  COI_FORMS,
  defaultFormSelection,
  parseCoiFormType,
  type CoiFormType,
} from "@/lib/coi-engine/coi-forms";
import {
  cachedCoiPreview,
  pdfByteRange,
} from "@/lib/coi-engine/coi-preview-cache";
import { flattenPdfBytesForSend } from "@/lib/coi-engine/pdf-flatten";
import {
  ensureInsurerNaicOnFieldValues,
  resolveCarrierNaic,
} from "@/lib/coi-engine/coi-carrier-naic";
import {
  loadStoredCoiCertificateResource,
  loadStoredCoiCore,
} from "@/lib/coi-engine/coi-save";
import type { DescriptionFitPlan } from "@/lib/coi-engine/acord25-descfit";
import type { PolicyOption } from "@/lib/coi-engine/coi-context";

export const dynamic = "force-dynamic";

const ACCOUNT_ID_RE = /^[\w.-]{1,80}$/;

function pdfResponse(
  bytes: Uint8Array,
  id: string,
  form: CoiFormType,
  descriptionFit?: DescriptionFitPlan | null,
  rangeHeader?: string | null,
) {
  const range = pdfByteRange(bytes.byteLength, rangeHeader);
  const partial = range.kind === "partial";
  const body = partial ? bytes.subarray(range.start, range.end + 1) : bytes;
  const sharedHeaders = {
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="${COI_FORMS[form].label.replace(/\s+/g, "")}-${id}.pdf"`,
    "cache-control": "no-store",
    "accept-ranges": "bytes",
    ...(range.kind === "unsatisfiable"
      ? { "content-range": `bytes */${bytes.byteLength}` }
      : {}),
    ...(partial
      ? { "content-range": `bytes ${range.start}-${range.end}/${bytes.byteLength}` }
      : {}),
    // THE DESCRIPTION-FIT HEADERS: the fill's own fit plan rides the preview
    // response so the bench warns the moment an edit overflows.
    ...(descriptionFit
      ? {
          "x-acord-desc-fit": descriptionFit.fits ? "fits" : "overflow",
          "x-acord-desc-font": String(descriptionFit.fontSize),
        }
      : {}),
  };
  if (range.kind === "unsatisfiable") {
    return new NextResponse(null, { status: 416, headers: sharedHeaders });
  }
  return new NextResponse(Buffer.from(body), {
    status: partial ? 206 : 200,
    headers: { ...sharedHeaders, "content-length": String(body.byteLength) },
  });
}

// THE PDF FLATTEN LAW: every DOWNLOADED certificate passes through
// flattenPdfBytesForSend — the /Subtype appearance stamp + the drawn-content
// conservation proof — never a raw AcroForm handed to a customer.
async function downloadResponse(bytes: Uint8Array, id: string, form: CoiFormType) {
  const outcome = await flattenPdfBytesForSend(bytes);
  return new NextResponse(Buffer.from(outcome.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${COI_FORMS[form].label.replace(/\s+/g, "")}-${id}.pdf"`,
      "cache-control": "no-store",
      "x-pdf-flattened": String(outcome.flattened),
      "x-pdf-field-count": String(outcome.fieldCount),
      ...(outcome.refused ? { "x-pdf-flatten-refused": outcome.refused } : {}),
    },
  });
}

// The honest template-gap answer (never a silent ACORD 25 substitution).
function missingTemplateResponse(e: MissingFormTemplateError) {
  return NextResponse.json(
    { error: "missing_form_template", formType: e.formType, detail: e.message },
    { status: 409 },
  );
}

class StoredCertificateGoneError extends Error {}
class AccountGoneError extends Error {}

/** The form the coverage lines point at — ACORD 30 for garage paper. */
function recommendForm(coverageLines: string[]): CoiFormType {
  return coverageLines.some((line) => /garage/i.test(line)) ? "acord30" : "acord25";
}

interface CertificateState {
  form: CoiFormType;
  gapNote: string | null;
  fieldValues: Record<string, string>;
  completion: Completion;
  checker: CheckResult;
  /** Set when the values served came from a persisted row. */
  certificateId: number | null;
  version: string | null;
  status: string | null;
  servedFrom: "stored-exact" | "stored-latest" | "projection";
  policies: PolicyOption[];
  holder: { name: string | null; address: string | null; source: string | null };
}

async function buildCertificateState(
  accountId: string,
  q: {
    policyId: string | null;
    ticketId: string | null;
    formParam: CoiFormType | null;
    certificateParam: number | null;
    holderFallback: string | null;
  },
): Promise<CertificateState> {
  const context = loadCoiContext(accountId, {
    policyId: q.policyId,
    ticketId: q.ticketId,
  });
  if (!context) throw new AccountGoneError();
  const coverageExtraction = coverageExtractionForPolicy(accountId, q.policyId);

  const stored = loadStoredCoiCore(accountId);
  const storedResource = q.certificateParam
    ? loadStoredCoiCertificateResource(accountId, q.certificateParam)
    : null;
  if (
    q.certificateParam &&
    (!storedResource ||
      !Object.values(storedResource.fieldValues).some((v) => v.trim()))
  ) {
    throw new StoredCertificateGoneError();
  }

  const recommendation = defaultFormSelection(
    recommendForm(context.policy?.coverageLines ?? []),
  );

  const projectionOpts = { coverageExtraction };
  const completion = buildCompletion(context, {
    holderFallback: q.holderFallback,
    coverageExtraction,
  });
  // Always resolve against the completion carrier so a stale context NAIC
  // from a different name never sticks on the projected cert.
  if (completion.carrier.value) {
    completion.carrierNaic = await resolveCarrierNaic(completion.carrier.value);
  }
  const checker = runChecker(completion, context);

  // A receipt id outranks everything; otherwise the latest stored cert is the
  // default and an explicit policy/ticket/form pick outranks it.
  if (storedResource) {
    return {
      // Explicit ?certificate= is a historical view: the saved row renders
      // as it was stored — no live rewrite may touch it.
      form: q.formParam ?? storedResource.formType,
      gapNote: null,
      fieldValues: storedResource.fieldValues,
      completion,
      checker,
      certificateId: storedResource.certificateId,
      version: storedResource.updatedAt,
      status: storedResource.status,
      servedFrom: "stored-exact",
      policies: context.policies,
      holder: context.holder,
    };
  }

  const latest = stored.generatedCert;
  const latestHasValues = Boolean(
    latest && Object.values(latest.fieldValues).some((v) => v.trim()),
  );
  const useLatestStored =
    latestHasValues &&
    !q.policyId &&
    !q.ticketId &&
    (!q.formParam || q.formParam === latest!.formType);
  if (useLatestStored && latest) {
    // The latest-stored default IS a re-issue surface: the policy projection
    // fills blank cells and unattested AI/WOS stamps come off (fail-closed —
    // a stored Y without schedule attestation never survives re-issue).
    const withNaic = await ensureInsurerNaicOnFieldValues(latest.fieldValues);
    const policyFill = completionToFieldValuesFor(
      latest.formType,
      completion,
      projectionOpts,
    );
    const values = stripUnattestedEndorsementCheckboxes(
      fillBlankCoiFieldValues(withNaic, policyFill),
      coverageExtraction,
    );
    return {
      form: latest.formType,
      gapNote: null,
      fieldValues: values,
      completion,
      checker,
      certificateId: latest.certificateId,
      version: latest.updatedAt,
      status: latest.status,
      servedFrom: "stored-latest",
      policies: context.policies,
      holder: context.holder,
    };
  }

  const form = q.formParam ?? recommendation.selected;
  const projected = completionToFieldValuesFor(form, completion, projectionOpts);
  const withNaic = await ensureInsurerNaicOnFieldValues(projected);
  return {
    form,
    gapNote: q.formParam ? null : recommendation.gapNote,
    fieldValues: withNaic,
    completion,
    checker,
    certificateId: null,
    version: null,
    status: null,
    servedFrom: "projection",
    policies: context.policies,
    holder: context.holder,
  };
}

// LIVE PREVIEW / EDITED DOWNLOAD: render the cert from the reviewer's current
// field values (the single edit surface) on the SELECTED form.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { accountId } = await ctx.params;
  const id = decodeURIComponent(accountId);
  if (!ACCOUNT_ID_RE.test(id)) {
    return NextResponse.json({ error: "bad account id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    fieldValues?: Record<string, string>;
    form?: string;
    /** In-app live preview stays interactive; download flattens. */
    download?: boolean;
  };
  const form = parseCoiFormType(body.form) ?? "acord25";
  try {
    // Live preview posts the editor's field map — stamp NAIC here too so
    // edits never drop a verified-registry hit for a named Insurer A.
    const fieldValues = await ensureInsurerNaicOnFieldValues(
      body.fieldValues ?? {},
    );
    if (body.download === true) {
      const bytes = await fillHarperCoiForm(form, fieldValues, { flatten: false });
      return downloadResponse(bytes, id, form);
    }
    const { bytes, descriptionFit } = await fillHarperCoiFormWithReport(
      form,
      fieldValues,
      { flatten: false },
    );
    return pdfResponse(bytes, id, form, descriptionFit);
  } catch (e) {
    if (e instanceof MissingFormTemplateError) return missingTemplateResponse(e);
    throw e;
  }
}

// GET — three answers off one state build:
//   ?meta=1      → the review JSON: field values + the completion's per-field
//                  Source tags + the checker receipts (chip derivation is the
//                  client's, through coi-checker-receipt.ts only).
//   ?download=1  → the flattened certificate (flattenPdfBytesForSend — always).
//   default      → the editable preview PDF (flatten:false), byte-range aware.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { accountId } = await ctx.params;
  const id = decodeURIComponent(accountId);
  if (!ACCOUNT_ID_RE.test(id)) {
    return NextResponse.json({ error: "bad account id" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const policyId = (sp.get("policy") ?? "").trim().slice(0, 80) || null;
  const ticketId = (sp.get("ticket") ?? "").trim().slice(0, 80) || null;
  const holderFallback = sp.get("holder");
  const formParam = parseCoiFormType(sp.get("form"));
  const certificateParam = (() => {
    const raw = (sp.get("certificate") ?? "").trim();
    return /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  })();
  // An EXPLICIT pick of a template-less form answers the advertised 409 —
  // never a silent ACORD 25 render under an ACORD 28 request.
  if (formParam && !COI_FORMS[formParam].templateAvailable) {
    return missingTemplateResponse(new MissingFormTemplateError(formParam));
  }

  try {
    const query = { policyId, ticketId, formParam, certificateParam, holderFallback };

    if (sp.get("meta") === "1") {
      const state = await buildCertificateState(id, query);
      // The multi-policy panel needs the LOCAL policy ids to drive ?policy=;
      // PolicyOption (the ported shape) deliberately carries none.
      const account = getAccountDetail(id);
      const policyChoices = (account?.policies ?? []).map((p) => ({
        id: p.id,
        policyNumber: p.policyNumber,
        carrier: p.carrier,
        coverages: p.coverages,
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
      }));
      return NextResponse.json(
        {
          accountId: id,
          formType: state.form,
          gapNote: state.gapNote,
          certificateId: state.certificateId,
          version: state.version,
          status: state.status,
          servedFrom: state.servedFrom,
          fieldValues: state.fieldValues,
          completion: state.completion,
          checker: state.checker,
          policies: state.policies,
          policyChoices,
          holder: state.holder,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (sp.get("download") === "1") {
      const state = await buildCertificateState(id, query);
      const bytes = await fillHarperCoiForm(state.form, state.fieldValues, {
        flatten: false,
      });
      return downloadResponse(bytes, id, state.form);
    }

    // Chromium's PDF viewer commonly asks for the same URL more than once
    // (including byte ranges). Generate once per exact URL, then answer those
    // follow-up reads from the bounded memory-only cache.
    const cacheKey = `${id}?${sp.toString()}`;
    const preview = await cachedCoiPreview(cacheKey, async () => {
      const state = await buildCertificateState(id, query);
      const { bytes, descriptionFit } = await fillHarperCoiFormWithReport(
        state.form,
        state.fieldValues,
        { flatten: false },
      );
      return { bytes, form: state.form, descriptionFit };
    });
    return pdfResponse(
      preview.bytes,
      id,
      preview.form,
      preview.descriptionFit,
      req.headers.get("range"),
    );
  } catch (e) {
    if (e instanceof MissingFormTemplateError) return missingTemplateResponse(e);
    if (e instanceof StoredCertificateGoneError) {
      return NextResponse.json({ error: "certificate_not_found" }, { status: 404 });
    }
    if (e instanceof AccountGoneError) {
      return NextResponse.json({ error: "account_not_found" }, { status: 404 });
    }
    throw e;
  }
}
