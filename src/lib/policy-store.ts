/**
 * Thin bridge so forms.ts can read schedules without importing the full db graph
 * at module load. Wired once getDb() has run.
 */

import type { PolicyFormSet } from "./forms";

let loader: ((policyId: string) => PolicyFormSet | null) | null = null;

export function registerPolicyFormLoader(
  fn: (policyId: string) => PolicyFormSet | null,
) {
  loader = fn;
}

export function getPolicyFormSetFromStore(
  policyId: string,
): PolicyFormSet | null {
  return loader?.(policyId) ?? null;
}
