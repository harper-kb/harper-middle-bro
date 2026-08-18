import { defineConfig } from "vitest/config";
import path from "path";

// Two aliases matter (same seams as the HTA source repo's config):
//  - `server-only` → an empty stub. The real marker package throws when
//    imported outside a React Server bundle (which is the point in the app),
//    but the engine modules are plain server TS we want to unit-test directly.
//  - `@/…` → src, matching the tsconfig path so imports resolve the same way.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, "test/stubs/server-only.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "src") + "/$1" },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Live-book integration tests share one SQLite snapshot across workers;
    // cold schema sync can legitimately exceed Vitest's 5s default.
    testTimeout: 10_000,
  },
});
