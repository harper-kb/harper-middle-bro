import "server-only";

export type SupabaseManagementQueryPriority =
  | "interactive"
  | "refresh"
  | "background";

export interface SupabaseManagementQueryOptions {
  priority?: SupabaseManagementQueryPriority;
  signal?: AbortSignal;
}

/**
 * The quota refusing a request, carrying the window it reported. The message
 * is the same string a plain refusal always threw, so `isRateLimited` and the
 * refresh log keep reading it the same way.
 */
export class SupabaseManagementRateLimitError extends Error {
  /** Seconds until the quota resets, when the response reported it. */
  readonly resetSeconds: number | null;

  constructor(resetSeconds: number | null) {
    super("supabase_management_http_429");
    this.name = "SupabaseManagementRateLimitError";
    this.resetSeconds = resetSeconds;
  }
}

/**
 * The quota window is a minute, so a reset further out than this is a header
 * we do not understand and should not be stalled by.
 */
const MAX_RESET_SECONDS = 120;
const DEFAULT_BLOCK_SECONDS = 60;

function parseResetSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.ceil(seconds), MAX_RESET_SECONDS);
}

type QueuedQuery = {
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  cancelled: boolean;
};

type ManagementGateState = {
  active: boolean;
  quotaBlockedUntil: number;
  interactive: QueuedQuery[];
  refresh: QueuedQuery[];
  background: QueuedQuery[];
};

const MANAGEMENT_GATE_STATE = Symbol.for("stepbro.supabaseManagementGate");

function gateState(): ManagementGateState {
  const store = globalThis as unknown as Record<
    symbol,
    ManagementGateState | undefined
  >;
  store[MANAGEMENT_GATE_STATE] ??= {
    active: false,
    quotaBlockedUntil: 0,
    interactive: [],
    refresh: [],
    background: [],
  };
  return store[MANAGEMENT_GATE_STATE];
}

function blockedError(
  state: ManagementGateState,
): SupabaseManagementRateLimitError | null {
  const remainingMs = state.quotaBlockedUntil - Date.now();
  if (remainingMs <= 0) {
    state.quotaBlockedUntil = 0;
    return null;
  }
  return new SupabaseManagementRateLimitError(
    Math.max(1, Math.ceil(remainingMs / 1000)),
  );
}

function pumpGate(state: ManagementGateState): void {
  if (state.active) return;
  let next: QueuedQuery | undefined;
  do {
    next =
      state.interactive.shift() ??
      state.refresh.shift() ??
      state.background.shift();
  } while (next?.cancelled);
  if (!next) return;
  state.active = true;
  void next
    .run(next.signal)
    .then(next.resolve, next.reject)
    .finally(() => {
      state.active = false;
      queueMicrotask(() => pumpGate(state));
    });
}

function enqueueQuery<T>(
  priority: SupabaseManagementQueryPriority,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const state = gateState();
  return new Promise<T>((resolve, reject) => {
    if (externalSignal?.aborted) {
      reject(externalSignal.reason);
      return;
    }
    const controller = new AbortController();
    let settled = false;
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException(
          "Supabase Management query timed out.",
          "TimeoutError",
        ),
      );
    }, Math.max(1, timeoutMs));
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      controller.signal.removeEventListener("abort", onAbort);
    };
    const finishResolve = (value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value as T);
    };
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const queued: QueuedQuery = {
      run,
      resolve: finishResolve,
      reject: finishReject,
      signal: controller.signal,
      cancelled: false,
    };
    function onAbort() {
      queued.cancelled = true;
      finishReject(
        controller.signal.reason ??
          new DOMException("Supabase Management query aborted.", "AbortError"),
      );
      pumpGate(state);
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
    state[priority].push(queued);
    pumpGate(state);
  });
}

/**
 * Read-only SQL through the Supabase Management API. All callers share one
 * process-local gate: interactive reads jump ahead of queued refresh work,
 * while concurrency one prevents the app from bursting into the shared quota.
 */
export async function runSupabaseManagementQuery<T>(
  sql: string,
  timeoutMs = 120_000,
  options: SupabaseManagementQueryOptions = {},
): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    throw new Error("supabase_management_unconfigured");
  }

  return enqueueQuery(
    options.priority ?? "interactive",
    timeoutMs,
    options.signal,
    async (signal) => {
      const state = gateState();
      const blocked = blockedError(state);
      if (blocked) throw blocked;

      const response = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: sql }),
          cache: "no-store",
          signal,
        },
      );
      if (response.status === 429) {
        const reportedSeconds = parseResetSeconds(
          response.headers.get("x-ratelimit-reset"),
        );
        const blockSeconds = reportedSeconds ?? DEFAULT_BLOCK_SECONDS;
        state.quotaBlockedUntil = Math.max(
          state.quotaBlockedUntil,
          Date.now() + blockSeconds * 1000,
        );
        throw new SupabaseManagementRateLimitError(reportedSeconds);
      }
      if (!response.ok) {
        throw new Error(`supabase_management_http_${response.status}`);
      }
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows)) {
        throw new Error("supabase_management_invalid_response");
      }
      return rows as T[];
    },
  );
}

/** Whether a failure was a shared quota refusal. */
export function isRateLimited(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "supabase_management_http_429"
  );
}

/** Milliseconds until the quota will accept requests again, when known. */
export function rateLimitResetMs(error: unknown): number | null {
  if (!(error instanceof SupabaseManagementRateLimitError)) return null;
  return error.resetSeconds === null ? null : error.resetSeconds * 1000;
}

/**
 * HTTP-safe retry guidance. A windowless refusal gets the conservative
 * one-minute fallback used by the process gate.
 */
export function supabaseManagementRetryAfterSeconds(
  error: unknown,
): number | null {
  if (!isRateLimited(error)) return null;
  const resetMs = rateLimitResetMs(error);
  return Math.max(
    1,
    Math.ceil((resetMs ?? DEFAULT_BLOCK_SECONDS * 1000) / 1000),
  );
}

/** Test-only reset; callers must await all queued queries before using it. */
export function _resetSupabaseManagementGateForTests(): void {
  const state = gateState();
  state.active = false;
  state.quotaBlockedUntil = 0;
  state.interactive.splice(0);
  state.refresh.splice(0);
  state.background.splice(0);
}
