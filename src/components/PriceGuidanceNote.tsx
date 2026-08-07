"use client";

import { getCarrierIntel } from "@/lib/carriers";
import { formatMoney } from "@/lib/format";
import { getRequestType } from "@/lib/catalog";
import {
  guidanceIsQuotable,
  MIN_QUOTE_SAMPLES,
  type PriceGuidance,
} from "@/lib/price-guidance";
import type { RequestTypeId } from "@/lib/types";

/**
 * A ballpark that shows its work. Numbers only appear when enough real
 * quotes on this desk back them, framed as an indication — never a quote.
 * Otherwise the honest answer is "ask the market", and that's what renders.
 */
export function PriceGuidanceNote({
  guidance,
  carrier,
  requestType,
}: {
  guidance: PriceGuidance | null;
  carrier: string;
  requestType: RequestTypeId;
}) {
  const label = getRequestType(requestType).label;
  const instantQuoteApi = getCarrierIntel(carrier)?.instantQuoteApi === true;

  const apiSuggestion = instantQuoteApi ? (
    <p className="mt-1 text-[10px] font-semibold text-[var(--pierre)]">
      Instant Quote Available Via {carrier} API — Connect In Settings{" "}
      <span className="font-normal text-[var(--muted)]">(not yet connected)</span>
    </p>
  ) : null;

  if (guidance && guidanceIsQuotable(guidance)) {
    const { priced, zeroCount, sampleCount } = guidance;
    return (
      <div className="mt-1.5 rounded-lg border border-[var(--rule)] bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-[var(--sand)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink)]">
            Indication Only — Not A Quote
          </span>
        </div>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]">
          Based On {sampleCount} Quoted Threads With {carrier}
        </p>
        <p className="mt-0.5 text-xs text-[var(--ink)]">
          {priced ? (
            <>
              {label} quoted at{" "}
              <span className="font-semibold tabular-nums">
                {priced.minCents === priced.maxCents
                  ? formatMoney(priced.medianCents)
                  : `${formatMoney(priced.minCents)}–${formatMoney(priced.maxCents)}`}
              </span>
              {priced.count >= 3 && priced.minCents !== priced.maxCents && (
                <>
                  {" "}
                  (median{" "}
                  <span className="font-semibold tabular-nums">
                    {formatMoney(priced.medianCents)}
                  </span>
                  )
                </>
              )}
              {zeroCount > 0 &&
                ` — ${zeroCount} of ${sampleCount} came back no charge`}
            </>
          ) : (
            <>All {sampleCount} came back no charge.</>
          )}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          Desk history — actual quotes received here, not a rate card. The
          market still sets the price.
        </p>
        {apiSuggestion}
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-[var(--muted)]">
        {guidance
          ? `Only ${guidance.sampleCount} prior ${carrier} ${label} quote${
              guidance.sampleCount === 1 ? "" : "s"
            } on this desk — under the ${MIN_QUOTE_SAMPLES}-quote minimum, so no number gets suggested.`
          : `No ${carrier} ${label} history on this desk — ask the market rather than guess.`}
      </p>
      {apiSuggestion}
    </div>
  );
}
