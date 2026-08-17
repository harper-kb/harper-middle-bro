import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRateLimited,
  rateLimitResetMs,
  runSupabaseManagementQuery,
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
    process.env.SUPABASE_ACCESS_TOKEN = "test-token";
    process.env.SUPABASE_PROJECT_REF = "test-ref";
  });

  afterEach(() => {
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
});
