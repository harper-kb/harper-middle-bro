import { auth, currentUser } from "@clerk/nextjs/server";
import { deskAllowlist, isEmailAllowed } from "./access";
import { ensureOperatorForClerkUser, getOperatorByClerkUserId } from "./db";
import type { Operator } from "./types";

/**
 * Session resolution with no dependency on `next/navigation`.
 *
 * Route handlers reach this module, and the check harnesses import those route
 * handlers directly under `--conditions react-server`. Pulling the client
 * router context into that graph breaks them at load time, so the redirecting
 * page flavour lives in session.ts instead and this half stays importable
 * from anywhere.
 *
 * A valid Clerk session is necessary but not sufficient: the account's email
 * must also be on the desk allowlist (src/lib/access.ts), so an account created
 * before the desk was locked down still cannot reach the book.
 *
 * "denied" is deliberately distinct from "anonymous": a signed-out visitor is
 * sent to sign in, while a signed-in stranger is told no. Collapsing the two
 * would bounce a denied account through a sign-in loop it can always complete.
 */
export type Resolution =
  | { state: "anonymous" }
  | { state: "denied" }
  | { state: "allowed"; operator: Operator };

export async function resolveOperator(): Promise<Resolution> {
  let isAuthenticated = false;
  let userId: string | null = null;
  try {
    const session = await auth();
    isAuthenticated = Boolean(session.isAuthenticated);
    userId = session.userId;
  } catch {
    // Middleware / Clerk handshake unavailable — treat as signed out.
    return { state: "anonymous" };
  }
  if (!isAuthenticated || !userId) return { state: "anonymous" };

  const allowlist = deskAllowlist();

  // Hot path: already linked — no Clerk Backend API round-trip. The stored
  // email is still checked, so removing a domain locks out linked operators.
  const existing = getOperatorByClerkUserId(userId);
  if (existing) {
    return isEmailAllowed(existing.email, allowlist)
      ? { state: "allowed", operator: existing }
      : { state: "denied" };
  }

  const user = await currentUser();
  if (!user) return { state: "anonymous" };

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    "";

  // Refuse before writing: an unlisted account must not get an operator row.
  if (!isEmailAllowed(email, allowlist)) return { state: "denied" };

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    email.split("@")[0] ||
    "Operator";

  return {
    state: "allowed",
    operator: ensureOperatorForClerkUser({ clerkUserId: userId, email, displayName }),
  };
}

/**
 * Route-handler flavour: never redirects, because an API caller wants a status
 * code rather than an HTML page. Null means "do not serve this request".
 */
export async function getApiOperator(): Promise<Operator | null> {
  const resolved = await resolveOperator();
  return resolved.state === "allowed" ? resolved.operator : null;
}
