import { auth, currentUser } from "@clerk/nextjs/server";
import { ensureOperatorForClerkUser, getOperatorByClerkUserId } from "./db";
import type { Operator } from "./types";

/**
 * Resolve the signed-in Clerk user to a desk operator (create/link on first use).
 * Replaces the old cookie seat-picker.
 */
export async function getSessionOperator(): Promise<Operator | null> {
  // Render the desk without Clerk keys. Guarded by NODE_ENV as well as the
  // flag: `next build` sets production, so this cannot engage on a deployed
  // instance even if the variable is set there by accident.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_NO_AUTH === "1") {
    const { listOperators } = await import("./db");
    return listOperators()[0] ?? null;
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
