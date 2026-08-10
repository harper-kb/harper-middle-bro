import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import {
  CANCEL_REASON_LABELS,
  cancelRetentionAction,
  classifyCancelReason,
} from "@/lib/lanes/pending-cancels";
import { sortWorkItems } from "@/lib/priority";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PendingCancelsPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("pending_cancels");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const reason = classifyCancelReason(item);
    return {
      ...item,
      title: `${CANCEL_REASON_LABELS[reason]} — ${item.title}`,
      nextActionLabel: cancelRetentionAction(reason),
      clock: {
        ...item.clock,
        kind: "cancellation_effective" as const,
        label: item.clock.label.startsWith("Cancel")
          ? item.clock.label
          : `Cancels · ${item.clock.label}`,
      },
    };
  });

  return (
    <div>
      <Nav active="/pending-cancels" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Pending Cancels
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Cancellation-effective-date priority, retention/cure sequences,
            financing rules, and premium at risk. Bulk chases land in actions.
          </p>
        </div>
        <LaneModeBanner
          mode={snapshot.mode}
          reason={snapshot.modeReason}
          count={items.length}
          sourceCount={snapshot.sourceCount}
        />
        <SectionLanePage
          lane="pending_cancels"
          mode={snapshot.mode}
          modeReason={snapshot.modeReason}
          items={items}
        />
      </main>
    </div>
  );
}
