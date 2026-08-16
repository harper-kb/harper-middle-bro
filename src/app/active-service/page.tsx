import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import {
  ACTIVE_SERVICE_LABELS,
  activeServiceAction,
  classifyActiveService,
} from "@/lib/lanes/active-service";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";
import { sortWorkItems } from "@/lib/priority";

export const dynamic = "force-dynamic";

export default async function ActiveServicePage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("active_service");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const kind = classifyActiveService(item);
    return {
      ...item,
      title: `${ACTIVE_SERVICE_LABELS[kind]} — ${item.title}`,
      nextActionLabel: activeServiceAction(kind),
      summary: `${item.summary} · taxonomy ${kind}`,
    };
  });

  return (
    <div>
      <Nav active="/active-service" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">
            Active Service
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Non-revenue servicing. Claims only identify the carrier claims
            contact, email that information, and close.
          </p>
        </div>
        <LaneModeBanner
          mode={snapshot.mode}
          reason={snapshot.modeReason}
          count={items.length}
          sourceCount={snapshot.sourceCount}
        />
        <SectionLanePage
          lane="active_service"
          mode={snapshot.mode}
          modeReason={snapshot.modeReason}
          items={items}
        />
      </main>
    </div>
  );
}
