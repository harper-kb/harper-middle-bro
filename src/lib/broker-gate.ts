/**
 * Broker Gate axis — newest `service_workbench_gate_overrides.current_gate`
 * per order (history rows collapse to the latest override at refresh time).
 * Drives both the order-card rail and the Broker Gate filter on Accounts.
 *
 * Labels mirror BigBrother GATE_MILESTONE_TITLE via HTA gate-move.ts.
 * Live values are verified to be exactly G1–G6 or NULL; NULL (no override,
 * or an override row without a gate) is the rail's "Gate unavailable" state.
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

/**
 * Filter id for orders whose current gate is unavailable — no override row,
 * or a stored value that does not coerce to a known gate. Matches the rail's
 * "Gate unavailable" display state exactly, so the filter can never claim a
 * gate the card does not show.
 */
export const BROKER_GATE_NONE = "gate:none";
export const BROKER_GATE_NONE_LABEL = "Gate unavailable";

/** Selectable Broker Gate filter ids: the known gates plus Gate unavailable. */
export type BrokerGateFilterId = BrokerGateId | typeof BROKER_GATE_NONE;

export type BrokerGateOption = {
  id: BrokerGateFilterId;
  /** Prominent short code (G1–G6); absent for Gate unavailable. */
  code: string | null;
  label: string;
};

/** Popover options in verified pipeline order, Gate unavailable last. */
export const BROKER_GATE_FILTER_OPTIONS: readonly BrokerGateOption[] = [
  ...BROKER_GATE_IDS.map((id) => ({
    id: id as BrokerGateFilterId,
    code: id as string,
    label: BROKER_GATE_LABELS[id],
  })),
  { id: BROKER_GATE_NONE, code: null, label: BROKER_GATE_NONE_LABEL },
];

const GATE_FILTER_ID_SET = new Set<string>([
  ...BROKER_GATE_IDS,
  BROKER_GATE_NONE,
]);
const BROKER_GATE_FILTER_ORDER: readonly BrokerGateFilterId[] = [
  ...BROKER_GATE_IDS,
  BROKER_GATE_NONE,
];

export function isBrokerGateFilterId(raw: string): raw is BrokerGateFilterId {
  return GATE_FILTER_ID_SET.has(raw);
}

/**
 * Parse the `brokerGate` URL param. Empty / missing → no gate filter (all
 * gates). Unknown tokens are dropped; only stable filter ids survive, so a
 * gate that stops existing simply falls out of the selection.
 */
export function parseBrokerGates(
  raw: string | null | undefined,
): BrokerGateFilterId[] {
  // Runtime shapes the page types don't promise (e.g. a repeated ?brokerGate=
  // param arriving as an array) parse as no selection rather than throwing.
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<BrokerGateFilterId>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!isBrokerGateFilterId(id)) continue;
    seen.add(id);
  }
  return BROKER_GATE_FILTER_ORDER.filter((id) => seen.has(id));
}

/** Serialize selected gates for the URL. Empty → omit param. */
export function serializeBrokerGates(
  gates: readonly BrokerGateFilterId[],
): string | undefined {
  const canonical = BROKER_GATE_FILTER_ORDER.filter((id) =>
    gates.includes(id),
  );
  return canonical.length > 0 ? canonical.join(",") : undefined;
}

/**
 * True when a stored gate column matches the selection. Uses the same
 * coercion the rail uses, so filter membership and the card's display state
 * cannot disagree.
 */
export function orderMatchesBrokerGates(
  rawGate: string | null | undefined,
  selected: readonly BrokerGateFilterId[],
): boolean {
  if (selected.length === 0) return true;
  const gate = coerceBrokerGateId(rawGate);
  return selected.includes(gate ?? BROKER_GATE_NONE);
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
