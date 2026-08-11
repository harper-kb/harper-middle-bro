/**
 * Pending Orders lane — order-grain G1–G6 checkout/bind progression.
 * Labels mirror BigBrother workbench-ui-copy / unbound-accounts-model.
 */

import type { WorkItem } from "@/lib/types";

export type GateId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6";

export const GATE_ORDER: readonly GateId[] = [
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
] as const;

/** Operator-facing milestones — parity with BigBrother GATE_MILESTONE_TITLE. */
export const GATE_LABELS: Record<GateId, string> = {
  G1: "Build DocuSign",
  G2: "Send DocuSign To Customer",
  G3: "Harper Sign And Bind Request",
  G4: "Awaiting Binder",
  G5: "Binder Received",
  G6: "Policy Issued",
};

export type GateState = "not_started" | "in_progress" | "blocked" | "done";

export type PendingOrderProgress = {
  currentGate: GateId;
  gates: Record<GateId, GateState>;
  blockers: string[];
  quoteSource: string | null;
  bindReady: boolean;
};

/** Parse G* from a work item title/summary (sample + live stage_summary). */
export function inferGateFromWorkItem(item: WorkItem): GateId {
  const hay = `${item.title} ${item.summary} ${item.blocker?.label ?? ""}`.toUpperCase();
  for (const gate of [...GATE_ORDER].reverse()) {
    if (hay.includes(gate)) return gate;
  }
  if (/SIGN/.test(hay)) return "G3";
  if (/PAYMENT|PFA|FINANC/.test(hay)) return "G4";
  if (/SUBJECTIV/.test(hay)) return "G5";
  if (/BIND/.test(hay)) return "G6";
  if (/SEND/.test(hay) && /DOCUSIGN|ENVELOPE/.test(hay)) return "G2";
  if (/BUILD|DOCUSIGN/.test(hay)) return "G1";
  return "G1";
}

export function buildPendingOrderProgress(item: WorkItem): PendingOrderProgress {
  const current = inferGateFromWorkItem(item);
  const idx = GATE_ORDER.indexOf(current);
  const gates = Object.fromEntries(
    GATE_ORDER.map((g, i) => {
      if (i < idx) return [g, "done" as GateState];
      if (i === idx) {
        return [
          g,
          item.blocker ? ("blocked" as GateState) : ("in_progress" as GateState),
        ];
      }
      return [g, "not_started" as GateState];
    }),
  ) as Record<GateId, GateState>;

  const blockers: string[] = [];
  if (item.blocker) blockers.push(item.blocker.label);
  if (item.actionRequired && !item.blocker) blockers.push("Action Required");

  return {
    currentGate: current,
    gates,
    blockers,
    quoteSource: null,
    bindReady: current === "G6" && !item.blocker,
  };
}

export function pendingOrderRowSignals(item: WorkItem): {
  what: string;
  who: string;
  clock: string;
  blocker: string | null;
  action: string;
  gate: GateId;
} {
  const progress = buildPendingOrderProgress(item);
  return {
    what: `${progress.currentGate} — ${GATE_LABELS[progress.currentGate]}`,
    who: item.owner.displayName ?? "Unassigned",
    clock: item.clock.label,
    blocker: item.blocker?.label ?? null,
    action: item.nextActionLabel,
    gate: progress.currentGate,
  };
}
