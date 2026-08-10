import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { sampleWorkItemsForLane } from "@/lib/adapters/bigbrother/sample";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";
import {
  SERVICE_LANE_HREFS,
  SERVICE_LANE_LABELS,
  type ServiceLaneId,
} from "@/lib/types";

export async function renderSectionPage(lane: ServiceLaneId) {
  const operator = await getSessionOperator();
  const items = sampleWorkItemsForLane(lane);
  const mode = "sample" as const;
  const modeReason =
    "Section shell — BigBrother live flip lands after count reconciliation (PR 8+)";

  return (
    <div>
      <Nav active={SERVICE_LANE_HREFS[lane]} operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            {SERVICE_LANE_LABELS[lane]}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Lookup and triage only — work the next action in Desk. Rows stay
            compact (what, who, clock, blocker, action).
          </p>
        </div>
        <LaneModeBanner
          mode={mode}
          reason={modeReason}
          count={items.length}
          sourceCount={null}
        />
        <SectionLanePage
          lane={lane}
          mode={mode}
          modeReason={modeReason}
          items={items}
        />
      </main>
    </div>
  );
}
