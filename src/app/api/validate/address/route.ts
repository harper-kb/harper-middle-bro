import { NextResponse } from "next/server";
import { validateAddress } from "@/lib/validate-contact.server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { address?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address : "";
  if (!address.trim()) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }
  return NextResponse.json(await validateAddress(address));
}
