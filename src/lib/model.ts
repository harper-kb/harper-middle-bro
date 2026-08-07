import { randomUUID } from "crypto";

/**
 * The seam every model call goes through — and the reason it cannot escape
 * the trace.
 *
 * A model call is a decision like any other, except the inputs are a prompt
 * and the rule is a set of weights nobody can read. That makes recording it
 * more important, not less: without the prompt, the model name, and the raw
 * response, "the AI wrote this" is an assertion instead of an audit.
 *
 * There is no exported way to run a model outside a session. Sessions are
 * handed to the write that produced them (see `createAndSendThread` and
 * `recordCoiDecision`), so the calls land in the decision record next to the
 * rules they informed. If you add a model call and skip the session, the
 * trace will say the body was deterministic — and it will be lying.
 */

export type ModelPurpose =
  | "draft_body"
  | "wording_read"
  | "holder_extract"
  | "reply_classify"
  | "certificate_read";

export const MODEL_PURPOSE_LABELS: Record<ModelPurpose, string> = {
  draft_body: "Draft The Email Body",
  wording_read: "Interpret The Requested Wording",
  holder_extract: "Pull The Holder From The Request",
  reply_classify: "Read The Market's Reply",
  certificate_read: "Read The Uploaded Certificate",
};

export interface ModelRequest {
  purpose: ModelPurpose;
  /** What the model was asked to do, in the operator's words */
  intent: string;
  system?: string;
  prompt: string;
  temperature?: number;
  /** The structured facts handed in alongside the prompt */
  context?: { label: string; value: string }[];
}

export interface ModelCall {
  id: string;
  purpose: ModelPurpose;
  intent: string;
  model: string;
  system: string | null;
  prompt: string;
  response: string;
  temperature: number | null;
  /** Null when the provider does not report one — never invent a number */
  confidence: number | null;
  promptTokens: number | null;
  responseTokens: number | null;
  latencyMs: number;
  /**
   * Whether the response actually reached the market. A discarded or
   * overridden generation is the most interesting row in the ledger.
   */
  accepted: boolean;
  overrideNote: string | null;
  at: string;
}

export interface ModelClient {
  readonly name: string;
  run(req: ModelRequest): Promise<Omit<ModelCall, "id" | "accepted" | "overrideNote">>;
}

/**
 * Nothing in Service calls a model yet. This stands in so the plumbing is
 * exercised and typed, and so the day a real provider lands it is a one-line
 * swap rather than a new integration.
 */
const simulatedClient: ModelClient = {
  name: "simulated",
  async run(req) {
    return {
      purpose: req.purpose,
      intent: req.intent,
      model: "simulated-0",
      system: req.system ?? null,
      prompt: req.prompt,
      response: `[simulated] no provider is wired up — ${MODEL_PURPOSE_LABELS[req.purpose].toLowerCase()}`,
      temperature: req.temperature ?? null,
      confidence: null,
      promptTokens: null,
      responseTokens: null,
      latencyMs: 0,
      at: new Date().toISOString(),
    };
  },
};

export const modelClient: ModelClient = simulatedClient;

/**
 * A session collects every call made while producing one outbound artifact.
 * Hand it to the write that produced it and the trace is complete by
 * construction.
 */
export class ModelSession {
  private readonly records: ModelCall[] = [];

  constructor(private readonly client: ModelClient = modelClient) {}

  async run(req: ModelRequest): Promise<ModelCall> {
    const raw = await this.client.run(req);
    const call: ModelCall = {
      ...raw,
      id: randomUUID(),
      accepted: true,
      overrideNote: null,
    };
    this.records.push(call);
    return call;
  }

  /** The operator rewrote what the model produced — say so in the record. */
  markOverridden(callId: string, note: string): void {
    const call = this.records.find((c) => c.id === callId);
    if (!call) return;
    call.accepted = false;
    call.overrideNote = note;
  }

  /** Mark every generation on this session as replaced by a human. */
  markAllOverridden(note: string): void {
    for (const call of this.records) {
      call.accepted = false;
      call.overrideNote = note;
    }
  }

  get calls(): ModelCall[] {
    return [...this.records];
  }

  get used(): boolean {
    return this.records.length > 0;
  }
}

export function createModelSession(client?: ModelClient): ModelSession {
  return new ModelSession(client);
}
