import { NextRequest, NextResponse } from "next/server";
import { getSessionOperator } from "@/lib/session";
import {
  loadStoredCoiCertificateResource,
  loadStoredCoiCore,
} from "@/lib/coi-engine/coi-save";

// The review stage's read leg: the account's CURRENT stored certificate
// (id + CAS token + field values). The editor edits exactly the row the save
// door's staleness rail expects (/api/coi/save refuses any id that isn't the
// newest). ?certificateId= reads one EXACT row instead.

export const dynamic = "force-dynamic";

const ACCOUNT_ID_RE = /^[\w.-]{1,80}$/;

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

  const requested = req.nextUrl.searchParams.get("certificateId");
  if (requested) {
    if (!/^\d{1,12}$/.test(requested)) {
      return NextResponse.json({ error: "bad certificate id" }, { status: 400 });
    }
    const exact = loadStoredCoiCertificateResource(id, Number(requested));
    if (!exact) {
      return NextResponse.json({ error: "certificate not found" }, { status: 404 });
    }
    return NextResponse.json({
      certificateId: exact.certificateId,
      formType: exact.formType,
      status: exact.status,
      updatedAt: exact.updatedAt,
      fieldValues: exact.fieldValues,
      generation: exact.generation,
    });
  }

  const stored = loadStoredCoiCore(id);
  const cert = stored.generatedCert;
  if (!cert) {
    return NextResponse.json(
      { error: "no stored certificate on file" },
      { status: 404 },
    );
  }
  return NextResponse.json({
    certificateId: cert.certificateId,
    formType: cert.formType,
    status: cert.status,
    updatedAt: cert.updatedAt,
    fieldValues: cert.fieldValues,
    generation: cert.generation,
  });
}
