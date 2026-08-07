import { NextResponse } from "next/server";
import { validateEmail } from "@/lib/validate-contact.server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  if (!email.trim()) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  return NextResponse.json(await validateEmail(email));
}
