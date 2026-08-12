import { auth, currentUser } from "@clerk/nextjs/server";
import { ensureOperatorForClerkUser, getOperatorByClerkUserId } from "./db";
import { LOCAL_OPERATOR, localAuthEnabled } from "./local-auth";
import type { Operator } from "./types";

/**
 * Resolve the signed-in Clerk user to a desk operator (create/link on first use).
 * Replaces the old cookie seat-picker.
 */
export async function getSessionOperator(): Promise<Operator | null> {
  // Development-only bypass: seat everyone as one local operator so the desk
  // opens without a reachable Clerk instance. See lib/local-auth.
  if (localAuthEnabled()) {
    return (
      getOperatorByClerkUserId(LOCAL_OPERATOR.clerkUserId) ??
      ensureOperatorForClerkUser({ ...LOCAL_OPERATOR })
    );
  }

  let isAuthenticated = false;
  let userId: string | null = null;
  try {
    const session = await auth();
    isAuthenticated = Boolean(session.isAuthenticated);
    userId = session.userId;
  } catch {
    // Middleware / Clerk handshake unavailable — treat as signed out.
    return null;
  }
  if (!isAuthenticated || !userId) return null;

  // Hot path: already linked — no Clerk Backend API round-trip.
  const existing = getOperatorByClerkUserId(userId);
  if (existing) return existing;

  const user = await currentUser();
  if (!user) return null;

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    "";
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    email.split("@")[0] ||
    "Operator";

  return ensureOperatorForClerkUser({
    clerkUserId: userId,
    email,
    displayName,
  });
}
