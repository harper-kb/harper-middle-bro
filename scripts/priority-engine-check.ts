/**
 * Priority engine + BigBrother parity fixtures.
 * Run: npx tsx scripts/priority-engine-check.ts
 */
import {
  AGED_BACKLOG_DAYS,
  compareBbParityRows,
  pickNextWorkItem,
  partitionByShelf,
  sortWorkItems,
  type BbParityRow,
} from "../src/lib/priority";
import { buildLaneClock } from "../src/lib/priority/clocks";
import type { WorkItem } from "../src/lib/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// —— BB parity: fire → tier → score → action → age → name ——
const rows: BbParityRow[] = [
  { name: "Zulu Cold", tier: "A", score: 0.9, daysStuck: 10 },
  { name: "Alpha Fire", tier: "C", score: 0.1, daysStuck: 1, isOnFire: true },
  { name: "Beta A high", tier: "A", score: 0.95, daysStuck: 2 },
  { name: "Gamma A low", tier: "A", score: 0.5, daysStuck: 8, actionRequired: true },
  { name: "Delta B action", tier: "B", score: 0.7, daysStuck: 3, actionRequired: true },
  { name: "Echo B wait", tier: "B", score: 0.7, daysStuck: 5 },
];

const ordered = [...rows].sort(compareBbParityRows).map((r) => r.name);
check(
  "Fire floats above tier A",
  ordered[0] === "Alpha Fire",
  ordered.join(" > "),
);
check(
  "Within A, higher score wins before age",
  ordered.indexOf("Beta A high") < ordered.indexOf("Gamma A low"),
);
check(
  "Within B, action_required before waiting",
  ordered.indexOf("Delta B action") < ordered.indexOf("Echo B wait"),
);

// Cancellation deadline beats generic age within same tier/score/action
const cancelSoon: BbParityRow = {
  name: "Soon Cancel",
  tier: "A",
  score: 0.8,
  daysStuck: 1,
  deadlineAt: "2026-08-12T00:00:00.000Z",
};
const cancelLater: BbParityRow = {
  name: "Later Cancel",
  tier: "A",
  score: 0.8,
  daysStuck: 10,
  deadlineAt: "2026-08-20T00:00:00.000Z",
};
check(
  "Sooner cancellation deadline wins over older age",
  compareBbParityRows(cancelSoon, cancelLater) < 0,
);

function wi(partial: Partial<WorkItem> & Pick<WorkItem, "id" | "accountName" | "title">): WorkItem {
  return {
    externalId: null,
    homeLane: "active_service",
    accountId: partial.id,
    summary: "",
    owner: { operatorId: null, displayName: null, team: null },
    urgencyTier: "B",
    urgencyScore: 0.5,
    isOnFire: false,
    actionRequired: false,
    clock: { kind: "sla", at: null, label: "ok", breached: false },
    blocker: null,
    nextActionLabel: "Open",
    priorityReasons: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    parkedUntil: null,
    parkReason: null,
    ...partial,
  };
}

const now = new Date("2026-08-10T12:00:00.000Z");
const items = [
  wi({
    id: "old",
    accountName: "Old Co",
    title: "Aged",
    createdAt: "2026-07-01T00:00:00.000Z",
    urgencyTier: "C",
  }),
  wi({
    id: "breach",
    accountName: "Breach Co",
    title: "Breached",
    createdAt: "2026-08-08T00:00:00.000Z",
    urgencyTier: "A",
    clock: { kind: "sla", at: "2026-08-09T00:00:00.000Z", label: "Breached", breached: true },
  }),
  wi({
    id: "hot",
    accountName: "Hot Co",
    title: "Fire",
    isOnFire: true,
    urgencyTier: "C",
    createdAt: "2026-08-09T00:00:00.000Z",
  }),
  wi({
    id: "parked",
    accountName: "Parked Co",
    title: "Parked",
    urgencyTier: "A",
    isOnFire: true,
    parkedUntil: "2026-08-11T00:00:00.000Z",
    createdAt: "2026-08-09T00:00:00.000Z",
  }),
];

const sorted = sortWorkItems(items, now);
check("Next after sort is on-fire (non-parked)", sorted[0].id === "hot");
check("Parked sinks below active", sorted[sorted.length - 1].id === "parked");

const next = pickNextWorkItem(items, { now });
check("pickNextWorkItem skips parked fire", next?.id === "hot");

const shelves = partitionByShelf(items, now);
check(
  "Aged backlog shelf catches very old non-fire work",
  shelves.agedBacklog.some((i) => i.id === "old") &&
    shelves.agedBacklog.every((i) => {
      const days = Math.floor(
        (now.getTime() - Date.parse(i.createdAt)) / 86_400_000,
      );
      return days >= AGED_BACKLOG_DAYS || i.id === "old";
    }),
);
check(
  "Loud breach shelf includes recent breach",
  shelves.loudBreach.some((i) => i.id === "breach"),
);

const cancelClock = buildLaneClock({
  lane: "pending_cancels",
  createdAt: "2026-08-01T00:00:00.000Z",
  cancellationEffectiveAt: "2026-08-15T00:00:00.000Z",
  now,
});
check(
  "Cancellation effective overrides generic lane clock",
  cancelClock.kind === "cancellation_effective" && cancelClock.breached === false,
);

const coiClock = buildLaneClock({
  lane: "coi",
  createdAt: "2026-08-10T00:00:00.000Z",
  now: new Date("2026-08-10T03:00:00.000Z"),
});
check("COI 2h clock breaches after 3h", coiClock.breached === true);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll priority engine checks passed.");
