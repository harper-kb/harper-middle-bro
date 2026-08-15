/**
 * Resolving timeline actors to people.
 *
 * Issue timelines carry a raw `actor` string. Some of those are humans, and
 * some are the spine's own automation writing under a service identity. Save
 * credit only exists for humans, so the split has to be explicit rather than
 * inferred from whether a name looks like a name.
 */

import type { ServicePodId } from "./pods";

export interface InternalAgent {
  id: string;
  displayName: string;
  email: string | null;
  /** Automation identities are first-class here, not filtered out upstream. */
  kind: "human" | "agent";
  /** Which service pod this person works in, when known. */
  podId: ServicePodId | null;
}

/**
 * Actor strings the spine writes for automation. Matched as prefixes because
 * deployments append environment suffixes.
 */
export const AUTOMATION_ACTOR_PREFIXES = [
  "spine-agent",
  "workflow-engine",
  "system",
  "cron",
  "relay",
  "webhook",
];

export type ResolvedActor = {
  actor: string;
  kind: "human" | "agent" | "system";
  agentId: string | null;
  displayName: string;
};

export function isAutomationActor(actor: string): boolean {
  const a = actor.trim().toLowerCase();
  return AUTOMATION_ACTOR_PREFIXES.some((p) => a.startsWith(p));
}

/**
 * Resolve one actor against the internal-agent directory.
 *
 * An unrecognized human-looking actor resolves to `system` with no agent id
 * rather than being credited to a guessed person. Unattributable work is
 * unpaid work, which is the rule that pushes it back into the record.
 */
export function resolveActor(
  actor: string,
  directory: InternalAgent[],
): ResolvedActor {
  const raw = actor.trim();
  if (!raw) {
    return { actor, kind: "system", agentId: null, displayName: "Unknown" };
  }
  if (isAutomationActor(raw)) {
    return { actor, kind: "agent", agentId: null, displayName: raw };
  }
  const key = raw.toLowerCase();
  const match = directory.find(
    (a) =>
      a.id.toLowerCase() === key ||
      a.email?.toLowerCase() === key ||
      a.displayName.toLowerCase() === key,
  );
  if (!match) {
    return { actor, kind: "system", agentId: null, displayName: raw };
  }
  return {
    actor,
    kind: match.kind,
    agentId: match.kind === "human" ? match.id : null,
    displayName: match.displayName,
  };
}

export function agentDisplayName(
  agentId: string | null,
  directory: InternalAgent[],
): string {
  if (!agentId) return "Unassigned";
  return directory.find((a) => a.id === agentId)?.displayName ?? agentId;
}

export function podForAgent(
  agentId: string | null,
  directory: InternalAgent[],
): ServicePodId | null {
  if (!agentId) return null;
  return directory.find((a) => a.id === agentId)?.podId ?? null;
}
