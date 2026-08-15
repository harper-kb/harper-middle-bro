import { NextResponse } from "next/server";
import { agentToolsConfigured } from "@/lib/adapters/agent-tools/config";
import { listAccounts } from "@/lib/db";
import { bookSource } from "@/lib/supabase-book.server";

export const dynamic = "force-dynamic";

/**
 * Which book this instance is serving.
 *
 * Public, and deliberately boring: counts, a source name, and whether a
 * live sync is even possible. No account names, no policy numbers, nothing
 * off the book itself. Without this, telling a deployed desk on real data
 * from one on the fictional seed needs a session, which makes it awkward to
 * confirm a deploy actually took.
 */
export async function GET() {
  const accounts = listAccounts();
  const real = accounts.filter((a) => a.id.startsWith("acct-h-")).length;
  return NextResponse.json({
    source: bookSource(),
    accounts: accounts.length,
    real,
    seed: accounts.length - real,
    liveSyncAvailable: agentToolsConfigured(),
  });
}
