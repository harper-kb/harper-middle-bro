import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  getSessionOperator: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getSessionOperator: session.getSessionOperator,
}));

import { POST } from "@/app/api/records-telemetry/route";

beforeEach(() => {
  session.getSessionOperator.mockResolvedValue({ id: "operator" });
});

afterEach(() => vi.restoreAllMocks());

describe("Records telemetry endpoint", () => {
  it("accepts an allowlisted redacted event", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(
      new Request("http://localhost/api/records-telemetry", {
        method: "POST",
        body: JSON.stringify({
          event: "records-to-company",
          detail: {
            trigger: "account-link",
            state: {
              view: "pending",
              source: "broker",
              iq_stage_count: 0,
              broker_gate_count: 1,
              range: "all-time",
              carrier_count: 2,
              location_state_count: 0,
              sort_date: "oldest",
              sort_revenue: "none",
              query_length: 4,
              page: 1,
              filters_active: true,
              hash: "1234abcd",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(info).toHaveBeenCalledWith(
      "records_navigation_state",
      expect.objectContaining({
        event: "records-to-company",
        trigger: "account-link",
      }),
    );
  });

  it("rejects payloads that could put a URL or customer text in logs", async () => {
    const response = await POST(
      new Request("http://localhost/api/records-telemetry", {
        method: "POST",
        body: JSON.stringify({
          event: "records-to-company",
          detail: { fullUrl: "/accounts/co-1?q=private" },
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("requires an authenticated operator", async () => {
    session.getSessionOperator.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/records-telemetry", {
        method: "POST",
        body: JSON.stringify({
          event: "filter-transition",
          detail: { trigger: "carrier" },
        }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
