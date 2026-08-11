import { redirect } from "next/navigation";
import { resolveOperator } from "./session-core";
import type { Operator } from "./types";

export { getApiOperator } from "./session-core";

/**
 * Resolve the signed-in Clerk user to a desk operator (create/link on first use).
 * Replaces the old cookie seat-picker.
 *
 * Every desk page funnels through here, so this is where an off-allowlist
 * account is stopped. It leaves rather than returning null: null still renders
 * the page, and the book must not be readable by someone who is not on the desk.
 *
 * Route handlers must use `getApiOperator` from session-core instead — this
 * module reaches `next/navigation`, which route handlers cannot load.
 */
export async function getSessionOperator(): Promise<Operator | null> {
  const resolved = await resolveOperator();
  if (resolved.state === "denied") redirect("/access-denied");
  return resolved.state === "allowed" ? resolved.operator : null;
}
