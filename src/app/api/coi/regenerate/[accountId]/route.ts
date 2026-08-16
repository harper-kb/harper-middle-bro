import { NextRequest, NextResponse } from "next/server";
import { getSessionOperator } from "@/lib/session";
import {
  coverageExtractionForPolicy,
  loadCoiContext,
} from "@/lib/coi-engine/context-adapter";
import {
  buildCompletion,
  completionToFieldValuesFor,
  MissingFormTemplateError,
  runChecker,
} from "@/lib/coi-engine/coi-generate";
import {
  COI_FORMS,
  parseCoiFormType,
  type CoiFormType,
} from "@/lib/coi-engine/coi-forms";
import {
  ensureInsurerNaicOnFieldValues,
  resolveCarrierNaic,
} from "@/lib/coi-engine/coi-carrier-naic";
import { persistCoiGeneration } from "@/lib/coi-engine/coi-save";

// ── REGENERATE: rebuild from the schedule of record and persist a new row ────
// The generation is synchronous here (no Temporal): context → completion →
// checker → projection → one new generated_certificates row, status 'draft'.
// The response names the exact row so the client renders THAT generation
// (?certificate=<id>), never whatever row happens to be latest.

export const dynamic = "force-dynamic";

const ACCOUNT_ID_RE = /^[\w.-]{1,80}$/;

/** The form the coverage lines point at — ACORD 30 for garage paper. */
function recommendForm(coverageLines: string[]): CoiFormType {
  return coverageLines.some((line) => /garage/i.test(line)) ? "acord30" : "acord25";
}

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
    policyId?: unknown;
    ticketId?: unknown;
    form?: unknown;
    holderFallback?: unknown;
  };
  const policyId =
    typeof body.policyId === "string" && body.policyId.trim()
      ? body.policyId.trim().slice(0, 80)
      : null;
  const ticketId =
    typeof body.ticketId === "string" && body.ticketId.trim()
      ? body.ticketId.trim().slice(0, 80)
      : null;
  const holderFallback =
    typeof body.holderFallback === "string" && body.holderFallback.trim()
      ? body.holderFallback.trim().slice(0, 200)
      : null;
  const formParam = parseCoiFormType(body.form);
  if (formParam && !COI_FORMS[formParam].templateAvailable) {
    return NextResponse.json(
      {
        error: "missing_form_template",
        formType: formParam,
        detail: new MissingFormTemplateError(formParam).message,
      },
      { status: 409 },
    );
  }

  const context = loadCoiContext(id, { policyId, ticketId });
  if (!context) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }
  const coverageExtraction = coverageExtractionForPolicy(id, policyId);

  const completion = buildCompletion(context, {
    holderFallback,
    coverageExtraction,
  });
  if (completion.carrier.value) {
    completion.carrierNaic = await resolveCarrierNaic(completion.carrier.value);
  }
  const checker = runChecker(completion, context);
  const form = formParam ?? recommendForm(context.policy?.coverageLines ?? []);

  try {
    const projected = completionToFieldValuesFor(form, completion, {
      coverageExtraction,
    });
    const fieldValues = await ensureInsurerNaicOnFieldValues(projected);
    const saved = persistCoiGeneration({
      accountId: id,
      formType: form,
      fieldValues,
      generation: {
        source: "regenerate",
        operator: operator.email,
        policyId,
        ticketId,
        checker,
      },
    });
    return NextResponse.json({
      certificateId: saved.certificateId,
      formType: form,
      status: "draft",
      updatedAt: saved.updatedAt,
      checker,
    });
  } catch (e) {
    if (e instanceof MissingFormTemplateError) {
      return NextResponse.json(
        { error: "missing_form_template", formType: e.formType, detail: e.message },
        { status: 409 },
      );
    }
    throw e;
  }
}
