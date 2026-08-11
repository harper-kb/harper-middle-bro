import "server-only";

import {
  AGENT_TOOLS_SOURCE,
  agentToolsConfigured,
  readAgentToolsCredentials,
} from "./config";

export type AgentToolsExecuteResult = {
  ok: boolean;
  status: number;
  /** Redacted / summary payload — never raw secrets */
  data: Record<string, unknown>;
  error: string | null;
  sourceApi: string;
};

export class AgentToolsClientError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AgentToolsClientError";
  }
}

/**
 * Execute one Agent Tools CLI-shaped command on the server.
 * Never call this from the browser — HWS/product routes stay behind this door.
 */
export async function executeAgentToolsCommand(
  command: string,
  input?: Record<string, unknown>,
): Promise<AgentToolsExecuteResult> {
  const creds = readAgentToolsCredentials();
  if (!creds) {
    throw new AgentToolsClientError(
      "Harper Agent Tools credentials not provisioned",
      null,
    );
  }

  const url = `${creds.baseUrl}/execute`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ command, input: input ?? {} }),
      cache: "no-store",
    });
  } catch (err) {
    throw new AgentToolsClientError(
      `Agent Tools unreachable: ${err instanceof Error ? err.message : "network error"}`,
      null,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: {},
      error:
        typeof body.error === "string"
          ? body.error
          : `Agent Tools HTTP ${res.status}`,
      sourceApi: AGENT_TOOLS_SOURCE,
    };
  }

  return {
    ok: true,
    status: res.status,
    data: body,
    error: null,
    sourceApi: AGENT_TOOLS_SOURCE,
  };
}

export function agentToolsReady(): boolean {
  return agentToolsConfigured();
}
