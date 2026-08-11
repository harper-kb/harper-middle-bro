/**
 * AI-native next-step recommendations for a work item.
 *
 * Deterministic + pure (no server-only, no model call): the Service Agent's
 * suggested moves are derived from the item's home lane, blocker, and next
 * action. Each recommendation names the exact capability + confirmation policy
 * it would run through, so the Desk can capability-gate it (show the real
 * blocker, never a dead or fake control) and offer one-click confirm for the
 * guarded doors (sends, binds, COIs, payments).
 *
 * The server attaches the live capability gate with `gateRecommendations`
 * (see desk/queue.ts). The UI executes a confirmed recommendation through the
 * guarded composer / Agent Tools doors via the Desk server action.
 */

import type {
  CapabilityGate,
  CapabilityId,
  CapabilityState,
  ConfirmationPolicy,
  WorkItem,
} from "@/lib/types";

/** Which server-side executor runs a confirmed recommendation. */
export type RecommendationExecutor =
  | "draft"
  | "composer"
  | "text"
  | "docusign"
  | "payment_link"
  | "coi_issue"
  | "coi_send"
  | "bind"
  | "document_retrieval"
  | "reminder";

export type RecommendationKind =
  | "prepare_draft"
  | "send"
  | "chase"
  | "issue"
  | "collect_payment"
  | "signature"
  | "bind"
  | "reminder";

export interface DeskRecommendation {
  id: string;
  workItemId: string;
  kind: RecommendationKind;
  /** Button label the operator clicks. */
  label: string;
  /** Why the agent suggests this — shown under the control. */
  rationale: string;
  capabilityId: CapabilityId;
  confirmation: ConfirmationPolicy;
  executor: RecommendationExecutor;
  /** True for the single highest-value next move. */
  primary: boolean;
}

/** Recommendation with the live capability gate stamped on (server-filled). */
export interface GatedRecommendation extends DeskRecommendation {
  gateState: CapabilityState;
  blockerLabel: string | null;
  provider: CapabilityGate["provider"];
}

/** Pure confirmation policy per capability — mirrors the dispatch adapter. */
const CONFIRMATION: Partial<Record<CapabilityId, ConfirmationPolicy>> = {
  "write.draft": "none",
  "write.comms.email": "one_click",
  "write.comms.text": "one_click",
  "write.docusign": "one_click",
  "write.payment_link": "one_click",
  "write.coi.issue": "one_click",
  "write.coi.send": "one_click",
  "write.bind": "one_click",
  "write.reminder": "one_click",
};

function confirmationFor(id: CapabilityId): ConfirmationPolicy {
  return CONFIRMATION[id] ?? "one_click";
}

function rec(
  item: Pick<WorkItem, "id">,
  kind: RecommendationKind,
  capabilityId: CapabilityId,
  executor: RecommendationExecutor,
  label: string,
  rationale: string,
  primary = false,
): DeskRecommendation {
  return {
    id: `${item.id}:${kind}`,
    workItemId: item.id,
    kind,
    label,
    rationale,
    capabilityId,
    confirmation: confirmationFor(capabilityId),
    executor,
    primary,
  };
}

/**
 * The primary next move — mapped from the item's blocker (a specific door) or
 * its home lane. This is the one-click "confirm the agent's prepared work".
 */
function primaryRecommendation(item: WorkItem): DeskRecommendation {
  const cap = item.blocker?.capabilityId ?? null;
  if (cap === "write.docusign") {
    return rec(item, "signature", "write.docusign", "docusign",
      "Chase Signature (DocuSign)",
      "Agent prepared the DocuSign chase; confirm to send the reminder.", true);
  }
  if (cap === "write.payment_link") {
    return rec(item, "collect_payment", "write.payment_link", "payment_link",
      "Send Payment Link",
      "Cure path — agent prepared the payment link; confirm to send.", true);
  }
  if (cap === "write.coi.issue") {
    return rec(item, "issue", "write.coi.issue", "coi_issue",
      "Issue COI",
      "Agent assembled the certificate from the binder; confirm to issue.", true);
  }

  switch (item.homeLane) {
    case "coi":
      return rec(item, "issue", "write.coi.issue", "coi_issue",
        "Issue COI",
        "Agent assembled the certificate from the binder; confirm to issue.", true);
    case "pending_orders":
    case "instant_binds":
      return rec(item, "signature", "write.docusign", "docusign",
        "Chase Signature (DocuSign)",
        "Bind is gated on signature; agent prepared the chase.", true);
    case "pending_cancels":
      return rec(item, "collect_payment", "write.payment_link", "payment_link",
        "Send Cure Payment Link",
        "Retention — agent prepared the cure payment link; confirm to send.", true);
    case "post_sales":
    case "active_service":
    case "subjectivities":
    case "communications":
    default:
      return rec(item, "send", "write.comms.email", "composer",
        `Send: ${item.nextActionLabel}`,
        "Agent prepared the outreach; review and confirm to send.", true);
  }
}

/**
 * Recommend the agent's next moves for a work item. Always leads with a draft
 * preparation (no send), then the primary guarded action, then a reminder so
 * nothing silently ages.
 */
export function recommendActions(item: WorkItem): DeskRecommendation[] {
  const out: DeskRecommendation[] = [];

  out.push(
    rec(item, "prepare_draft", "write.draft", "draft",
      "Prepare Draft",
      "Agent drafts the message with account + ticket context for your review."),
  );

  const primary = primaryRecommendation(item);
  out.push(primary);

  // A distinct chase leg for revenue/retention lanes where sending isn't the
  // primary (primary was a door), so the operator can also nudge by email.
  if (primary.capabilityId !== "write.comms.email") {
    out.push(
      rec(item, "chase", "write.comms.email", "composer",
        "Send Chase Email",
        "Agent prepared a chase; review and confirm to send."),
    );
  }

  out.push(
    rec(item, "reminder", "write.reminder", "reminder",
      "Set Wake / Reminder",
      "Agent will re-surface this item at the next wake if it stalls."),
  );

  return out;
}

/**
 * Attach a live capability gate to each recommendation. Server callers pass the
 * discovered gates (from `discoverCapabilities`) so the UI can render the exact
 * blocker instead of a dead control.
 */
export function attachGates(
  recs: DeskRecommendation[],
  gates: CapabilityGate[],
): GatedRecommendation[] {
  const byId = new Map(gates.map((g) => [g.id, g]));
  return recs.map((r) => {
    const g = byId.get(r.capabilityId);
    return {
      ...r,
      gateState: g?.state ?? "unavailable",
      blockerLabel: g?.blockerLabel ?? "Capability not registered",
      provider: g?.provider ?? "agent_tools",
    };
  });
}
