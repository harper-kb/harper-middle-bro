import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal server bundle for the container image; `next start` locally is
  // unaffected. See node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Cursor / Simple Browser often hits 127.0.0.1 while the page origin is localhost
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
