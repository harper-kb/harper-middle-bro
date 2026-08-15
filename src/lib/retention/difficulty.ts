/**
 * Difficulty pricing for saves.
 *
 * A day-one non-pay cure is not a day-twenty direct-bill recovery, and neither
 * is a BOR clawback. Rather than hand-assigning tiers, the multiplier is
 * priced off observed recovery odds: how often does a window with this reason,
 * this bill mode, and this much elapsed time actually come back?
 *
 * The baselines come from the desk's own numbers — roughly 15% recovery
 * overall, about 50/50 on direct bill caught early, and effectively nothing
 * past two weeks.
 */

import type { CancelReasonCode } from "@/lib/lanes/pending-cancels";
import type { BillMode, DifficultyTier } from "./types";

/** Blended recovery rate across all pending-payment work. The multiplier's reference point. */
export const BASELINE_RECOVERY_RATE = 0.15;

/** Elapsed-time bands. Recovery decays sharply and is near zero past two weeks. */
type ElapsedBand = "d0_3" | "d4_7" | "d8_14" | "d15_plus";

function elapsedBand(daysElapsed: number): ElapsedBand {
  if (daysElapsed <= 3) return "d0_3";
  if (daysElapsed <= 7) return "d4_7";
  if (daysElapsed <= 14) return "d8_14";
  return "d15_plus";
}

/**
 * Agency-bill recovery odds by cancel reason. Rewrite bands highest because it
 * is the one path the desk controls end to end; underwriting bands lowest
 * because the carrier, not the desk, decides.
 */
const RECOVERY_ODDS: Record<CancelReasonCode, Record<ElapsedBand, number>> = {
  non_pay: { d0_3: 0.22, d4_7: 0.15, d8_14: 0.08, d15_plus: 0.02 },
  financing: { d0_3: 0.18, d4_7: 0.12, d8_14: 0.06, d15_plus: 0.02 },
  insured_request: { d0_3: 0.12, d4_7: 0.1, d8_14: 0.07, d15_plus: 0.03 },
  underwriting: { d0_3: 0.1, d4_7: 0.08, d8_14: 0.05, d15_plus: 0.02 },
  rewrite: { d0_3: 0.35, d4_7: 0.3, d8_14: 0.22, d15_plus: 0.1 },
  unknown: { d0_3: 0.15, d4_7: 0.11, d8_14: 0.06, d15_plus: 0.02 },
};

/**
 * Direct bill recovers far better than agency bill early on — the insured can
 * pay the carrier directly the moment they are reached. Financed paper is
 * worse: the finance company has its own clock and its own fees.
 */
const BILL_MODE_FACTOR: Record<BillMode, number> = {
  direct_bill: 2.3,
  agency_bill: 1,
  financed: 0.8,
  unknown: 1,
};

/** Multiplier floor and ceiling. Uncapped odds math produces absurd tails on rare rows. */
export const DIFFICULTY_MULTIPLIER_MIN = 1;
export const DIFFICULTY_MULTIPLIER_MAX = 4;

export type DifficultyAssessment = {
  tier: DifficultyTier;
  multiplier: number;
  /** Modeled odds this window comes back, before anyone works it. */
  recoveryOdds: number;
  basis: string;
};

export function assessDifficulty(opts: {
  reason: CancelReasonCode;
  billMode: BillMode;
  daysElapsed: number;
}): DifficultyAssessment {
  const band = elapsedBand(Math.max(0, opts.daysElapsed));
  const base = RECOVERY_ODDS[opts.reason][band];
  const odds = Math.min(0.95, base * BILL_MODE_FACTOR[opts.billMode]);
  const raw = BASELINE_RECOVERY_RATE / Math.max(odds, 0.001);
  const multiplier = Math.round(
    Math.min(DIFFICULTY_MULTIPLIER_MAX, Math.max(DIFFICULTY_MULTIPLIER_MIN, raw)) *
      100,
  ) / 100;
  return {
    tier: tierFor(multiplier),
    multiplier,
    recoveryOdds: Math.round(odds * 1000) / 1000,
    basis: `${opts.reason} · ${opts.billMode} · day ${Math.max(0, Math.round(opts.daysElapsed))}`,
  };
}

function tierFor(multiplier: number): DifficultyTier {
  if (multiplier <= 1.2) return "routine";
  if (multiplier <= 2) return "standard";
  if (multiplier <= 3) return "hard";
  return "long_shot";
}

/** Convenience for callers that only need the band. */
export function difficultyTierFor(opts: {
  reason: CancelReasonCode;
  billMode: BillMode;
  daysElapsed: number;
}): DifficultyTier {
  return assessDifficulty(opts).tier;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, (to - from) / 86_400_000);
}
