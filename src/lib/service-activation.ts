import "server-only";

import { agentToolsConfigured } from "@/lib/adapters/agent-tools/config";

export type ServiceActivationId = "service_spine" | "service_agent";

export type ServiceActivationGate = {
  id: ServiceActivationId;
  enabled: boolean;
  ready: boolean;
  state: "active" | "ready_off" | "not_configured";
  label: string;
  blockerLabel: string | null;
};

/**
 * Explicit activation flags. Both default OFF even when Agent Tools
 * credentials are present. Credentials make the systems ready; they do not
 * activate them.
 */
export function serviceSpineEnabled(): boolean {
  return process.env.STEP_BRO_SERVICE_SPINE_ENABLED === "true";
}

export function serviceAgentEnabled(): boolean {
  return process.env.STEP_BRO_SERVICE_AGENT_ENABLED === "true";
}

function gate(
  id: ServiceActivationId,
  enabled: boolean,
  label: string,
): ServiceActivationGate {
  const ready = agentToolsConfigured();
  if (!ready) {
    return {
      id,
      enabled: false,
      ready: false,
      state: "not_configured",
      label,
      blockerLabel:
        `${label} plumbing is installed but Agent Tools credentials are not provisioned`,
    };
  }
  if (!enabled) {
    return {
      id,
      enabled: false,
      ready: true,
      state: "ready_off",
      label,
      blockerLabel: `${label} is available but not activated`,
    };
  }
  return {
    id,
    enabled: true,
    ready: true,
    state: "active",
    label,
    blockerLabel: null,
  };
}

export function getServiceActivation(): {
  spine: ServiceActivationGate;
  agent: ServiceActivationGate;
} {
  return {
    spine: gate("service_spine", serviceSpineEnabled(), "Service Spine"),
    agent: gate("service_agent", serviceAgentEnabled(), "Service Agent"),
  };
}
