import Link from "next/link";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import { sampleWorkItemsForLane } from "@/lib/adapters/bigbrother/sample";
import { sortWorkItems } from "@/lib/priority";
import {
  SERVICE_LANE_LABELS,
  toWorkItemRow,
  type LaneDataMode,
  type ServiceLaneId,
  type WorkItem,
} from "@/lib/types";

/**
 * Compact section shell: one row per work item, five signals max.
 * Depth belongs in the split workspace (opened via account link).
 */
export function buildSectionStage(opts: {
  lane: ServiceLaneId;
  items: WorkItem[];
  mode: LaneDataMode;
  modeReason: string | null;
}): { items: DeskStageItem[]; views: Record<string, DeskStageView> } {
  const sorted = sortWorkItems(opts.items);
  const items: DeskStageItem[] = sorted.map((wi) => {
    const row = toWorkItemRow(wi, opts.mode);
    return {
      id: wi.id,
      meta: wi.urgencyTier === "none" ? "—" : `Tier ${wi.urgencyTier}`,
      dotClass: wi.isOnFire
        ? "bg-rose-500"
        : row.clockBreached
          ? "bg-amber-500"
          : "bg-emerald-500",
      dotTitle: wi.isOnFire ? "On Fire" : row.clockBreached ? "Breached" : "On Track",
      title: row.what,
      sub: [row.who, row.clock, row.blocker ?? "No Blocker", row.action].join(" · "),
      tabIds: [wi.urgencyTier === "none" ? "none" : wi.urgencyTier.toLowerCase()],
      searchText: [wi.title, wi.accountName, wi.summary, row.who, row.blocker ?? ""].join(
        " ",
      ),
    };
  });

  const views: Record<string, DeskStageView> = {};
  for (const wi of sorted) {
    const row = toWorkItemRow(wi, opts.mode);
    views[wi.id] = {
      header: (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{SERVICE_LANE_LABELS[opts.lane]}</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              {wi.accountName}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{wi.title}</p>
          </div>
          <Link
            href={`/accounts/${wi.accountId}`}
            className="btn-primary text-sm"
          >
            Open Account
          </Link>
        </div>
      ),
      panels: [
        {
          id: "signals",
          title: "Row Signals",
          subtitle: "Five signals max — depth opens in the account workspace",
          defaultOpen: true,
          content: (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  What
                </dt>
                <dd className="mt-0.5 text-[var(--ink)]">{row.what}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Who
                </dt>
                <dd className="mt-0.5 text-[var(--ink)]">{row.who}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Clock
                </dt>
                <dd className="mt-0.5 text-[var(--ink)]">{row.clock}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Blocker
                </dt>
                <dd className="mt-0.5 text-[var(--ink)]">{row.blocker ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Action
                </dt>
                <dd className="mt-0.5 text-[var(--ink)]">{row.action}</dd>
              </div>
            </dl>
          ),
        },
        {
          id: "why",
          title: "Why This Is Next",
          subtitle: opts.mode === "sample" ? "Sample Mode" : "Live",
          defaultOpen: true,
          content: (
            <ul className="space-y-1.5 text-sm text-[var(--ink)]">
              {wi.priorityReasons.map((r) => (
                <li key={`${r.code}-${r.label}`}>
                  <span className="font-semibold">{r.label}</span>
                  {r.detail ? (
                    <span className="text-[var(--muted)]"> — {r.detail}</span>
                  ) : null}
                </li>
              ))}
              {opts.modeReason ? (
                <li className="text-[var(--muted)]">{opts.modeReason}</li>
              ) : null}
            </ul>
          ),
        },
      ],
    };
  }

  return { items, views };
}

export function SectionLanePage({
  lane,
  mode = "sample",
  modeReason = "Section shell — live adapter wiring lands in later PRs",
  items,
}: {
  lane: ServiceLaneId;
  mode?: LaneDataMode;
  modeReason?: string | null;
  items?: WorkItem[];
}) {
  const workItems = items ?? sampleWorkItemsForLane(lane);
  const { items: stageItems, views } = buildSectionStage({
    lane,
    items: workItems,
    mode,
    modeReason,
  });

  return (
    <DeskStage
      railTitle={SERVICE_LANE_LABELS[lane]}
      searchPlaceholder="Search This Section…"
      tabs={[
        { id: "a", label: "Tier A" },
        { id: "b", label: "Tier B" },
        { id: "c", label: "Tier C" },
      ]}
      items={stageItems}
      views={views}
      emptyRailNote="No Work Items In This Section."
      emptyStageNote="Select A Row — Depth Opens Beside The Queue."
    />
  );
}
