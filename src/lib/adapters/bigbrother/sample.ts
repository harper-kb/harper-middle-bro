import type { LaneSnapshot, ServiceLaneId, WorkItem } from "@/lib/types";

const NOW = "2026-08-10T20:00:00.000Z";

/** Labeled fixtures used when BigBrother credentials are absent or unreconciled. */
export function sampleWorkItemsForLane(lane: ServiceLaneId): WorkItem[] {
  const base = (partial: Omit<WorkItem, "homeLane" | "updatedAt">): WorkItem => ({
    ...partial,
    homeLane: lane,
    updatedAt: NOW,
  });

  switch (lane) {
    case "pending_orders":
      return [
        base({
          id: "sample:po:1",
          externalId: null,
          accountId: "acct-beacon",
          accountName: "Beacon Field Services",
          title: "G4 — Insured Sign Pending",
          summary: "DocuSign waiting on insured · sample mode",
          owner: { operatorId: null, displayName: "Unassigned", team: null },
          urgencyTier: "A",
          urgencyScore: 0.88,
          isOnFire: false,
          actionRequired: true,
          clock: {
            kind: "bind_deadline",
            at: "2026-08-12T00:00:00.000Z",
            label: "Sign by Aug 12",
            breached: false,
          },
          blocker: {
            code: "docusign",
            label: "Awaiting Insured Signature",
            capabilityId: "write.docusign",
          },
          nextActionLabel: "Chase Signature",
          priorityReasons: [
            { code: "urgency_tier", label: "Tier A" },
            { code: "action_required", label: "Action Required" },
          ],
          createdAt: "2026-08-08T12:00:00.000Z",
          parkedUntil: null,
          parkReason: null,
        }),
      ];
    case "pending_cancels":
      return [
        base({
          id: "sample:pc:1",
          externalId: null,
          accountId: "acct-apex",
          accountName: "Apex Roofing LLC",
          title: "Payment Failure — Cure Path",
          summary: "Cancellation risk · sample mode",
          owner: {
            operatorId: "op-sample",
            displayName: "Dana Whitfield",
            team: "Retention",
          },
          urgencyTier: "A",
          urgencyScore: 0.95,
          isOnFire: true,
          actionRequired: true,
          clock: {
            kind: "cancellation_effective",
            at: "2026-08-15T00:00:00.000Z",
            label: "Cancels Aug 15",
            breached: false,
          },
          blocker: {
            code: "payment",
            label: "Awaiting Payment",
            capabilityId: "write.payment_link",
          },
          nextActionLabel: "Send Cure Chase",
          priorityReasons: [
            { code: "fire_flag", label: "On Fire" },
            { code: "deadline", label: "Cancellation Effective" },
          ],
          createdAt: "2026-08-01T12:00:00.000Z",
          parkedUntil: null,
          parkReason: null,
        }),
      ];
    case "active_service":
      return [
        base({
          id: "sample:as:1",
          externalId: null,
          accountId: "acct-greenleaf",
          accountName: "Greenleaf Landscaping",
          title: "Address Change Endorsement",
          summary: "Non-revenue servicing · sample mode",
          owner: {
            operatorId: "op-sample",
            displayName: "Dana Whitfield",
            team: null,
          },
          urgencyTier: "B",
          urgencyScore: 0.55,
          isOnFire: false,
          actionRequired: false,
          clock: {
            kind: "sla",
            at: null,
            label: "2d in lane",
            breached: false,
          },
          blocker: null,
          nextActionLabel: "Draft Endorsement",
          priorityReasons: [{ code: "urgency_tier", label: "Tier B" }],
          createdAt: "2026-08-08T09:00:00.000Z",
          parkedUntil: null,
          parkReason: null,
        }),
      ];
    case "post_sales":
      return [
        base({
          id: "sample:ps:1",
          externalId: null,
          accountId: "acct-summit",
          accountName: "Summit Builders",
          title: "Umbrella Upsell — Remarket",
          summary: "Revenue-changing work · sample mode",
          owner: {
            operatorId: null,
            displayName: "Harris",
            team: "Post Sales",
          },
          urgencyTier: "B",
          urgencyScore: 0.6,
          isOnFire: false,
          actionRequired: true,
          clock: {
            kind: "follow_up",
            at: "2026-08-11T17:00:00.000Z",
            label: "Follow up today",
            breached: false,
          },
          blocker: null,
          nextActionLabel: "Send Quote",
          priorityReasons: [
            { code: "action_required", label: "Action Required" },
          ],
          createdAt: "2026-08-07T14:00:00.000Z",
          parkedUntil: null,
          parkReason: null,
        }),
      ];
    case "coi":
      return [
        base({
          id: "sample:coi:1",
          externalId: null,
          accountId: "acct-craft",
          accountName: "Craft Spirits Co",
          title: "COI — Blanket AI Holder",
          summary: "Certificate request · sample mode",
          owner: { operatorId: null, displayName: "Unassigned", team: "COI" },
          urgencyTier: "A",
          urgencyScore: 0.7,
          isOnFire: false,
          actionRequired: true,
          clock: {
            kind: "sla",
            at: "2026-08-10T22:00:00.000Z",
            label: "SLA 2h",
            breached: false,
          },
          blocker: null,
          nextActionLabel: "Issue COI",
          priorityReasons: [
            { code: "deadline", label: "SLA" },
            { code: "action_required", label: "Action Required" },
          ],
          createdAt: "2026-08-10T18:00:00.000Z",
          parkedUntil: null,
          parkReason: null,
        }),
      ];
    case "subjectivities":
    case "instant_binds":
    case "communications":
      return [
        base({
          id: `sample:${lane}:1`,
          externalId: null,
          accountId: "acct-bright",
          accountName: "Bright Path Logistics",
          title: `${lane.replace(/_/g, " ")} sample item`,
          summary: "Labeled sample — live adapter not reconciled",
          owner: { operatorId: null, displayName: "Unassigned", team: null },
          urgencyTier: "C",
          urgencyScore: 0.3,
          isOnFire: false,
          actionRequired: false,
          clock: {
            kind: "aged_backlog",
            at: null,
            label: "Aged backlog",
            breached: false,
          },
          blocker: null,
          nextActionLabel: "Open",
          priorityReasons: [{ code: "age", label: "Sample age" }],
          createdAt: "2026-07-01T12:00:00.000Z",
          parkedUntil: null,
          parkReason: null,
        }),
      ];
  }
}

export function sampleLaneSnapshot(
  lane: ServiceLaneId,
  reason: string,
): LaneSnapshot {
  const items = sampleWorkItemsForLane(lane);
  return {
    lane,
    mode: "sample",
    modeReason: reason,
    items,
    count: items.length,
    sourceCount: null,
    reconciled: false,
    fetchedAt: new Date().toISOString(),
    sourceApi: `sample://${lane}`,
  };
}
