import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  buildIdempotencyKey,
  dispatchAction,
  getCapabilityGate,
} from "@/lib/adapters/agent-tools";
import { getDb } from "@/lib/db";
import { refreshBook } from "@/lib/db/book-refresh";
import { getSessionOperator } from "@/lib/session";
import type { BookOrderRichData } from "@/lib/supabase-book.server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function validCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

export async function GET() {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }
  const gate = getCapabilityGate("write.bind");
  return NextResponse.json(
    {
      available: gate.state === "available",
      blocker:
        gate.state === "available"
          ? null
          : gate.blockerLabel ?? "Binding is not available from Step Bro.",
    },
    { headers: NO_STORE },
  );
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
        dealId?: unknown;
        policyNumber?: unknown;
        effectiveDate?: unknown;
        expirationDate?: unknown;
      }
    | null;
  const companyId = String(body?.companyId ?? "").trim();
  const orderId = Number(body?.orderId);
  const dealId = Number(body?.dealId);
  const policyNumber = String(body?.policyNumber ?? "").trim();
  const effectiveDate = String(body?.effectiveDate ?? "").trim();
  const expirationDate = String(body?.expirationDate ?? "").trim();

  if (
    !/^\d+$/.test(companyId) ||
    !Number.isSafeInteger(orderId) ||
    !Number.isSafeInteger(dealId) ||
    !policyNumber ||
    !validCalendarDay(effectiveDate) ||
    !validCalendarDay(expirationDate) ||
    expirationDate < effectiveDate
  ) {
    return NextResponse.json(
      { error: "Enter a valid policy number and policy term." },
      { status: 400, headers: NO_STORE },
    );
  }

  const row = getDb()
    .prepare(
      `SELECT account_id, bind_status, rich_json
       FROM book_orders
       WHERE harper_order_id = ?`,
    )
    .get(orderId) as
    | { account_id: string; bind_status: string; rich_json: string }
    | undefined;
  if (!row || row.account_id !== `co-${companyId}`) {
    return NextResponse.json(
      { error: "That order does not belong to this account." },
      { status: 403, headers: NO_STORE },
    );
  }
  const rich = JSON.parse(row.rich_json) as BookOrderRichData;
  const deal = rich.deals.find((candidate) => candidate.dealId === dealId);
  if (!deal || deal.isBound || row.bind_status === "lost") {
    return NextResponse.json(
      { error: "That policy is no longer eligible to bind." },
      { status: 409, headers: NO_STORE },
    );
  }

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        companyId,
        orderId,
        dealId,
        policyNumber,
        effectiveDate,
        expirationDate,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  const receipt = await dispatchAction({
    capabilityId: "write.bind",
    operatorId: operator.id,
    idempotencyKey: buildIdempotencyKey({
      operatorId: operator.id,
      capabilityId: "write.bind",
      workItemId: `order-${orderId}`,
      fingerprint,
    }),
    workItemId: `order-${orderId}`,
    accountId: `co-${companyId}`,
    confirmed: true,
    payload: {
      deal_id: dealId,
      policy_number: policyNumber,
      effective_date: effectiveDate,
      expiration_date: expirationDate,
      policy_documents: [],
      order_id: orderId,
      company_id: Number(companyId),
      actor: operator.email,
      source_skill: "step-bro/rich-order-card",
      confirm: true,
      mint_iq_coi_send: false,
    },
  });

  if (
    receipt.status !== "confirmed" &&
    receipt.status !== "idempotent_replay"
  ) {
    return NextResponse.json(
      {
        error: receipt.summary || "The bind was held; nothing changed.",
        receipt,
      },
      { status: 409, headers: NO_STORE },
    );
  }

  try {
    await refreshBook(getDb());
  } catch (error) {
    console.error(
      "[order-bind] bind applied but book refresh failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return NextResponse.json({ ok: true, receipt }, { headers: NO_STORE });
}
