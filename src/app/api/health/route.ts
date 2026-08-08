import fs from "fs";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/data-dir";

export const dynamic = "force-dynamic";

/**
 * Platform health check — public, so the host is not chasing a sign-in
 * redirect. Answers the only two questions that decide whether this machine
 * should stay in rotation: is the server up, and is the data volume mounted
 * and writable? A container that answers but cannot write is not healthy —
 * every desk action would fail — so an unwritable data directory is a 503.
 */
export function GET() {
  let writable = false;
  let detail: string | null = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    writable = true;
  } catch (err) {
    detail = err instanceof Error ? err.message : "unknown error";
  }

  return NextResponse.json(
    {
      ok: writable,
      dataDir: DATA_DIR,
      dataDirWritable: writable,
      detail,
      checkedAt: new Date().toISOString(),
    },
    { status: writable ? 200 : 503 },
  );
}
