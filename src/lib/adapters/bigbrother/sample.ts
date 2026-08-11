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
    case "instant_binds":
      return [
        {
          id: "cobalt",
          accountName: "Cobalt Mechanical",
          title: "Coterie IQ Bind — Payment Confirmed",
          summary: "Coterie quote ready to bind · no signature required · sample mode",
          createdAt: "2026-07-28T09:00:00.000Z",
          blocker: null,
          action: "Confirm IQ Bind",
        },
        {
          id: "northstar",
          accountName: "Northstar Electric",
          title: "RT Connector IQ Bind",
          summary: "RT Connector portal bind · insured signature pending · sample mode",
          createdAt: "2026-07-30T14:00:00.000Z",
          blocker: "Awaiting Insured Signature",
          action: "Chase Signature",
        },
        {
          id: "redwood",
          accountName: "Redwood Fitness Group",
          title: "Blitz IQ Bind",
          summary: "Blitz carrier portal access confirmed · sample mode",
          createdAt: "2026-08-01T11:00:00.000Z",
          blocker: "Carrier Portal Access",
          action: "Confirm Portal Bind",
        },
        {
          id: "harbor",
          accountName: "Harbor Light Studios",
          title: "Coalition IQ Bind — Subjectivity Clear",
          summary: "Coalition quote ready · no signature required · sample mode",
          createdAt: "2026-08-02T16:00:00.000Z",
          blocker: null,
          action: "Confirm IQ Bind",
        },
        {
          id: "mesa",
          accountName: "Mesa Food Works",
          title: "Pathpoint IQ Bind",
          summary: "Path Point bind requires insured signature · sample mode",
          createdAt: "2026-08-04T08:30:00.000Z",
          blocker: "DocuSign Pending",
          action: "Chase Signature",
        },
        {
          id: "juniper",
          accountName: "Juniper Event Co",
          title: "Thimble IQ Bind",
          summary: "Thimble bind requires signed acceptance · sample mode",
          createdAt: "2026-08-05T13:00:00.000Z",
          blocker: "Awaiting Insured Signature",
          action: "Chase Signature",
        },
        {
          id: "bluebird",
          accountName: "Bluebird Janitorial",
          title: "ISC Workers’ Comp IQ Bind",
          summary: "Insurance Services Center WC bind · signature required · sample mode",
          createdAt: "2026-08-07T10:00:00.000Z",
          blocker: "Awaiting Insured Signature",
          action: "Chase Signature",
        },
        {
          id: "oak",
          accountName: "Oak & Stone Design",
          title: "Next Insurance IQ Bind",
          summary: "Next quote ready · payment confirmed · no signature required · sample mode",
          createdAt: "2026-08-09T15:00:00.000Z",
          blocker: null,
          action: "Confirm IQ Bind",
        },
      ].map((fixture, index) =>
        base({
          id: `sample:instant_binds:${index + 1}`,
          externalId: null,
          accountId: `acct-${fixture.id}`,
          accountName: fixture.accountName,
          title: fixture.title,
          summary: fixture.summary,
          owner:
            index % 3 === 0
              ? { operatorId: "op-sample", displayName: "Dana Whitfield", team: "Binds" }
              : { operatorId: null, displayName: "Unassigned", team: "Binds" },
          urgencyTier: index < 3 ? "A" : index < 6 ? "B" : "C",
          urgencyScore: 0.9 - index * 0.07,
          isOnFire: false,
          actionRequired: true,
          clock: {
            kind: "bind_deadline",
            at: null,
            label: `${13 - index * 2}d pending`,
            breached: index < 3,
          },
          blocker: fixture.blocker
            ? {
                code: fixture.blocker.toLowerCase().replace(/\s+/g, "_"),
                label: fixture.blocker,
                capabilityId: fixture.blocker.includes("Signature")
                  ? "write.docusign"
                  : fixture.blocker.includes("Portal")
                    ? "write.bind"
                    : null,
              }
            : null,
          nextActionLabel: fixture.action,
          priorityReasons: [
            { code: "age", label: `${13 - index * 2}d pending` },
            { code: "action_required", label: "Action Required" },
          ],
          createdAt: fixture.createdAt,
          parkedUntil: null,
          parkReason: null,
        }),
      );
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
