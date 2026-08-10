import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { PendingOrdersStage } from "@/components/PendingOrdersStage";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PendingOrdersPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("pending_orders");

  return (
    <div>
      <Nav active="/pending-orders" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Pending Orders
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Order-grain G1–G6 checkout and bind progression. Compact rows;
            open Checkout on the account for depth.
          </p>
        </div>
        <LaneModeBanner
          mode={snapshot.mode}
          reason={snapshot.modeReason}
          count={snapshot.count}
          sourceCount={snapshot.sourceCount}
        />
        <PendingOrdersStage
          items={snapshot.items}
          mode={snapshot.mode}
          modeReason={snapshot.modeReason}
        />
      </main>
    </div>
  );
}
