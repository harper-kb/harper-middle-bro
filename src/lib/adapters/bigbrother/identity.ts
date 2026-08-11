import "server-only";

import { getSessionOperator } from "@/lib/session";
import type { IdentityMapping, Operator } from "@/lib/types";

/**
 * Map the signed-in Clerk user → Step Bro operator → optional BigBrother actor.
 *
 * `BIGBROTHER_ACTOR_MAP_JSON` may supply `{ "<clerkUserId>": "<externalActorId>" }`
 * or `{ "<operatorId>": "<externalActorId>" }` once provisioning lands.
 */
export function parseActorMap(
  raw: string | undefined = process.env.BIGBROTHER_ACTOR_MAP_JSON,
): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function mapOperatorToIdentity(
  operator: Operator,
  actorMap: Record<string, string> = parseActorMap(),
): IdentityMapping {
  const externalActorId =
    (operator.clerkUserId && actorMap[operator.clerkUserId]) ||
    actorMap[operator.id] ||
    null;
  return {
    clerkUserId: operator.clerkUserId ?? "",
    operatorId: operator.id,
    displayName: operator.displayName,
    role: operator.role,
    externalActorId,
  };
}

/** Session helper — null when signed out. */
export async function getSessionIdentity(): Promise<IdentityMapping | null> {
  const operator = await getSessionOperator();
  if (!operator) return null;
  return mapOperatorToIdentity(operator);
}
