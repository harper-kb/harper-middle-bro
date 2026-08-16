import "server-only";

import type { DescriptionFitPlan } from "./acord25-descfit";
import type { CoiFormType } from "./coi-forms";

export interface CachedCoiPreview {
  bytes: Uint8Array;
  form: CoiFormType;
  descriptionFit?: DescriptionFitPlan | null;
}

const PREVIEW_TTL_MS = 15_000;
const PREVIEW_MAX_ENTRIES = 8;

type PreviewEntry = { expiresAt: number; value: CachedCoiPreview };
const previewGlobal = globalThis as typeof globalThis & {
  __harperCoiPreviewCache?: Map<string, PreviewEntry>;
  __harperCoiPreviewFlights?: Map<string, Promise<CachedCoiPreview>>;
};
const previewCache =
  previewGlobal.__harperCoiPreviewCache ??
  (previewGlobal.__harperCoiPreviewCache = new Map<string, PreviewEntry>());
const previewFlights =
  previewGlobal.__harperCoiPreviewFlights ??
  (previewGlobal.__harperCoiPreviewFlights = new Map<string, Promise<CachedCoiPreview>>());

// Memory-only, exact-URL cache for the browser PDF viewer's repeated GET/range
// requests. No completed value survives 15s or eight documents; POST edit
// previews never call this helper.
export function cachedCoiPreview(
  key: string,
  build: () => Promise<CachedCoiPreview>,
  now = Date.now(),
): Promise<CachedCoiPreview> {
  const cached = previewCache.get(key);
  if (cached && cached.expiresAt > now) {
    // Reinsert to keep the map's first key as the least-recently used entry.
    previewCache.delete(key);
    previewCache.set(key, cached);
    return Promise.resolve(cached.value);
  }
  if (cached) previewCache.delete(key);

  const standing = previewFlights.get(key);
  if (standing) return standing;

  const flight = build()
    .then((value) => {
      while (previewCache.size >= PREVIEW_MAX_ENTRIES) {
        const oldest = previewCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        previewCache.delete(oldest);
      }
      previewCache.set(key, { expiresAt: Date.now() + PREVIEW_TTL_MS, value });
      return value;
    })
    .finally(() => {
      if (previewFlights.get(key) === flight) previewFlights.delete(key);
    });
  previewFlights.set(key, flight);
  return flight;
}

export type PdfByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

// One RFC 7233 byte range is enough for Chromium's PDF viewer. Multi-range
// requests fall back to a normal full response instead of multipart overhead.
export function pdfByteRange(total: number, header: string | null | undefined): PdfByteRange {
  if (!header || !header.startsWith("bytes=") || header.includes(",")) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || total <= 0) return { kind: "unsatisfiable" };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, total - suffixLength), end: total - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= total ||
    requestedEnd < start
  ) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "partial", start, end: Math.min(requestedEnd, total - 1) };
}

export function _resetCoiPreviewCache(): void {
  previewCache.clear();
  previewFlights.clear();
}
