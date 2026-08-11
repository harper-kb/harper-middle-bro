import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";
import {
  SERVICE_LANE_HREFS,
  SERVICE_LANE_LABELS,
  type ServiceLaneId,
} from "@/lib/types";

export async function renderSectionPage(lane: ServiceLaneId) {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot(lane);

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
          mode={snapshot.mode}
          reason={snapshot.modeReason}
          count={snapshot.count}
          sourceCount={snapshot.sourceCount}
        />
        <SectionLanePage
          lane={lane}
          mode={snapshot.mode}
          modeReason={snapshot.modeReason}
          items={snapshot.items}
        />
      </main>
    </div>
  );
}
