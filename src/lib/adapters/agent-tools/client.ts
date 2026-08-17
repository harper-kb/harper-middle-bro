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
 * Hard ceiling on any gateway call. These sit on interactive request paths
 * (service-note writes, quote URL minting); without a timeout a hung gateway
 * pinned the request — and the operator's UI — indefinitely.
 */
const AGENT_TOOLS_TIMEOUT_MS = 15_000;

/**
 * The gateway (harper-tools REST API) exposes each command as
 * `POST {base}/api/v1/commands/<domain>/<resource>/<verb>` with the input as
 * the JSON body. Callers here still speak the CLI shape
 * (`"ops sql run --limit 50"`), so the command line is parsed into path
 * segments plus flag fields; a flag overrides the same key in `input`,
 * matching the gateway's own CLI contract.
 */
function parseCommandLine(command: string): {
  segments: string[];
  flags: Record<string, unknown>;
} {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const segments: string[] = [];
  const flags: Record<string, unknown> = {};
  let index = 0;
  while (index < tokens.length && !tokens[index].startsWith("--")) {
    segments.push(tokens[index]);
    index += 1;
  }
  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).replace(/-/g, "_");
    if (!name) continue;
    const hasValue =
      index < tokens.length && !tokens[index].startsWith("--");
    if (!hasValue) {
      flags[name] = true;
      continue;
    }
    const value = tokens[index];
    index += 1;
    flags[name] = /^-?\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : value === "true"
        ? true
        : value === "false"
          ? false
          : value;
  }
  return { segments, flags };
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

  const { segments, flags } = parseCommandLine(command);
  if (segments.length === 0) {
    throw new AgentToolsClientError(
      `Agent Tools command has no path: "${command}"`,
      null,
    );
  }

  const url = `${creds.baseUrl}/api/v1/commands/${segments
    .map(encodeURIComponent)
    .join("/")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ...(input ?? {}), ...flags }),
      cache: "no-store",
      signal: AbortSignal.timeout(AGENT_TOOLS_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AgentToolsClientError(
      timedOut
        ? `Agent Tools timed out after ${AGENT_TOOLS_TIMEOUT_MS}ms`
        : `Agent Tools unreachable: ${err instanceof Error ? err.message : "network error"}`,
      null,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!res.ok || body.ok === false) {
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

  // The gateway answers {ok, command, tier, result: <payload>}; callers
  // consume the command payload directly, so unwrap the envelope.
  const result = body.result;
  const data =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : body;

  return {
    ok: true,
    status: res.status,
    data,
    error: null,
    sourceApi: AGENT_TOOLS_SOURCE,
  };
}

export function agentToolsReady(): boolean {
  return agentToolsConfigured();
}
