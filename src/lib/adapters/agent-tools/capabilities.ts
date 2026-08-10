import "server-only";

import type { CapabilityGate, CapabilityId } from "@/lib/types";
import { agentToolsConfigured } from "./config";

type CapabilityDef = {
  id: CapabilityId;
  provider: CapabilityGate["provider"];
  /** Agent Tools command path when available */
  command: string | null;
  /** When Agent Tools is down, may a proven legacy adapter serve this? */
  legacyFallback: boolean;
  /** Human label for blocked controls */
  label: string;
};

export const CAPABILITY_DEFS: readonly CapabilityDef[] = [
  {
    id: "read.bigbrother.lanes",
    provider: "bigbrother",
    command: null,
    legacyFallback: false,
    label: "Read BigBrother Lanes",
  },
  {
    id: "read.bigbrother.account",
    provider: "bigbrother",
    command: null,
    legacyFallback: false,
    label: "Read BigBrother Account",
  },
  {
    id: "write.issue",
    provider: "agent_tools",
    command: "service issue create",
    legacyFallback: false,
    label: "Create Service Issue",
  },
  {
    id: "write.task",
    provider: "agent_tools",
    command: "service task create",
    legacyFallback: false,
    label: "Create Service Task",
  },
  {
    id: "write.draft",
    provider: "agent_tools",
    command: "service draft create",
    legacyFallback: true,
    label: "Create Draft",
  },
  {
    id: "write.comms.email",
    provider: "agent_tools",
    command: "service draft send",
    legacyFallback: true,
    label: "Send Email",
  },
  {
    id: "write.comms.text",
    provider: "agent_tools",
    command: "service workflow send-sms",
    legacyFallback: true,
    label: "Send Text",
  },
  {
    id: "write.comms.bulk",
    provider: "agent_tools",
    command: "service bulk-outreach send-email",
    legacyFallback: false,
    label: "Bulk Outreach",
  },
  {
    id: "write.payment_link",
    provider: "agent_tools",
    command: "service payment-link create",
    legacyFallback: true,
    label: "Create Payment Link",
  },
  {
    id: "write.docusign",
    provider: "agent_tools",
    command: "service docusign link",
    legacyFallback: true,
    label: "DocuSign",
  },
  {
    id: "write.bind",
    provider: "agent_tools",
    command: null,
    legacyFallback: false,
    label: "Bind Policy",
  },
  {
    id: "write.coi.issue",
    provider: "local",
    command: null,
    legacyFallback: true,
    label: "Issue COI",
  },
  {
    id: "write.coi.send",
    provider: "agent_tools",
    command: "service draft send",
    legacyFallback: true,
    label: "Send COI",
  },
  {
    id: "read.memory",
    provider: "local",
    command: null,
    legacyFallback: false,
    label: "Ask Memory",
  },
  {
    id: "read.agent_status",
    provider: "agent_tools",
    command: "service task list",
    legacyFallback: false,
    label: "Agent Run Status",
  },
  {
    id: "write.reminder",
    provider: "agent_tools",
    command: "service task transition",
    legacyFallback: true,
    label: "Set Reminder",
  },
] as const;

export function discoverCapabilities(opts?: {
  agentToolsUp?: boolean;
}): CapabilityGate[] {
  const toolsUp = opts?.agentToolsUp ?? agentToolsConfigured();
  return CAPABILITY_DEFS.map((def) => {
    if (def.provider === "local" || def.provider === "bigbrother") {
      return {
        id: def.id,
        state: "available" as const,
        blockerLabel: null,
        provider: def.provider,
      };
    }
    if (def.id === "write.bind" && !def.command) {
      return {
        id: def.id,
        state: "blocked" as const,
        blockerLabel:
          "Safe bind door not provisioned — confirm bind in the carrier portal",
        provider: def.provider,
      };
    }
    if (!toolsUp) {
      if (def.legacyFallback) {
        return {
          id: def.id,
          state: "blocked" as const,
          blockerLabel: `${def.label} via Agent Tools unavailable — legacy fallback registered but not selected`,
          provider: "legacy",
        };
      }
      return {
        id: def.id,
        state: "unavailable" as const,
        blockerLabel: `Harper Agent Tools not configured — cannot ${def.label}`,
        provider: def.provider,
      };
    }
    return {
      id: def.id,
      state: "available" as const,
      blockerLabel: null,
      provider: def.provider,
    };
  });
}

export function getCapabilityGate(
  id: CapabilityId,
  opts?: { agentToolsUp?: boolean },
): CapabilityGate {
  const found = discoverCapabilities(opts).find((g) => g.id === id);
  if (!found) {
    return {
      id,
      state: "unavailable",
      blockerLabel: `Unknown capability ${id}`,
      provider: "agent_tools",
    };
  }
  return found;
}
