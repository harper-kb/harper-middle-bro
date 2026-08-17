// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDailyStatsSnapshotModel } from "@/lib/daily-stats-snapshot";
import {
  DAILY_STATS_SNAPSHOT_ASSETS,
  DAILY_STATS_SNAPSHOT_MIME,
  copyPngBlobToClipboard,
  copyPngPromiseToClipboard,
  renderDailyStatsSnapshotPng,
} from "@/lib/daily-stats-snapshot-image";
import {
  createDailyOperationsStats,
  type OperationsStatsResponse,
} from "@/lib/operations-stats";

function snapshot() {
  const response: OperationsStatsResponse = {
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
  };
  return createDailyStatsSnapshotModel(createDailyOperationsStats(response), {
    capturedAt: new Date("2026-08-17T15:48:23.456Z"),
    capturedTimeZone: "America/Los_Angeles",
  });
}

class FakeImage {
  decoding = "";
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private value = "";

  set src(next: string) {
    this.value = next;
    if (next) queueMicrotask(() => this.onload?.(new Event("load")));
  }

  get src() {
    return this.value;
  }
}

class FakeClipboardItem {
  static supports = vi.fn(() => true);
  readonly data: Record<string, Blob | Promise<Blob>>;

  constructor(data: Record<string, Blob | Promise<Blob>>) {
    this.data = data;
  }
}

let originalFonts: PropertyDescriptor | undefined;
let originalClipboard: PropertyDescriptor | undefined;
let originalSecureContext: PropertyDescriptor | undefined;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;
let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;
let clipboardWrite: ReturnType<typeof vi.fn>;
let dimensions: { width: number; height: number } | null;

beforeEach(() => {
  originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  originalSecureContext = Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext",
  );
  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve({}) },
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });

  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  FakeClipboardItem.supports.mockClear();
  FakeClipboardItem.supports.mockReturnValue(true);

  createObjectUrl = vi.fn(() => "blob:snapshot-svg");
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["asset"], { type: "image/png" }),
    })),
  );

  dimensions = null;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      dimensions = { width: this.width, height: this.height };
      callback(new Blob(["png-bytes"], { type }));
    },
  );

  clipboardWrite = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: clipboardWrite },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalSecureContext) {
    Object.defineProperty(window, "isSecureContext", originalSecureContext);
  } else {
    Reflect.deleteProperty(window, "isSecureContext");
  }
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

describe("daily stats PNG renderer", () => {
  it("loads approved assets and returns a nonempty 1600×900 PNG", async () => {
    const png = await renderDailyStatsSnapshotPng(
      snapshot(),
      new AbortController().signal,
    );

    expect(fetch).toHaveBeenCalledWith(
      DAILY_STATS_SNAPSHOT_ASSETS.harper,
      expect.objectContaining({ cache: "force-cache" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      DAILY_STATS_SNAPSHOT_ASSETS.stepBro,
      expect.objectContaining({ cache: "force-cache" }),
    );
    expect(png.type).toBe(DAILY_STATS_SNAPSHOT_MIME);
    expect(png.size).toBeGreaterThan(0);
    expect(dimensions).toEqual({ width: 1600, height: 900 });
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:snapshot-svg");
  });

  it("revokes render resources when rasterization fails", async () => {
    class BrokenImage extends FakeImage {
      override set src(next: string) {
        if (next) queueMicrotask(() => this.onerror?.(new Event("error")));
      }
    }
    vi.stubGlobal("Image", BrokenImage);

    await expect(
      renderDailyStatsSnapshotPng(
        snapshot(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be rasterized");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:snapshot-svg");
  });
});

describe("PNG clipboard support", () => {
  it("starts automatic copy immediately with the pending PNG promise", async () => {
    const png = new Blob(["same-png"], { type: DAILY_STATS_SNAPSHOT_MIME });
    const pending = Promise.resolve(png);
    const outcomePromise = copyPngPromiseToClipboard(pending);

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    const item = clipboardWrite.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    expect(item.data[DAILY_STATS_SNAPSHOT_MIME]).toBe(pending);
    await expect(outcomePromise).resolves.toEqual({ status: "success" });
  });

  it("copies the actual ready blob from an explicit retry gesture", async () => {
    const png = new Blob(["same-png"], { type: DAILY_STATS_SNAPSHOT_MIME });
    const outcome = await copyPngBlobToClipboard(png);

    const item = clipboardWrite.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    expect(item.data[DAILY_STATS_SNAPSHOT_MIME]).toBe(png);
    expect(outcome).toEqual({ status: "success" });
  });

  it("reports unsupported PNG clipboard capability without writing", async () => {
    FakeClipboardItem.supports.mockReturnValue(false);
    const outcome = await copyPngBlobToClipboard(
      new Blob(["png"], { type: DAILY_STATS_SNAPSHOT_MIME }),
    );

    expect(outcome).toEqual({ status: "unsupported" });
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("truthfully reports permission rejection", async () => {
    const denial = new DOMException("blocked", "NotAllowedError");
    clipboardWrite.mockRejectedValueOnce(denial);
    const outcome = await copyPngBlobToClipboard(
      new Blob(["png"], { type: DAILY_STATS_SNAPSHOT_MIME }),
    );

    expect(outcome).toEqual({ status: "denied", error: denial });
  });
});
