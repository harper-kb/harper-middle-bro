import { NextRequest, NextResponse } from "next/server";
import { getSessionOperator } from "@/lib/session";
import { getDb } from "@/lib/db/connection";
import type {
  CoiDocumentFacts,
  CoiFactsResponse,
} from "@/lib/coi-engine/coi-facts";

// ── FACTS: readiness of the account's document corpus ────────────────────────
// HTA's facts route read harper-tools' extraction cache. This desk has no
// extraction pipeline; the honest local read is the schedule of record:
// a document that FED the policy schedule (policy_endorsements.
// source_document_id) is "analyzed" — its facts ARE the schedule rows — and
// every other document is honestly "needs_analysis", never claimed read.

export const dynamic = "force-dynamic";

const ACCOUNT_ID_RE = /^[\w.-]{1,80}$/;

interface DocRow {
  id: string;
  canonical_name: string;
  policy_id: string | null;
}

export async function GET(
  _req: NextRequest,
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

  const db = getDb();
  const docs = db
    .prepare(
      `SELECT id, canonical_name, policy_id FROM documents
       WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(id) as DocRow[];
  const scheduleSources = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT source_document_id AS docId FROM policy_endorsements
           WHERE source_document_id IS NOT NULL`,
        )
        .all() as { docId: string }[]
    ).map((r) => r.docId),
  );

  const documents: CoiDocumentFacts[] = docs.map((doc) => {
    const analyzed = scheduleSources.has(doc.id);
    let facts: Record<string, unknown> | null = null;
    if (analyzed && doc.policy_id) {
      const parts = db
        .prepare(
          `SELECT label FROM policy_coverage_parts WHERE policy_id = ? ORDER BY sort_order ASC`,
        )
        .all(doc.policy_id) as { label: string }[];
      facts = {
        coverage_lines: parts.map((p) => ({ line_label_as_printed: p.label })),
      };
    }
    return {
      artifactId: doc.id,
      filename: doc.canonical_name,
      contentHash: null,
      status: analyzed ? "analyzed" : "needs_analysis",
      promptVersion: null,
      facts,
    };
  });

  const response: CoiFactsResponse = {
    documents,
    analyzed: documents.filter((d) => d.status === "analyzed").length,
    needsAnalysis: documents.filter((d) => d.status === "needs_analysis").length,
    failed: documents.filter((d) => d.status === "error").length,
  };
  return NextResponse.json(response, {
    headers: { "cache-control": "no-store" },
  });
}
