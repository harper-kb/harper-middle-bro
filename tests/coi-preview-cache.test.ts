import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCoiPreviewCache,
  cachedCoiPreview,
  pdfByteRange,
  type CachedCoiPreview,
} from "@/lib/coi-engine/coi-preview-cache";

const preview = (byte = 1): CachedCoiPreview => ({
  bytes: new Uint8Array([byte, byte + 1, byte + 2]),
  form: "acord25",
});

describe("COI initial-PDF cache", () => {
  beforeEach(() => {
    _resetCoiPreviewCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T05:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("single-flights duplicate viewer reads, reuses bytes briefly, then expires", async () => {
    let builds = 0;
    let resolveBuild!: (value: CachedCoiPreview) => void;
    const build = vi.fn(
      () =>
        new Promise<CachedCoiPreview>((resolve) => {
          builds++;
          resolveBuild = resolve;
        }),
    );

    const first = cachedCoiPreview("123?item=cert-1", build);
    const duplicate = cachedCoiPreview("123?item=cert-1", build);
    expect(duplicate).toBe(first);
    expect(builds).toBe(1);

    resolveBuild(preview());
    await expect(first).resolves.toEqual(preview());
    await expect(cachedCoiPreview("123?item=cert-1", build)).resolves.toEqual(preview());
    expect(builds).toBe(1);

    vi.advanceTimersByTime(15_001);
    const afterTtl = cachedCoiPreview("123?item=cert-1", async () => {
      builds++;
      return preview(7);
    });
    await expect(afterTtl).resolves.toEqual(preview(7));
    expect(builds).toBe(2);
  });
});

describe("PDF byte ranges", () => {
  it("supports open, closed, and suffix ranges", () => {
    expect(pdfByteRange(1000, null)).toEqual({ kind: "full" });
    expect(pdfByteRange(1000, "bytes=0-99")).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(pdfByteRange(1000, "bytes=900-")).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(pdfByteRange(1000, "bytes=-50")).toEqual({ kind: "partial", start: 950, end: 999 });
    expect(pdfByteRange(1000, "bytes=950-2000")).toEqual({ kind: "partial", start: 950, end: 999 });
  });

  it("refuses impossible single ranges and falls back on multipart", () => {
    expect(pdfByteRange(1000, "bytes=1000-")).toEqual({ kind: "unsatisfiable" });
    expect(pdfByteRange(1000, "bytes=20-10")).toEqual({ kind: "unsatisfiable" });
    expect(pdfByteRange(1000, "bytes=-0")).toEqual({ kind: "unsatisfiable" });
    expect(pdfByteRange(1000, "bytes=0-10,20-30")).toEqual({ kind: "full" });
  });
});
