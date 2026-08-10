import "server-only";

import type { ActionAdapter, ActionReceipt, ActionRequest, CapabilityId } from "@/lib/types";

/**
 * Proven BigBrother / harper-tools fallbacks used only when the Agent Tools
 * door is incomplete. Implementations register here; the dispatcher picks
 * legacy only when capability discovery says provider === "legacy" and the
 * caller explicitly allows fallback.
 */
export type LegacyFallbackHandler = {
  capabilityId: CapabilityId;
  description: string;
  execute(request: ActionRequest): Promise<ActionReceipt>;
};

const registry = new Map<CapabilityId, LegacyFallbackHandler>();

export function registerLegacyFallback(handler: LegacyFallbackHandler): void {
  registry.set(handler.capabilityId, handler);
}

export function getLegacyFallback(
  capabilityId: CapabilityId,
): LegacyFallbackHandler | null {
  return registry.get(capabilityId) ?? null;
}

export function listLegacyFallbacks(): LegacyFallbackHandler[] {
  return [...registry.values()];
}

/** Thin ActionAdapter wrapper around a registered legacy handler. */
export function legacyActionAdapter(capabilityId: CapabilityId): ActionAdapter | null {
  const handler = getLegacyFallback(capabilityId);
  if (!handler) return null;
  return {
    capabilityId,
    confirmation: "one_click",
    provider: "legacy",
    execute: (request) => handler.execute(request),
  };
}

/** Test-only reset. */
export function _resetLegacyFallbacksForTests(): void {
  registry.clear();
}
