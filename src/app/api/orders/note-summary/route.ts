import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadNoteThreads } from "@/lib/note-threads.server";
import { summarizeNoteThread } from "@/lib/note-summary.server";
import type { NoteThreadType } from "@/lib/note-thread-types";
import { visibleNoteParticipants } from "@/lib/note-attribution";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isVisibleBookOrder(companyId: number, orderId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM book_orders
       WHERE account_id = ? AND harper_order_id = ?`,
    )
    .get(`co-${companyId}`, orderId);
  return Boolean(row);
}

export async function POST(request: Request) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }
  const body = (await request.json().catch(() => null)) as
    | {
        companyId?: unknown;
        orderId?: unknown;
        threadType?: unknown;
      }
    | null;
  const companyId = positiveInteger(body?.companyId);
  const orderId = positiveInteger(body?.orderId);
  const threadType: NoteThreadType | null =
    body?.threadType === "producer" || body?.threadType === "service"
      ? body.threadType
      : null;
  if (
    !companyId ||
    !orderId ||
    !threadType ||
    !isVisibleBookOrder(companyId, orderId)
  ) {
    return NextResponse.json(
      { error: "A valid account order and thread type are required." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const threads = await loadNoteThreads({
      companyId,
      orderId,
      visibilityScope: `operator:${operator.id}`,
    });
    const thread = threads[threadType];
    const summary = await summarizeNoteThread({
      companyId,
      orderId,
      thread,
    });
    return NextResponse.json(
      {
        ...summary,
        participants: visibleNoteParticipants(thread.entries),
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        summary: null,
        generatedAt: null,
        threadVersion: "",
        cacheHit: false,
        error: "AI summary unavailable",
      },
      { status: 502, headers: NO_STORE },
    );
  }
}
