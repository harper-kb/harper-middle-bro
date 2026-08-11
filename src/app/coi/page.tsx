import Link from "next/link";
import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import { COI_PATH_LABELS, classifyCoiPath, coiNextAction } from "@/lib/lanes/coi";
import { sortWorkItems } from "@/lib/priority";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CoiLanePage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("coi");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const path = classifyCoiPath(item);
    return {
      ...item,
      title: `${COI_PATH_LABELS[path]} — ${item.title}`,
      nextActionLabel: coiNextAction(path),
    };
  });

  return (
    <div>
      <Nav active="/coi" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Section</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">COI</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Certificate request queue with binder-to-COI, blanket fast paths,
              holder/wording review, and issue/send confirmation.
            </p>
          </div>
          <Link href="/certificates" className="btn-ghost text-sm">
            Certificate Studio Index
          </Link>
        </div>
        <LaneModeBanner mode={snapshot.mode} reason={snapshot.modeReason} count={items.length} sourceCount={snapshot.sourceCount} />
        <SectionLanePage lane="coi" mode={snapshot.mode} modeReason={snapshot.modeReason} items={items} />
      </main>
    </div>
  );
}
