import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import {
  FACET_LABELS,
  instantBindAction,
  instantBindBucket,
  instantBindFacet,
} from "@/lib/lanes/instant-binds";
import { sortWorkItems } from "@/lib/priority";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InstantBindsPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("instant_binds");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const bucket = instantBindBucket(item);
    const facet = instantBindFacet(item);
    return {
      ...item,
      title: `${bucket === "no_signature" ? "No Signature Needed" : "Signature Needed"} — ${item.title}`,
      summary: `${item.summary} · facet ${FACET_LABELS[facet]}`,
      nextActionLabel: instantBindAction(item),
      blocker:
        facet === "none"
          ? item.blocker
          : {
              code: facet,
              label: FACET_LABELS[facet],
              capabilityId: facet === "carrier_access" ? ("write.bind" as const) : item.blocker?.capabilityId ?? null,
            },
    };
  });

  return (
    <div>
      <Nav active="/instant-binds" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">Instant Binds</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Two buckets — No Signature Needed and Signature Needed — with
            facets for payment, subjectivities, re-rate, referral, and carrier
            access. RT Connector/Blitz portal bind stays a confirmed human action.
          </p>
        </div>
        <LaneModeBanner mode={snapshot.mode} reason={snapshot.modeReason} count={items.length} sourceCount={snapshot.sourceCount} />
        <SectionLanePage lane="instant_binds" mode={snapshot.mode} modeReason={snapshot.modeReason} items={items} />
      </main>
    </div>
  );
}
