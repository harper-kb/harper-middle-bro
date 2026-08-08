import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Plain path test — createRouteMatcher is deprecated in this Clerk release.
const PUBLIC_ROUTE = /^\/sign-(?:in|up)(?:\/.*)?$/;
const isPublicRoute = (req: { nextUrl: { pathname: string } }) =>
  PUBLIC_ROUTE.test(req.nextUrl.pathname);

export default clerkMiddleware(
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
  { debug: process.env.NODE_ENV === "development" },
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
