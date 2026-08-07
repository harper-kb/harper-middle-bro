import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(
  async (_auth, _req) => {
    // public-by-default; page/actions enforce sign-in where needed
  },
  { debug: process.env.NODE_ENV === "development" },
);

export const config = {
  matcher: [
    "/((?!_next|api/inbox|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/(.*)",
  ],
};
