import { AllTicketsBoard } from "@/components/AllTicketsBoard";
import { Nav } from "@/components/Nav";
import { loadAllLaneSnapshots } from "@/lib/adapters/bigbrother/lane-registry";
import { sortTicketsOldestFirst } from "@/lib/all-tickets";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AllTicketsPage() {
  const operator = await getSessionOperator();
  const snapshots = await loadAllLaneSnapshots();
  const items = sortTicketsOldestFirst(
    snapshots.flatMap((snapshot) => snapshot.items),
  );
  const sampleReasons = [
    ...new Set(
      snapshots
        .filter((snapshot) => snapshot.mode === "sample")
        .map((snapshot) => snapshot.modeReason)
        .filter((reason): reason is string => Boolean(reason)),
    ),
  ];

  return (
    <div>
      <Nav active="/all-tickets" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Resolve Work</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">All Tickets</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Open work across all seven sections, oldest first. Filter by
              ownership, breach state, or section; open a row to resolve it in
              the account workspace.
            </p>
          </div>
          <p className="font-display text-2xl text-[var(--ink)]">{items.length} open</p>
        </div>
        {sampleReasons.length > 0 ? (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--ink)]">
            <span className="font-semibold">Sample Mode</span> —{" "}
            {sampleReasons.join("; ")}
          </div>
        ) : null}
        <AllTicketsBoard
          items={items}
          operatorId={operator?.id ?? null}
          now={new Date().toISOString()}
        />
      </main>
    </div>
  );
}

