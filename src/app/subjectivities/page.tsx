import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import { subjectivityBucket, subjectivityElevated } from "@/lib/lanes/subjectivities";
import { sortWorkItems } from "@/lib/priority";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SubjectivitiesPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("subjectivities");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const bucket = subjectivityBucket(item);
    const elevated = subjectivityElevated(item);
    return {
      ...item,
      title: `${bucket === "pre_bind" ? "Pre-Bind" : "Post-Bind"}${elevated ? " · Cancel Risk" : ""} — ${item.title}`,
      isOnFire: item.isOnFire || elevated,
    };
  });

  return (
    <div>
      <Nav active="/subjectivities" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">Subjectivities</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Pre-bind and Post-bind buckets. Cancellation-risk post-bind items
            are elevated. Show evidence, owner, chase legs, deadline, receipt.
          </p>
        </div>
        <LaneModeBanner mode={snapshot.mode} reason={snapshot.modeReason} count={items.length} sourceCount={snapshot.sourceCount} />
        <SectionLanePage lane="subjectivities" mode={snapshot.mode} modeReason={snapshot.modeReason} items={items} />
      </main>
    </div>
  );
}
