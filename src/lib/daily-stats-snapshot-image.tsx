"use client";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  DAILY_STATS_SNAPSHOT_HEIGHT,
  DAILY_STATS_SNAPSHOT_FONT_FAMILY,
  DAILY_STATS_SNAPSHOT_WIDTH,
  DailyStatsSnapshotCard,
} from "@/components/daily-stats-snapshot/DailyStatsSnapshotCard";
import type { DailyStatsSnapshot } from "@/lib/daily-stats-snapshot";

export const DAILY_STATS_SNAPSHOT_MIME = "image/png";
export const DAILY_STATS_SNAPSHOT_ASSETS = Object.freeze({
  harper: "/harper-wordmark.png",
  stepBro: "/step-bro-wordmark.png",
});

export type ClipboardCopyOutcome =
  | Readonly<{ status: "success" }>
  | Readonly<{ status: "unsupported" }>
  | Readonly<{ status: "denied"; error: unknown }>
  | Readonly<{ status: "failed"; error: unknown }>;

export type DailyStatsSnapshotRenderJob = Readonly<{
  blobPromise: Promise<Blob>;
  automaticCopyPromise: Promise<ClipboardCopyOutcome>;
  abortController: AbortController;
}>;

function abortError(): DOMException {
  return new DOMException("Snapshot generation was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function blobToDataUrl(
  blob: Blob,
  signal: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.onload = () => {
      signal.removeEventListener("abort", onAbort);
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("A snapshot brand asset could not be decoded."));
    };
    reader.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(reader.error ?? new Error("A snapshot brand asset could not be read."));
    };
    reader.onabort = () => {
      signal.removeEventListener("abort", onAbort);
    };
    reader.readAsDataURL(blob);
  });
}

async function loadBrandAsset(
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(path, {
    cache: "force-cache",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Snapshot brand asset failed to load (${response.status}).`);
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("Snapshot brand asset was empty.");
  }
  return blobToDataUrl(blob, signal);
}

async function waitForSnapshotFonts(signal: AbortSignal): Promise<string> {
  if (document.fonts) {
    await awaitWithAbort(document.fonts.ready, signal);
  }
  throwIfAborted(signal);
  // SVG images are isolated documents and cannot reliably see the page's
  // generated next/font @font-face rules. A fixed export-safe system stack
  // keeps text metrics deterministic instead of silently falling back.
  return DAILY_STATS_SNAPSHOT_FONT_FAMILY;
}

function serializeCard(
  snapshot: DailyStatsSnapshot,
  assets: { harper: string; stepBro: string },
  fontFamily: string,
): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(
        <DailyStatsSnapshotCard
          snapshot={snapshot}
          harperLogoSrc={assets.harper}
          stepBroLogoSrc={assets.stepBro}
          fontFamily={fontFamily}
        />,
      );
    });
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("Snapshot card did not render.");
    return new XMLSerializer().serializeToString(svg);
  } finally {
    flushSync(() => root.unmount());
  }
}

function loadSvgImage(
  objectUrl: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  throwIfAborted(signal);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
    };
    const onAbort = () => {
      cleanup();
      image.src = "";
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Snapshot card artwork could not be rasterized."));
    };
    image.src = objectUrl;
  });
}

function canvasToPng(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (signal.aborted) {
        reject(abortError());
      } else if (
        !blob ||
        blob.size === 0 ||
        blob.type !== DAILY_STATS_SNAPSHOT_MIME
      ) {
        reject(new Error("The browser did not produce a valid PNG image."));
      } else {
        resolve(blob);
      }
    }, DAILY_STATS_SNAPSHOT_MIME);
  });
}

/**
 * Renders the dedicated SVG card at a fixed 1600×900 canvas size. It never
 * reads or captures application DOM, and it does not depend on devicePixelRatio.
 */
export async function renderDailyStatsSnapshotPng(
  snapshot: DailyStatsSnapshot,
  signal: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  const [harper, stepBro, fontFamily] = await Promise.all([
    loadBrandAsset(DAILY_STATS_SNAPSHOT_ASSETS.harper, signal),
    loadBrandAsset(DAILY_STATS_SNAPSHOT_ASSETS.stepBro, signal),
    waitForSnapshotFonts(signal),
  ]);
  throwIfAborted(signal);

  const markup = serializeCard(snapshot, { harper, stepBro }, fontFamily);
  const svgBlob = new Blob([markup], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);
  let image: HTMLImageElement | null = null;
  try {
    image = await loadSvgImage(svgUrl, signal);
    throwIfAborted(signal);
    const canvas = document.createElement("canvas");
    canvas.width = DAILY_STATS_SNAPSHOT_WIDTH;
    canvas.height = DAILY_STATS_SNAPSHOT_HEIGHT;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("This browser cannot create the snapshot canvas.");
    }
    context.drawImage(
      image,
      0,
      0,
      DAILY_STATS_SNAPSHOT_WIDTH,
      DAILY_STATS_SNAPSHOT_HEIGHT,
    );
    return await canvasToPng(canvas, signal);
  } finally {
    if (image) image.src = "";
    URL.revokeObjectURL(svgUrl);
  }
}

function clipboardAvailable(): boolean {
  try {
    if (typeof window === "undefined" || window.isSecureContext === false) {
      return false;
    }
    if (
      typeof navigator === "undefined" ||
      typeof navigator.clipboard?.write !== "function" ||
      typeof globalThis.ClipboardItem !== "function"
    ) {
      return false;
    }
    const supports = globalThis.ClipboardItem.supports;
    return (
      typeof supports !== "function" ||
      supports.call(globalThis.ClipboardItem, DAILY_STATS_SNAPSHOT_MIME)
    );
  } catch {
    return false;
  }
}

function copyFailure(error: unknown): ClipboardCopyOutcome {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (
    name === "NotAllowedError" ||
    name === "SecurityError"
  ) {
    return { status: "denied", error };
  }
  if (name === "NotSupportedError") {
    return { status: "unsupported" };
  }
  return { status: "failed", error };
}

function writeClipboardItem(
  png: Blob | Promise<Blob>,
): Promise<ClipboardCopyOutcome> {
  if (!clipboardAvailable()) {
    return Promise.resolve({ status: "unsupported" });
  }
  try {
    const item = new ClipboardItem({ [DAILY_STATS_SNAPSHOT_MIME]: png });
    return navigator.clipboard.write([item]).then(
      () => ({ status: "success" }) as const,
      (error: unknown) => copyFailure(error),
    );
  } catch (error) {
    return Promise.resolve(copyFailure(error));
  }
}

/** Invoked directly in the navbar click stack so supporting browsers retain activation. */
export function copyPngPromiseToClipboard(
  pngPromise: Promise<Blob>,
): Promise<ClipboardCopyOutcome> {
  return writeClipboardItem(pngPromise);
}

/** Explicit retry from a fresh user gesture after the PNG is already ready. */
export function copyPngBlobToClipboard(
  png: Blob,
): Promise<ClipboardCopyOutcome> {
  return writeClipboardItem(png);
}

export function createDailyStatsSnapshotRenderJob(
  snapshot: DailyStatsSnapshot,
): DailyStatsSnapshotRenderJob {
  const abortController = new AbortController();
  const blobPromise = renderDailyStatsSnapshotPng(
    snapshot,
    abortController.signal,
  );
  // This call intentionally happens without awaiting the render promise.
  const automaticCopyPromise = copyPngPromiseToClipboard(blobPromise);
  return Object.freeze({
    blobPromise,
    automaticCopyPromise,
    abortController,
  });
}
