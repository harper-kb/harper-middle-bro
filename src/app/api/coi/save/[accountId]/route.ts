import { NextRequest, NextResponse } from "next/server";
import { getSessionOperator } from "@/lib/session";
import {
  loadStoredCoiCore,
  persistCoiCorrection,
} from "@/lib/coi-engine/coi-save";

// ── SAVE: persist reviewer corrections to the STORED certificate ─────────────
// The write leg of the review flow: corrections land on the local
// generated_certificates row, CAS-guarded on updated_at (expectedVersion).

export const dynamic = "force-dynamic";

const ACCOUNT_ID_RE = /^[\w.-]{1,80}$/;
const MAX_FIELDS = 400;
const MAX_VALUE_LEN = 5_000;

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

  const body = (await req.json().catch(() => null)) as {
    certificateId?: unknown;
    expectedVersion?: unknown;
    fieldValues?: unknown;
  } | null;
  const certificateId = Number(body?.certificateId);
  if (!Number.isInteger(certificateId) || certificateId <= 0) {
    return NextResponse.json(
      { error: "certificateId must be a positive integer" },
      { status: 400 },
    );
  }
  const rawValues = body?.fieldValues;
  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
    return NextResponse.json(
      { error: "fieldValues must be an object" },
      { status: 400 },
    );
  }
  const entries = Object.entries(rawValues as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_FIELDS) {
    return NextResponse.json(
      { error: `fieldValues must carry 1–${MAX_FIELDS} fields` },
      { status: 400 },
    );
  }
  const fieldValues: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v !== "string" || v.length > MAX_VALUE_LEN) {
      return NextResponse.json(
        { error: `field '${k}' must be a string of at most ${MAX_VALUE_LEN} characters` },
        { status: 400 },
      );
    }
    fieldValues[k] = v;
  }
  const expectedVersion =
    typeof body?.expectedVersion === "string" && body.expectedVersion.trim()
      ? body.expectedVersion
      : null;

  // The staleness rail: the id posted must be the account's CURRENT newest
  // cert row (the one the bench renders). A mismatch means the UI is stale —
  // refuse before the write so the operator re-reads instead of overwriting
  // the newer certificate.
  const stored = loadStoredCoiCore(id);
  if (stored.generatedCert?.certificateId !== certificateId) {
    return NextResponse.json(
      {
        persisted: false,
        conflict: true,
        detail:
          "A newer certificate exists on this account than the one this card loaded. Reload and re-apply your corrections.",
      },
      { status: 409 },
    );
  }

  const result = persistCoiCorrection({ certificateId, fieldValues, expectedVersion });

  switch (result.kind) {
    case "saved":
      // Autosave can run more than once during one review. Return the NEW CAS
      // token after each successful write so the next batch compares against
      // this write, not the version from when the card first loaded.
      return NextResponse.json({
        persisted: true,
        detail: result.detail,
        certRecord: { id: certificateId, updatedAt: result.updatedAt },
      });
    case "no_change":
      return NextResponse.json({
        persisted: false,
        noChange: true,
        detail: result.detail,
      });
    case "conflict":
      return NextResponse.json(
        { persisted: false, conflict: true, detail: result.detail },
        { status: 409 },
      );
    case "not_found":
      return NextResponse.json(
        { persisted: false, detail: result.detail },
        { status: 404 },
      );
  }
}
