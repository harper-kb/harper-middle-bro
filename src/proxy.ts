import { clerkClient, clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAllowedOperatorEmail } from "@/lib/session/allowed-email";

// Plain path test — createRouteMatcher is deprecated in this Clerk release.
const PUBLIC_ROUTE = /^\/(?:sign-(?:in|up)(?:\/.*)?|access-denied)$/;
const isPublicRoute = (req: { nextUrl: { pathname: string } }) =>
  PUBLIC_ROUTE.test(req.nextUrl.pathname);

/**
 * The session token does not carry the email, so we resolve it through the
 * Clerk Backend API and cache the verdict briefly. A cold cache costs one API
 * call; a lost cache (new instance) is only a perf hit, never a security one.
 * Verdicts are cached both ways so a revoked account re-checks within the TTL.
 */
const VERDICT_TTL_MS = 5 * 60_000;
const verdictCache = new Map<string, { allowed: boolean; expiresAt: number }>();

async function isAllowedUser(userId: string): Promise<boolean> {
  const cached = verdictCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  let allowed = false;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    // Primary email only, and it must be verified — a user can attach an
    // unverified secondary address they don't own, so those never count.
    const primary = user.primaryEmailAddress;
    allowed =
      primary?.verification?.status === "verified" &&
      isAllowedOperatorEmail(primary.emailAddress);
  } catch {
    // Fail closed on Backend API errors; don't cache so we retry next request.
    return false;
  }

  verdictCache.set(userId, {
    allowed,
    expiresAt: Date.now() + VERDICT_TTL_MS,
  });
  return allowed;
}

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;

    const { isAuthenticated, userId, redirectToSignIn } = await auth();
    const isApi = req.nextUrl.pathname.startsWith("/api");

    if (!isAuthenticated || !userId) {
      // API routes get a 401; pages redirect to sign-in.
      if (isApi) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return redirectToSignIn();
    }

    // Signed in is not enough — only verified @harperinsure.com accounts may
    // see anything. Everyone else is stopped here, on every route.
    if (!(await isAllowedUser(userId))) {
      if (isApi) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/access-denied", req.url));
    }
  },
  // Clerk debug output includes authentication internals. Keep it opt-in so
  // normal development logs never expose session or credential material.
  { debug: process.env.CLERK_DEBUG === "true" },
);

export const config = {
  matcher: [
    // All routes except Next internals and static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/api/(.*)",
    "/__clerk/(.*)",
  ],
};
