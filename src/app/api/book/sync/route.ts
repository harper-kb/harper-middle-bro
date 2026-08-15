import { NextResponse } from "next/server";
import { syncBookFromHarper } from "@/lib/adapters/harper/book-sync";
import { listAccounts } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { bookSource } from "@/lib/supabase-book.server";

export const dynamic = "force-dynamic";

/**
 * What book this instance is serving, and where it came from.
 *
 * Counts and a source name only — no account names, no policy numbers —
 * so it can answer "is the deployed desk on real data?" without a session
 * and without disclosing anything about the book itself.
 */
export async function GET() {
  const accounts = listAccounts();
  const real = accounts.filter((a) => a.id.startsWith("acct-h-")).length;
  return NextResponse.json({
    source: bookSource(),
    accounts: accounts.length,
    real,
    seed: accounts.length - real,
  });
}

/**
 * Refresh the book from Harper on a running instance.
 *
 *   curl -X POST https://<host>/api/book/sync
 *
 * Signed-in operators only. This replaces every account and policy the desk
 * is serving, so it is not something an unauthenticated caller gets to do,
 * and it is a POST because it writes.
 */
export async function POST(req: Request) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ ok: false, reason: "Not signed in" }, { status: 401 });
  }

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 400);
  const result = await syncBookFromHarper(
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, 2000) : 400,
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
