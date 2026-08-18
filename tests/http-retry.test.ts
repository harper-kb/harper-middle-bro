import { describe, expect, it } from "vitest";
import {
  MAX_RETRY_AFTER_MS,
  parseRetryAfterMs,
} from "@/lib/http-retry";

describe("Retry-After parsing", () => {
  it("parses seconds and waits at least one second", () => {
    expect(parseRetryAfterMs("18")).toBe(18_000);
    expect(parseRetryAfterMs("0")).toBe(1_000);
  });

  it("parses HTTP dates and caps untrusted delays", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    expect(
      parseRetryAfterMs("Tue, 18 Aug 2026 12:00:12 GMT", now),
    ).toBe(12_000);
    expect(parseRetryAfterMs("9999", now)).toBe(MAX_RETRY_AFTER_MS);
  });

  it("rejects absent, malformed, and expired values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("later")).toBeNull();
    expect(
      parseRetryAfterMs(
        "Tue, 18 Aug 2026 11:59:00 GMT",
        Date.parse("2026-08-18T12:00:00.000Z"),
      ),
    ).toBeNull();
  });
});
