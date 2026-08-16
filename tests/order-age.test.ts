/**
 * Deal-age boundary rules. The point of these is the calendar-day contract:
 * age is a difference of America/Los_Angeles civil dates, never elapsed hours
 * divided by 24, so it stays correct across DST and across the UTC date line.
 */
import { describe, expect, it } from "vitest";
import {
  DEAL_AGE_ATTENTION_AFTER_DAYS,
  dealAgeDays,
  dealAgeLabel,
  dealAgeNeedsAttention,
  harperCalendarDay,
  harperTimestampLabel,
} from "@/lib/order-age";

describe("harperCalendarDay", () => {
  it("resolves the Harper-timezone day, not the UTC day", () => {
    // Matches the live database: orders_temp.created_at 2026-08-15 04:00:52Z
    // reports a PT day of 2026-08-14.
    expect(harperCalendarDay("2026-08-15T04:00:52.992Z")).toBe("2026-08-14");
    expect(harperCalendarDay("2026-08-15T19:47:54.698Z")).toBe("2026-08-15");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(harperCalendarDay("not a date")).toBeNull();
  });
});

describe("dealAgeDays", () => {
  it("counts complete calendar days, not elapsed 24-hour blocks", () => {
    // 11pm PT to the next morning is 0 elapsed days but 1 calendar day.
    expect(dealAgeDays("2026-08-15T06:30:00Z", "2026-08-15")).toBe(1);
    expect(dealAgeDays("2026-08-15T19:00:00Z", "2026-08-15")).toBe(0);
  });

  it("stays exact across the spring-forward transition", () => {
    // Mar 7 2026 12:00 PST to Mar 8 12:00 PDT is 23 hours: dividing elapsed
    // time by 24 would report 0 days, but it is one calendar day.
    expect(dealAgeDays("2026-03-07T20:00:00Z", "2026-03-08")).toBe(1);
    expect(dealAgeDays("2026-03-06T20:00:00Z", "2026-03-10")).toBe(4);
  });

  it("stays exact across the fall-back transition", () => {
    // Oct 31 2026 23:00 PDT to Nov 1 is one calendar day over a 25-hour day.
    expect(dealAgeDays("2026-11-01T06:00:00Z", "2026-11-01")).toBe(1);
    expect(dealAgeDays("2026-10-30T19:00:00Z", "2026-11-03")).toBe(4);
  });

  it("spans month and year ends", () => {
    expect(dealAgeDays("2025-12-31T18:00:00Z", "2026-01-02")).toBe(2);
  });

  it("returns null rather than a fabricated zero when there is no timestamp", () => {
    expect(dealAgeDays(null, "2026-08-15")).toBeNull();
    expect(dealAgeDays(undefined, "2026-08-15")).toBeNull();
    expect(dealAgeDays("nonsense", "2026-08-15")).toBeNull();
    expect(dealAgeDays("2026-08-15T19:00:00Z", "garbage")).toBeNull();
  });

  it("clamps a future creation day to zero instead of going negative", () => {
    expect(dealAgeDays("2026-08-20T19:00:00Z", "2026-08-15")).toBe(0);
  });
});

describe("deal age presentation", () => {
  it("uses the singular through one day", () => {
    expect(dealAgeLabel(0)).toBe("0 Day");
    expect(dealAgeLabel(1)).toBe("1 Day");
    expect(dealAgeLabel(2)).toBe("2 Days");
    expect(dealAgeLabel(6)).toBe("6 Days");
    expect(dealAgeLabel(1234)).toBe("1,234 Days");
  });

  it("escalates only above five days", () => {
    expect(DEAL_AGE_ATTENTION_AFTER_DAYS).toBe(5);
    for (const days of [0, 1, 2, 3, 4, 5]) {
      expect(dealAgeNeedsAttention(days)).toBe(false);
    }
    for (const days of [6, 7, 40]) {
      expect(dealAgeNeedsAttention(days)).toBe(true);
    }
  });

  it("stamps the exact moment with date, time and timezone", () => {
    // Asserted by component rather than as one string: ICU versions differ on
    // whether the date and time are joined by "," or "at".
    const stamp = harperTimestampLabel("2026-08-14T22:47:55.000Z") ?? "";
    expect(stamp).toContain("Aug 14, 2026");
    expect(stamp).toContain("3:47 PM");
    expect(stamp).toContain("PDT");
  });

  it("reports standard time outside daylight saving", () => {
    expect(harperTimestampLabel("2026-01-14T22:47:55.000Z")).toContain("PST");
  });

  it("returns null for a missing stamp", () => {
    expect(harperTimestampLabel(null)).toBeNull();
  });
});
