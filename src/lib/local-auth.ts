/**
 * Development-only escape from Clerk.
 *
 * The desk is unopenable whenever Clerk is unopenable: no keys is a 500, a key
 * for a reclaimed instance is an "Invalid host" JSON page, and bot protection on
 * a keyless instance can refuse the sign-up that would fix either. None of that
 * has anything to do with the work being done on the desk, so this mode drops
 * Clerk out of the request path entirely and runs as a single local operator.
 *
 * Enable in .env.local:
 *
 *   NEXT_PUBLIC_DESK_LOCAL_AUTH=1
 *
 * Read from both the server and the browser, hence NEXT_PUBLIC_. The flag alone
 * is never enough — every caller also requires a development build, so a
 * production build ignores it even if the variable is set. Guard both here so
 * there is one place to audit.
 */

export const LOCAL_AUTH_FLAG = "NEXT_PUBLIC_DESK_LOCAL_AUTH";

/** Stable identity so the operator row, signature and streaks persist across restarts. */
export const LOCAL_OPERATOR = {
  clerkUserId: "local-dev-operator",
  email: "operator@localhost",
  displayName: "Local Operator",
} as const;

export function localAuthEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const flag = process.env.NEXT_PUBLIC_DESK_LOCAL_AUTH;
  return flag === "1" || flag === "true";
}
