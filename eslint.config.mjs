import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Base64-vendored PDF templates: TypeScript-ESLint's parser stack-overflows
    // on the megabyte-scale string literals (same ignore as the HTA source repo).
    "src/lib/coi-engine/acord25-template.ts",
    "src/lib/coi-engine/acord30-template.ts",
  ]),
]);

export default eslintConfig;
