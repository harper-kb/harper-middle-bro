import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DAILY_STATS_SNAPSHOT_HEIGHT,
  DAILY_STATS_SNAPSHOT_FONT_FAMILY,
  DAILY_STATS_SNAPSHOT_WIDTH,
  DailyStatsSnapshotCard,
} from "@/components/daily-stats-snapshot/DailyStatsSnapshotCard";
import {
  createDailyStatsSnapshotModel,
  dailyStatsSnapshotAltText,
  dailyStatsSnapshotFilename,
  formatCapturedMetadata,
} from "@/lib/daily-stats-snapshot";
import {
  createDailyOperationsStats,
  type OperationsStatsResponse,
} from "@/lib/operations-stats";

function response(
  overrides: Partial<OperationsStatsResponse> = {},
): OperationsStatsResponse {
  return {
    selectedBusinessDate: "2026-08-17",
    businessTimezone: "America/Los_Angeles",
    bindSentTimezone: "America/New_York",
    metricsCalculatedAt: "2026-08-17T15:45:01.000Z",
    lastSuccessfulSyncAt: "2026-08-17T15:45:04.000Z",
    availableDates: [
      "2026-08-17",
      "2026-08-16",
      "2026-08-15",
      "2026-08-14",
      "2026-08-13",
      "2026-08-12",
      "2026-08-11",
    ],
    businessWindow: {
      startsAt: "2026-08-17T07:00:00.000Z",
      endsAt: "2026-08-18T07:00:00.000Z",
    },
    bindSentWindow: {
      startsAt: "2026-08-17T04:00:00.000Z",
      endsAt: "2026-08-18T04:00:00.000Z",
    },
    metrics: {
      bindSent: { total: 7, sameDay: 2, backlog: 5 },
      newOrders: 33,
      bound: 23,
      coisSent: 29,
    },
    refresh: {
      lastSuccessfulAt: "2026-08-17T15:45:04.000Z",
      lastAttemptAt: "2026-08-17T15:45:04.000Z",
      lastAttemptStatus: "success",
      lastFullRefreshAt: "2026-08-17T15:30:00.000Z",
    },
    ...overrides,
  };
}

describe("daily stats snapshot model", () => {
  it("uses Today only for the newest selected reporting date", () => {
    const today = createDailyStatsSnapshotModel(
      createDailyOperationsStats(response()),
      {
        capturedAt: new Date("2026-08-17T15:48:23.456Z"),
        capturedTimeZone: "America/Los_Angeles",
      },
    );
    expect(today.selectedDateLabel).toBe("Today · Aug 17, 2026");

    const previous = createDailyStatsSnapshotModel(
      createDailyOperationsStats(
        response({ selectedBusinessDate: "2026-08-16" }),
      ),
      {
        capturedAt: new Date("2026-08-17T15:48:23.456Z"),
        capturedTimeZone: "America/Los_Angeles",
      },
    );
    expect(previous.selectedDateLabel).toBe("Aug 16, 2026");
    expect(previous.selectedDateLabel).not.toContain("Today");
  });

  it("freezes the exact navbar metrics, windows, and data revision", () => {
    const initial = createDailyOperationsStats(response());
    const snapshot = createDailyStatsSnapshotModel(initial, {
      capturedAt: new Date("2026-08-17T15:48:23.456Z"),
      capturedTimeZone: "America/Los_Angeles",
    });

    const refreshed = createDailyOperationsStats(
      response({
        metricsCalculatedAt: "2026-08-17T15:47:01.000Z",
        metrics: {
          bindSent: { total: 10, sameDay: 4, backlog: 6 },
          newOrders: 40,
          bound: 28,
          coisSent: 35,
        },
      }),
    );

    expect(refreshed.metrics.newOrders).toBe(40);
    expect(snapshot.metrics).toEqual({
      bindSent: { total: 7, sameDay: 2, backlog: 5 },
      newOrders: 33,
      bound: 23,
      coisSent: 29,
    });
    expect(snapshot.metricsCalculatedAt).toBe("2026-08-17T15:45:01.000Z");
    expect(snapshot.reportingWindow).toEqual(initial.businessWindow);
    expect(snapshot.bindSentWindow).toEqual(initial.bindSentWindow);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.metrics)).toBe(true);
    expect(Object.isFrozen(snapshot.metrics.bindSent)).toBe(true);
  });

  it("keeps the reporting date separate from the exact local capture time", () => {
    const snapshot = createDailyStatsSnapshotModel(
      createDailyOperationsStats(
        response({ selectedBusinessDate: "2026-08-16" }),
      ),
      {
        capturedAt: new Date("2026-08-17T15:48:23.456Z"),
        capturedTimeZone: "America/Los_Angeles",
      },
    );

    expect(snapshot.selectedDate).toBe("2026-08-16");
    expect(snapshot.capturedAt).toBe("2026-08-17T15:48:23.456Z");
    expect(snapshot.capturedTimeZoneLabel).toBe("Pacific Time");
    expect(formatCapturedMetadata(snapshot)).toBe(
      "Aug 17, 2026 · 8:48:23 AM · Pacific Time",
    );
    expect(dailyStatsSnapshotFilename(snapshot)).toMatch(
      /^step-bro-daily-stats-2026-08-16-0848-(?:PT|PDT)\.png$/,
    );
  });

  it("builds a private-data-free accessible text equivalent", () => {
    const snapshot = createDailyStatsSnapshotModel(
      createDailyOperationsStats(response()),
      {
        capturedAt: new Date("2026-08-17T15:48:23.456Z"),
        capturedTimeZone: "America/Los_Angeles",
      },
    );
    const text = dailyStatsSnapshotAltText(snapshot);
    expect(text).toContain("Bind Sent 7");
    expect(text).toContain("2 same-day and 5 backlog");
    expect(text).toContain("New Orders 33");
    expect(text).toContain("Snapshot taken Aug 17, 2026");
    expect(text).not.toMatch(/account|customer|producer|policy number|email/i);
  });
});

describe("daily stats card visual contract", () => {
  it("renders one fixed 1600×900 card with approved labels and four-digit values", () => {
    const large = response({
      metrics: {
        bindSent: { total: 9_999, sameDay: 1_234, backlog: 8_765 },
        newOrders: 8_888,
        bound: 7_777,
        coisSent: 6_666,
      },
    });
    const snapshot = createDailyStatsSnapshotModel(
      createDailyOperationsStats(large),
      {
        capturedAt: new Date("2026-08-17T15:48:23.456Z"),
        capturedTimeZone: "America/Los_Angeles",
      },
    );
    const html = renderToStaticMarkup(
      <DailyStatsSnapshotCard
        snapshot={snapshot}
        harperLogoSrc="data:image/png;base64,aGFycGVy"
        stepBroLogoSrc="data:image/png;base64,c3RlcC1icm8="
      />,
    );

    expect(DAILY_STATS_SNAPSHOT_WIDTH).toBe(1600);
    expect(DAILY_STATS_SNAPSHOT_HEIGHT).toBe(900);
    expect(DAILY_STATS_SNAPSHOT_FONT_FAMILY).toBe(
      "Arial, Helvetica, sans-serif",
    );
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('viewBox="0 0 1600 900"');
    expect(html).toContain("DAILY OPERATIONS");
    expect(html).toContain("BIND SENT");
    expect(html).toContain("NEW ORDERS");
    expect(html).toContain("BOUND");
    expect(html).toContain("COIs SENT");
    expect(html).toContain("9,999");
    expect(html).toContain("1,234");
    expect(html).toContain("8,765");
    expect(html).toContain('font-size="82"');
    expect(html).toContain("data:image/png;base64,aGFycGVy");
    expect(html).toContain("data:image/png;base64,c3RlcC1icm8=");
    expect(html).not.toContain(">×<");
    expect(html).toContain('x="179.5"');
    expect(html).toContain('x="346.5"');
    expect(html).toContain('x="1394"');
    expect(html).toContain('text-anchor="middle"');
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      "6cc0fc6802485a028c39d97102cac87ef6554ca5e16ed952f6772b08ddcf18da",
    );
  });

  it("places the snapshot action left of the date controls", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/OperationsStatsBar.tsx"),
      "utf8",
    );
    const dateControls = source.indexOf('aria-label="Previous day"');
    const snapshotAction = source.indexOf("<DailyStatsSnapshotButton");
    const university = source.indexOf("HARPER_UNIVERSITY_URL", snapshotAction);

    expect(dateControls).toBeGreaterThan(-1);
    expect(snapshotAction).toBeGreaterThan(-1);
    expect(snapshotAction).toBeLessThan(dateControls);
    expect(university).toBeGreaterThan(dateControls);
    expect(source).toContain("w-[10rem]");
    expect(source).toContain("min-[480px]:w-[15.5rem]");
  });

  it("keeps responsive, themed, and reduced-motion modal contracts", () => {
    const dialog = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/components/daily-stats-snapshot/DailyStatsSnapshotDialog.tsx",
      ),
      "utf8",
    );
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(dialog).toContain("overflow-y-auto");
    expect(dialog).toContain("max-w-[48rem]");
    expect(dialog).toContain("aspect-video");
    expect(dialog).toContain("bg-[var(--surface-raised)]");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain(".daily-stats-snapshot-backdrop");
  });
});
