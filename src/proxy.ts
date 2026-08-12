import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { localAuthEnabled } from "@/lib/local-auth";

// Plain path test — createRouteMatcher is deprecated in this Clerk release.
// /clerk-reset has to be reachable while auth is broken; that is its whole job.
const PUBLIC_ROUTE = /^(?:\/sign-(?:in|up)(?:\/.*)?|\/clerk-reset)$/;
const isPublicRoute = (req: { nextUrl: { pathname: string } }) =>
  PUBLIC_ROUTE.test(req.nextUrl.pathname);

const clerkProxy = clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;

    const { isAuthenticated, redirectToSignIn } = await auth();
    if (isAuthenticated) return;

    // API routes get a 401; pages redirect to sign-in.
    if (req.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return redirectToSignIn();
  },
  {
    // Point at the sign-in/up pages this app hosts itself. Without these, a
    // signed-out redirect falls back to Clerk's hosted Accounts URL, which is
    // derived from the publishable key — and during keyless bootstrap (fresh
    // clone, no .env.local yet) there is no key, so the redirect throws
    // "Missing publishableKey" instead of landing on /sign-in.
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
    debug: process.env.NODE_ENV === "development",
  },
);

export default function proxy(request: NextRequest, event: unknown) {
  if (localAuthEnabled()) {
    // Clerk owns these paths and cannot render without a provider, so send them
    // somewhere useful rather than letting them fail.
    if (isPublicRoute(request)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }
  return (clerkProxy as (req: NextRequest, event: unknown) => Response)(
    request,
    event,
  );
}

export const config = {
  matcher: [
    // All routes except Next internals and static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/api/(.*)",
    "/__clerk/(.*)",
  ],
};
