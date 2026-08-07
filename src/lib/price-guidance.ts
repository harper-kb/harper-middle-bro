import type { RequestTypeId } from "./types";

/**
 * Price guidance — computed from quotes this desk has actually received,
 * never from a rate card we don't have. A number is only suggested when
 * enough real quotes back it, and every suggestion cites its basis.
 *
 * Pure module: safe on the client. The samples come from the server
 * (listQuoteSamples in db.ts) and are summarized here.
 */

/** One underwriter answer with a price on it, straight from the thread record. */
export interface QuoteSample {
  threadId: string;
  carrier: string;
  requestType: RequestTypeId;
  offeredPremiumCents: number;
  accountName: string;
  subject: string;
  createdAt: string;
}

export interface PriceGuidance {
  carrier: string;
  requestType: RequestTypeId;
  sampleCount: number;
  /** Quotes that came back no-charge */
  zeroCount: number;
  /** Stats over the priced (non-zero) quotes; null when none were priced */
  priced: {
    count: number;
    minCents: number;
    maxCents: number;
    medianCents: number;
  } | null;
  samples: QuoteSample[];
}

/**
 * Below this many real quotes we refuse to suggest a number.
 * Two data points is an anecdote, not guidance.
 */
export const MIN_QUOTE_SAMPLES = 3;

export function guidanceKey(carrier: string, requestType: RequestTypeId): string {
  return `${carrier}::${requestType}`;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Group raw quote history into per-carrier, per-request guidance. */
export function summarizeQuotes(
  samples: QuoteSample[],
): Record<string, PriceGuidance> {
  const groups = new Map<string, QuoteSample[]>();
  for (const s of samples) {
    const key = guidanceKey(s.carrier, s.requestType);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const out: Record<string, PriceGuidance> = {};
  for (const [key, list] of groups) {
    const pricedCents = list
      .filter((s) => s.offeredPremiumCents > 0)
      .map((s) => s.offeredPremiumCents)
      .sort((a, b) => a - b);
    out[key] = {
      carrier: list[0].carrier,
      requestType: list[0].requestType,
      sampleCount: list.length,
      zeroCount: list.filter((s) => s.offeredPremiumCents === 0).length,
      priced: pricedCents.length
        ? {
            count: pricedCents.length,
            minCents: pricedCents[0],
            maxCents: pricedCents[pricedCents.length - 1],
            medianCents: median(pricedCents),
          }
        : null,
      samples: list,
    };
  }
  return out;
}

/** Guidance for one carrier + request, or null when we have zero history. */
export function getGuidance(
  all: Record<string, PriceGuidance>,
  carrier: string,
  requestType: RequestTypeId,
): PriceGuidance | null {
  return all[guidanceKey(carrier, requestType)] ?? null;
}

/** Whether the sample is deep enough to put a number in front of anyone. */
export function guidanceIsQuotable(g: PriceGuidance | null): boolean {
  return g != null && g.sampleCount >= MIN_QUOTE_SAMPLES;
}
