import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Cursor / Simple Browser often hits 127.0.0.1 while the page origin is localhost
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Local rendering without Clerk keys — see dev-clerk-stub.tsx. Never
  // applied to a production build.
  ...(process.env.NODE_ENV !== "production" && process.env.DEV_NO_AUTH === "1"
    ? {
        turbopack: {
          resolveAlias: {
            "@clerk/nextjs": "./dev-clerk-stub.tsx",
            "@clerk/nextjs/server": "./dev-clerk-server-stub.ts",
          },
        },
      }
    : {}),
};

export default nextConfig;
