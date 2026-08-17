import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  buildIdempotencyKey,
  dispatchAction,
  executeAgentToolsCommand,
} from "@/lib/adapters/agent-tools";
import { getDb } from "@/lib/db";
import {
  isRefreshConfigured,
  refreshCompanyServiceNotes,
} from "@/lib/db/book-refresh";
import {
  invalidateNoteThreads,
  localNoteThreadsReady,
} from "@/lib/note-threads.server";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_NOTE_CHARS = 2000;
const NO_STORE = { "Cache-Control": "no-store" };

function numeric(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function ownsOrder(companyId: string, orderId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM book_orders
       WHERE account_id = ? AND harper_order_id = ?`,
    )
    .get(`co-${companyId}`, Number(orderId));
  return Boolean(row);
}

export async function GET(request: Request) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }
  const url = new URL(request.url);
  const companyId = numeric(url.searchParams.get("companyId"));
  const orderId = numeric(url.searchParams.get("orderId"));
  if (!companyId || !orderId || !ownsOrder(companyId, orderId)) {
    return NextResponse.json(
      { error: "A valid account order is required." },
      { status: 400, headers: NO_STORE },
    );
  }

  // Local-first: the book refresh mirrors the full thread into SQLite, so
  // this is an indexed local read. The Agent Tools path below survives only
  // for the window before the first mirrored snapshot lands.
  const db = getDb();
  if (localNoteThreadsReady(db)) {
    const rows = db
      .prepare(
        `SELECT id, body, author, created_at
         FROM book_service_notes
         WHERE account_id = ? AND order_id = ?
         ORDER BY created_at DESC, CAST(id AS INTEGER) DESC
         LIMIT 50`,
      )
      .all(`co-${companyId}`, Number(orderId)) as {
      id: string;
      body: string;
      author: string;
      created_at: string;
    }[];
    const notes = rows.map((row) => ({
      id: String(row.id ?? ""),
      body: String(row.body ?? ""),
      createdAt: String(row.created_at ?? ""),
      author: String(row.author ?? "Unknown author"),
    }));
    return NextResponse.json({ notes }, { headers: NO_STORE });
  }

  const sql = `
    SELECT
      n.id::text AS id,
      n.body,
      n.created_at::text AS created_at,
      COALESCE(
        NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
        'Unknown author'
      ) AS author
    FROM public.service_note_entries n
    LEFT JOIN public.internal_agents a ON a.id = n.author_internal_agent_id
    WHERE n.company_id = ${companyId}
      AND n.order_id = ${orderId}
      AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC
    LIMIT 50`;
  try {
    const result = await executeAgentToolsCommand("ops sql run --limit 50", {
      sql,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Service notes are temporarily unavailable.", notes: [] },
        { status: 502, headers: NO_STORE },
      );
    }
    const nestedData =
      result.data.data && typeof result.data.data === "object"
        ? (result.data.data as Record<string, unknown>)
        : null;
    const candidate = Array.isArray(result.data.rows)
      ? result.data.rows
      : Array.isArray(result.data.data)
        ? result.data.data
        : Array.isArray(nestedData?.rows)
          ? nestedData.rows
          : [];
    const notes = candidate.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      return [
        {
          id: String(row.id ?? ""),
          body: String(row.body ?? ""),
          createdAt: String(row.created_at ?? ""),
          author: String(row.author ?? "Unknown author"),
        },
      ];
    });
    return NextResponse.json({ notes }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "Service notes are temporarily unavailable.", notes: [] },
      { status: 502, headers: NO_STORE },
    );
  }
}

export async function POST(request: Request) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }
  const payload = (await request.json().catch(() => null)) as
    | { companyId?: unknown; orderId?: unknown; body?: unknown }
    | null;
  const companyId = numeric(String(payload?.companyId ?? ""));
  const orderId = numeric(String(payload?.orderId ?? ""));
  const body = String(payload?.body ?? "").trim();
  if (
    !companyId ||
    !orderId ||
    !body ||
    body.length > MAX_NOTE_CHARS ||
    !ownsOrder(companyId, orderId)
  ) {
    return NextResponse.json(
      { error: `Enter a note up to ${MAX_NOTE_CHARS.toLocaleString()} characters.` },
      { status: 400, headers: NO_STORE },
    );
  }

  const fingerprint = createHash("sha256")
    .update(`${companyId}:${orderId}:${body}`)
    .digest("hex")
    .slice(0, 24);
  const receipt = await dispatchAction({
    capabilityId: "write.service_note",
    operatorId: operator.id,
    idempotencyKey: buildIdempotencyKey({
      operatorId: operator.id,
      capabilityId: "write.service_note",
      workItemId: `order-${orderId}`,
      fingerprint,
    }),
    workItemId: `order-${orderId}`,
    accountId: `co-${companyId}`,
    confirmed: true,
    payload: {
      company_id: Number(companyId),
      order_id: Number(orderId),
      body,
      operator_email: operator.email,
      actor_clerk_user_id: operator.clerkUserId,
      source_skill: "step-bro/rich-order-card",
      confirm: true,
    },
  });
  if (
    receipt.status !== "confirmed" &&
    receipt.status !== "idempotent_replay"
  ) {
    return NextResponse.json(
      { error: receipt.summary || "The note was held; nothing changed." },
      { status: 409, headers: NO_STORE },
    );
  }
  // Write-through: refetch this company's notes into the SQLite mirror before
  // responding, so the author's own note is on the very next read instead of
  // the next refresh tick. Failure is not an error — the note is safely
  // written upstream and the tick's digest sweep folds it in within minutes.
  if (isRefreshConfigured()) {
    try {
      await refreshCompanyServiceNotes(getDb(), Number(companyId));
    } catch (cause) {
      console.warn("service_note_write_through_failed", {
        companyId,
        errorCategory:
          cause instanceof Error ? cause.message : "note_refresh_unknown_error",
      });
    }
  }
  invalidateNoteThreads(Number(companyId));
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
