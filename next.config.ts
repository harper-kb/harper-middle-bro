import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Cursor / Simple Browser often hits 127.0.0.1 while the page origin is localhost
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
