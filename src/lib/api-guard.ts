import { NextResponse } from "next/server";
import { getApiOperator } from "./session-core";

/**
 * Access gate for route handlers that serve the book.
 *
 * The middleware already turns away anonymous callers, so what reaches here is
 * an authenticated session — which is not the same as an allowed one. An
 * account created before the desk was locked down still holds a valid session,
 * and these endpoints return accounts, threads, and alerts.
 *
 * Scope is deliberate. This guards the data routes (`/api/inbox`,
 * `/api/red-alerts`, `/api/desk-brain`). The stateless helpers under
 * `/api/validate/*` are left on the middleware's authentication requirement:
 * they expose no book data, and `scripts/insured-address-verify-check.ts`
 * imports one of those handlers directly to exercise it without a session.
 *
 * Returns a 403 to send back, or null to continue.
 *
 *   const denied = await guardApi();
 *   if (denied) return denied;
 */
export async function guardApi(): Promise<NextResponse | null> {
  const operator = await getApiOperator();
  if (operator) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
