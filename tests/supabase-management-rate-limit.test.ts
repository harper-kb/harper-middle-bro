import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSupabaseManagementGateForTests,
  isRateLimited,
  rateLimitResetMs,
  runSupabaseManagementQuery,
  supabaseManagementRetryAfterSeconds,
} from "@/lib/supabase-management.server";

/**
 * The Management API quota is shared account-wide, so the live-book refresh is
 * refused routinely by traffic that has nothing to do with it. What it does
 * with that refusal decides how stale the desk gets: the quota resets within
 * the minute and says how much of it is left, so a caller on a timer that
 * guesses instead sits out ticks it could have spent.
 */

function respond(
  status: number,
  headers: Record<string, string> = {},
  body: unknown = [],
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

async function refusalFrom(headers: Record<string, string>): Promise<unknown> {
  _resetSupabaseManagementGateForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond(429, headers, { message: "too many" })),
  );
  return runSupabaseManagementQuery("select 1").then(
    () => {
      throw new Error("expected the query to be refused");
    },
    (error: unknown) => error,
  );
}

describe("supabase management rate limiting", () => {
  beforeEach(() => {
    _resetSupabaseManagementGateForTests();
    process.env.SUPABASE_ACCESS_TOKEN = "test-token";
    process.env.SUPABASE_PROJECT_REF = "test-ref";
  });

  afterEach(() => {
    _resetSupabaseManagementGateForTests();
    vi.unstubAllGlobals();
  });

  it("carries the reset window the quota reported", async () => {
    const error = await refusalFrom({ "x-ratelimit-reset": "37" });

    expect(isRateLimited(error)).toBe(true);
    expect(rateLimitResetMs(error)).toBe(37_000);
  });

  it("rounds a fractional window up, so the retry lands after the reset", async () => {
    expect(await refusalFrom({ "x-ratelimit-reset": "4.2" }).then(rateLimitResetMs))
      .toBe(5_000);
  });

  it("reports no window when the refusal carried none", async () => {
    const error = await refusalFrom({});

    // Null is the signal to fall back to guessing — not a zero-length wait,
    // which would retry straight into the same wall.
    expect(isRateLimited(error)).toBe(true);
    expect(rateLimitResetMs(error)).toBeNull();
  });

  it("ignores a window longer than the quota's own minute", async () => {
    // A header we do not understand must not strand the refresh for hours.
    expect(
      await refusalFrom({ "x-ratelimit-reset": "86400" }).then(rateLimitResetMs),
    ).toBe(120_000);
  });

  it("ignores a malformed window", async () => {
    expect(
      await refusalFrom({ "x-ratelimit-reset": "soon" }).then(rateLimitResetMs),
    ).toBeNull();
    expect(
      await refusalFrom({ "x-ratelimit-reset": "-5" }).then(rateLimitResetMs),
    ).toBeNull();
  });

  it("keeps the message every other caller matches on", async () => {
    const error = await refusalFrom({ "x-ratelimit-reset": "12" });

    expect((error as Error).message).toBe("supabase_management_http_429");
  });

  it("leaves other failures alone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(502)));

    await expect(runSupabaseManagementQuery("select 1")).rejects.toThrow(
      "supabase_management_http_502",
    );
  });

  it("treats a bare 429 error as rate limited but windowless", () => {
    // Callers elsewhere throw the message directly to simulate a refusal.
    const bare = new Error("supabase_management_http_429");

    expect(isRateLimited(bare)).toBe(true);
    expect(rateLimitResetMs(bare)).toBeNull();
  });

  it("returns rows when the quota lets the query through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, {}, [{ ok: 1 }])));

    await expect(runSupabaseManagementQuery("select 1")).resolves.toEqual([
      { ok: 1 },
    ]);
  });

  it("fails fast during a known quota window and exposes Retry-After guidance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respond(429, { "x-ratelimit-reset": "18" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await runSupabaseManagementQuery("select first").catch(
      (error: unknown) => error,
    );
    const second = await runSupabaseManagementQuery("select second").catch(
      (error: unknown) => error,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(supabaseManagementRetryAfterSeconds(first)).toBe(18);
    expect(supabaseManagementRetryAfterSeconds(second)).toBeGreaterThan(0);
  });

  it("runs queued interactive work before queued refresh work", async () => {
    let releaseFirst!: () => void;
    const started: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit): Promise<Response> => {
        const sql = String(
          JSON.parse(String(init?.body ?? "{}")).query ?? "",
        );
        started.push(sql);
        if (sql === "background-one") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return respond(200, {}, [{ sql }]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = runSupabaseManagementQuery(
      "background-one",
      120_000,
      { priority: "background" },
    );
    const second = runSupabaseManagementQuery(
      "background-two",
      120_000,
      { priority: "background" },
    );
    const refresh = runSupabaseManagementQuery(
      "refresh",
      120_000,
      { priority: "refresh" },
    );
    const interactive = runSupabaseManagementQuery("interactive");
    expect(started).toEqual(["background-one"]);

    releaseFirst();
    await Promise.all([first, second, refresh, interactive]);

    expect(started).toEqual([
      "background-one",
      "interactive",
      "refresh",
      "background-two",
    ]);
  });

  it("includes queue time in the caller timeout", async () => {
    let releaseFirst!: () => void;
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit): Promise<Response> => {
        const sql = String(
          JSON.parse(String(init?.body ?? "{}")).query ?? "",
        );
        if (sql === "slow-background") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return respond(200, {}, []);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = runSupabaseManagementQuery(
      "slow-background",
      1_000,
      { priority: "background" },
    );
    const expired = runSupabaseManagementQuery("interactive", 10);

    await expect(expired).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseFirst();
    await first;
  });
});
