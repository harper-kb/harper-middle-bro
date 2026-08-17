import "server-only";

/**
 * Harper Agent Tools door client credentials.
 *
 * Env:
 *   HARPER_AGENT_TOOLS_BASE_URL — gateway origin (no trailing slash), e.g.
 *     the harper-tools REST API deployment; commands are posted to
 *     `{base}/api/v1/commands/<domain>/<resource>/<verb>`
 *   HARPER_AGENT_TOOLS_TOKEN    — API key, sent as a bearer token
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
