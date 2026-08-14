import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isDeskRestricted } from "@/lib/access";

// Plain path test — createRouteMatcher is deprecated in this Clerk release.
const PUBLIC_ROUTE = /^\/sign-(?:in|up)(?:\/.*)?$/;
const SIGN_UP_ROUTE = /^\/sign-up(?:\/.*)?$/;

const isPublicRoute = (req: { nextUrl: { pathname: string } }) =>
  PUBLIC_ROUTE.test(req.nextUrl.pathname);

export default clerkMiddleware(
  async (auth, req) => {
    // Invitation-only desk: there is no public registration surface at all.
    // Clerk also refuses these sign-ups, but serving the form invites people
    // to try, and a dashboard setting is easier to undo than this.
    if (SIGN_UP_ROUTE.test(req.nextUrl.pathname) && isDeskRestricted()) {
      const signIn = new URL("/sign-in", req.nextUrl);
      signIn.searchParams.set("closed", "1");
      return NextResponse.redirect(signIn);
    }

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
