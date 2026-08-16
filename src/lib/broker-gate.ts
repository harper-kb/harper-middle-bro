/**
 * Broker Gate view axis — newest `service_workbench_gate_overrides.current_gate`
 * per order. Display-only; never filters Accounts results.
 *
 * Labels mirror BigBrother GATE_MILESTONE_TITLE via HTA gate-move.ts.
 * Workflow is not strictly monotonic — do not mark earlier gates completed
 * without history events.
 */

export const BROKER_GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;

export type BrokerGateId = (typeof BROKER_GATE_IDS)[number];

/** BB / HTA gate milestone titles. */
export const BROKER_GATE_LABELS: Record<BrokerGateId, string> = {
  G1: "Build DocuSign",
  G2: "Send DocuSign to customer",
  G3: "Harper Sign and Bind Request",
  G4: "Awaiting Binder",
  G5: "Binder Received",
  G6: "Policy issued",
};

export function isBrokerGateId(raw: string): raw is BrokerGateId {
  return (BROKER_GATE_IDS as readonly string[]).includes(raw);
}

/**
 * Normalize a stored gate. Accepts `Gn` and loose `Gate n` forms so a drifted
 * value never reads as unavailable when it is still a known gate.
 */
export function coerceBrokerGateId(raw: string | null | undefined): BrokerGateId | null {
  if (raw === null || raw === undefined) return null;
  const m = /^g(?:ate)?[ _-]?([1-6])$/i.exec(raw.trim());
  if (!m) return null;
  return `G${m[1]}` as BrokerGateId;
}

export type BrokerGateView = {
  gate: BrokerGateId;
  label: string;
  /** ISO timestamp of the override row when known. */
  at: string | null;
};

export function brokerGateView(
  rawGate: string | null | undefined,
  at: string | null | undefined = null,
): BrokerGateView | null {
  const gate = coerceBrokerGateId(rawGate);
  if (!gate) return null;
  return {
    gate,
    label: BROKER_GATE_LABELS[gate],
    at: at && typeof at === "string" && at.trim() ? at : null,
  };
}
