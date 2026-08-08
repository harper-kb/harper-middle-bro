/**
 * Stand-in for the `server-only` guard package, used ONLY by the render
 * self-checks (see scripts/tsconfig.render-check.json). The real guard
 * throws outside a React Server Components bundle, which would stop
 * `npx tsx` from rendering components that transitively import server
 * modules. Production builds never see this file.
 */
export {};
