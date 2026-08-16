// ── THE CHECKER RECEIPTS (Lane 2 of the launch build list, 2026-07-08) ─────────
//
// Tanya's walk receipt, ranked #1 on her broken list: "the checker renders
// 'reconciles' on a card whose own body says there is no document on file to
// reconcile against (Golden Hour), and over blank holder-address fields on
// the READY card (Prairie Sky). The trust chip is structurally capable of
// lying, and it did, twice, without me trying hard."
//
// THE LAW: a verdict never renders without a source. The chip states what it
// checked against what, field by field ("checked 9 fields against the binder;
// 8 match; 1 empty: holder mailing address") — and when it verified NOTHING
// it renders nothing, or the explicit "can't verify" state; never a green
// "reconciles". This module is the ONE derivation every chip render consumes
// (the Workbench's three chip sites), pure and client-safe, pinned by
// tests/coi-checker-receipt.test.ts.

export interface CheckLike {
  status: "match" | "flagged";
  flags: string[];
  reconciled: { field: string; ok: boolean; detail: string }[];
  basis?: string | null;
}

export interface SourceVerificationLike {
  state: "verified" | "record_only" | "unavailable";
  verifiedAgainst?: { name: string } | null;
}

export type CheckerChipTone = "verified" | "confirm" | "cannot";

export interface CheckerChipView {
  tone: CheckerChipTone;
  label: string;
  // The expanded panel's field-by-field receipt lines (✓/⚑ prefixed by the
  // renderer via `ok`). Empty on the cannot-verify tone.
  receipts: Array<{ field: string; ok: boolean; detail: string }>;
  // The one-line summary of what was checked against what — the walk's ask,
  // verbatim shape: "Checked 9 fields against …; 8 match; 1 empty/flagged".
  summary: string | null;
}

// The one chip derivation. Returns NULL when no chip may render at all — a
// check that verified nothing and has nothing to confirm renders silence,
// never a verdict (the verdict-needs-a-source law).
export function checkerChipView(
  check: CheckLike | null | undefined,
  sourceVerification?: SourceVerificationLike | null,
): CheckerChipView | null {
  if (!check) return null;
  const receipts = check.reconciled ?? [];
  const flags = check.flags ?? [];
  const okCount = receipts.filter((r) => r.ok).length;
  const badCount = receipts.length - okCount;

  const basis =
    check.basis ??
    (sourceVerification?.state === "verified" && sourceVerification.verifiedAgainst?.name
      ? `the source document "${sourceVerification.verifiedAgainst.name}"`
      : null);

  const summary = receipts.length
    ? `Checked ${receipts.length} field${receipts.length === 1 ? "" : "s"}${basis ? ` against ${basis}` : ""}; ${okCount} match; ${badCount} to confirm.`
    : null;

  // Flags always surface — a confirm ask is not a verdict, it is work.
  if (flags.length > 0 || badCount > 0) {
    const n = Math.max(flags.length, badCount);
    return { tone: "confirm", label: `Checker: ${n} to confirm`, receipts, summary };
  }

  // Zero flags. A green verdict now needs BOTH receipts AND a source:
  //   - no receipts at all → NO CHIP (the check verified nothing; silence,
  //     never "reconciles" — the Golden Hour class);
  //   - receipts but the document verification says record-only/unavailable
  //     AND the check itself names no basis → the explicit can't-verify chip,
  //     grey, never green.
  if (receipts.length === 0) return null;
  if (!basis && sourceVerification?.state === "record_only") {
    return {
      tone: "cannot",
      label: "Checker: can't verify, no binder or dec page on file",
      receipts,
      summary,
    };
  }
  if (!basis && sourceVerification?.state === "unavailable") {
    return {
      tone: "cannot",
      label: "Checker: can't verify, the document check didn't run",
      receipts,
      summary,
    };
  }
  if (!basis) {
    // No named basis and no verification stamp either way: the honest claim
    // is what was checked, never a bare "reconciles" (a verdict with no
    // source is exactly the lying chip Tanya caught).
    return {
      tone: "cannot",
      label: `Checker: ${receipts.length} field${receipts.length === 1 ? "" : "s"} filled, no source to verify against`,
      receipts,
      summary,
    };
  }
  return {
    tone: "verified",
    label: `Checker: ${receipts.length} field${receipts.length === 1 ? "" : "s"} verified`,
    receipts,
    summary,
  };
}
