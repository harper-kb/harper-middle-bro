import "server-only";

/**
 * Harper Agent Tools door client credentials.
 *
 * Env:
 *   HARPER_AGENT_TOOLS_BASE_URL — gateway origin (no trailing slash)
 *   HARPER_AGENT_TOOLS_TOKEN    — bearer token
 *
 * When unset, capability discovery marks write doors blocked and the client
 * refuses mutations (legacy fallback may still serve a subset).
 */
export type AgentToolsCredentials = {
  baseUrl: string;
  token: string;
};

export function readAgentToolsCredentials(): AgentToolsCredentials | null {
  const baseUrl = process.env.HARPER_AGENT_TOOLS_BASE_URL?.trim().replace(/\/+$/, "");
  const token = process.env.HARPER_AGENT_TOOLS_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export function agentToolsConfigured(): boolean {
  return readAgentToolsCredentials() != null;
}

export const AGENT_TOOLS_SOURCE = "harper-agent-tools://execute" as const;
