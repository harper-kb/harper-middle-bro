/**
 * Valuing an at-risk window in retained commission.
 *
 * Harper earns commission, not premium, so a $27K audit bill at risk is a ~$2K
 * commission event and that is the number that belongs on a scorecard. Paying
 * on premium would make the same amount of work worth wildly different money
 * depending on the carrier's rate, which is exactly the distortion this
 * mechanism is supposed to avoid.
 *
 * Rates are basis points end to end. Cents and bps are integers; the only
 * rounding happens once, at the final multiply.
 */

/** Blended book rate. Used when the carrier is unknown, and labeled as such. */
export const BLENDED_COMMISSION_BPS = 1650;

/** Observed range across Harper markets. Anything outside is a data error, not a rate. */
export const MIN_COMMISSION_BPS = 800;
export const MAX_COMMISSION_BPS = 2500;

/**
 * Known carrier rates. Deliberately short: a rate belongs here only when it is
 * confirmed, because a guessed rate silently misprices every save on that
 * paper. Everything else falls back to the blended rate and says so.
 */
export const CARRIER_COMMISSION_BPS: Record<string, number> = {
  coterie: 1500,
};

/**
 * Markets where commission is earned on the full financed amount including
 * fees rather than base premium. Quoting off base premium alone understates
 * the commission at risk on this paper.
 */
export const COMMISSION_ON_FULL_PREMIUM = new Set(["isc", "instant specialty"]);

export type CommissionRate = {
  bps: number;
  source: "carrier" | "blended";
  note: string;
};

export function commissionRateFor(carrier: string | null): CommissionRate {
  const key = carrier?.trim().toLowerCase() ?? "";
  const known = CARRIER_COMMISSION_BPS[key];
  if (known != null) {
    return {
      bps: known,
      source: "carrier",
      note: `${carrier} confirmed rate`,
    };
  }
  return {
    bps: BLENDED_COMMISSION_BPS,
    source: "blended",
    note: carrier
      ? `No confirmed rate for ${carrier} — blended book rate applied`
      : "Carrier unknown — blended book rate applied",
  };
}

export function isCommissionRateSane(bps: number): boolean {
  return (
    Number.isFinite(bps) && bps >= MIN_COMMISSION_BPS && bps <= MAX_COMMISSION_BPS
  );
}

/**
 * Share of the term still unearned at a point in time. A cancellation three
 * weeks before expiry puts almost nothing at risk; the same notice a month
 * into a fresh annual policy puts nearly all of it at risk.
 */
export function remainingTermShare(opts: {
  effectiveDate: string;
  expirationDate: string;
  asOf: string;
}): number {
  const start = Date.parse(opts.effectiveDate);
  const end = Date.parse(opts.expirationDate);
  const at = Date.parse(opts.asOf);
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(at)) return 1;
  const term = end - start;
  if (term <= 0) return 1;
  const remaining = end - at;
  return Math.min(1, Math.max(0, remaining / term));
}

export type CommissionValuation = {
  premiumCents: number;
  commissionRateBps: number;
  rateSource: CommissionRate["source"];
  /** Unearned share of the term at the moment the window opened. */
  remainingShare: number;
  commissionAtRiskCents: number;
  note: string;
};

/**
 * Value one window. Proration is against the window's open date, not today:
 * the desk is credited for what was actually on the table when the notice
 * landed, not for how long the argument then took.
 */
export function valueAtRisk(opts: {
  premiumCents: number | null;
  carrier: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  openedAt: string;
  /** Override when the carrier rate is known on the policy record. */
  commissionRateBps?: number | null;
}): CommissionValuation | null {
  if (opts.premiumCents == null || opts.premiumCents <= 0) return null;

  const rate =
    opts.commissionRateBps != null && isCommissionRateSane(opts.commissionRateBps)
      ? {
          bps: opts.commissionRateBps,
          source: "carrier" as const,
          note: "Rate from policy record",
        }
      : commissionRateFor(opts.carrier);

  const remainingShare =
    opts.effectiveDate && opts.expirationDate
      ? remainingTermShare({
          effectiveDate: opts.effectiveDate,
          expirationDate: opts.expirationDate,
          asOf: opts.openedAt,
        })
      : 1;

  const commissionAtRiskCents = Math.round(
    opts.premiumCents * (rate.bps / 10_000) * remainingShare,
  );

  return {
    premiumCents: opts.premiumCents,
    commissionRateBps: rate.bps,
    rateSource: rate.source,
    remainingShare: Math.round(remainingShare * 1000) / 1000,
    commissionAtRiskCents,
    note:
      remainingShare < 1
        ? `${rate.note} · prorated to ${Math.round(remainingShare * 100)}% of term remaining`
        : rate.note,
  };
}

/**
 * Cancel-and-rewrite to another carrier keeps the relationship but changes the
 * economics, so it pays on what was actually retained rather than as a full
 * save. A rewrite onto worse paper can legitimately value at zero.
 */
export function retainedCommissionForRewrite(
  originalAtRiskCents: number,
  replacementCommissionCents: number,
): number {
  return Math.max(0, Math.min(originalAtRiskCents, replacementCommissionCents));
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
