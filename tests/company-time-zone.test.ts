import { describe, expect, it } from "vitest";
import {
  formatCustomerLocalTime,
  millisecondsUntilNextMinute,
  normalizeHarperTimeZone,
  resolveCompanyTimeZone,
  timeZoneForUsState,
  US_STATE_TIME_ZONES,
} from "@/lib/company-time-zone";

describe("company timezone resolution", () => {
  it("uses a stored IANA identifier without changing it", () => {
    expect(
      resolveCompanyTimeZone({
        storedTimeZone: "America/Chicago",
        state: "Colorado",
      }),
    ).toEqual({
      timeZone: "America/Chicago",
      source: "stored_iana",
      unavailableReason: null,
    });
  });

  it("rejects legacy labels and falls back to the company state", () => {
    expect(normalizeHarperTimeZone("(GMT-06:00) Central Time")).toBeNull();
    expect(normalizeHarperTimeZone("EST")).toBeNull();
    expect(normalizeHarperTimeZone("(GMT-05:00) Central Time")).toBeNull();
    expect(
      resolveCompanyTimeZone({
        storedTimeZone: "(GMT-06:00) Central Time",
        state: "AL",
      }),
    ).toEqual({
      timeZone: "America/Chicago",
      source: "state_default",
      unavailableReason: null,
    });
  });

  it("covers every US state plus DC by name and abbreviation", () => {
    expect(US_STATE_TIME_ZONES).toHaveLength(51);
    expect(new Set(US_STATE_TIME_ZONES.map((state) => state.code)).size).toBe(51);

    for (const state of US_STATE_TIME_ZONES) {
      expect(timeZoneForUsState(state.code)).toBe(state.timeZone);
      expect(timeZoneForUsState(state.name)).toBe(state.timeZone);
    }
  });

  it("uses a simple predominant-zone default for multi-zone states", () => {
    expect(
      resolveCompanyTimeZone({
        storedTimeZone: null,
        state: "Florida",
      }),
    ).toEqual({
      timeZone: "America/New_York",
      source: "state_default",
      unavailableReason: null,
    });
  });

  it("reports unavailable only when no usable stored zone or state exists", () => {
    expect(
      resolveCompanyTimeZone({
        storedTimeZone: null,
        state: null,
      }),
    ).toEqual({
      timeZone: null,
      source: null,
      unavailableReason: "state_missing",
    });
    expect(timeZoneForUsState("Not a state")).toBeNull();
  });
});

describe("customer civil-time formatting", () => {
  it("uses IANA daylight-saving rules across the spring transition", () => {
    const before = formatCustomerLocalTime(
      "2026-03-08T07:30:00.000Z",
      "America/Chicago",
    );
    const after = formatCustomerLocalTime(
      "2026-03-08T08:30:00.000Z",
      "America/Chicago",
    );
    expect(before?.time).toBe("1:30 AM");
    expect(after?.time).toBe("3:30 AM");
  });

  it("distinguishes standard and daylight time without fixed offsets", () => {
    const winter = formatCustomerLocalTime(
      "2026-01-15T19:00:00.000Z",
      "America/Chicago",
    );
    const summer = formatCustomerLocalTime(
      "2026-07-15T18:00:00.000Z",
      "America/Chicago",
    );
    expect(winter?.time).toBe("1:00 PM");
    expect(winter?.shortZoneName).toBe("CST");
    expect(summer?.time).toBe("1:00 PM");
    expect(summer?.shortZoneName).toBe("CDT");
  });

  it("aligns the first update to the next minute boundary", () => {
    expect(millisecondsUntilNextMinute(Date.parse("2026-08-17T05:40:12Z"))).toBe(
      48_000,
    );
    expect(millisecondsUntilNextMinute(Date.parse("2026-08-17T05:40:00Z"))).toBe(
      60_000,
    );
  });
});
