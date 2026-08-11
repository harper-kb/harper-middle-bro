import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import { listIntakeEvents } from "@/lib/db";
import {
  COMM_HYGIENE_LABELS,
  classifyCommWorkItem,
  classifyIntakeHygiene,
} from "@/lib/lanes/communications";
import { sortWorkItems } from "@/lib/priority";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("communications");
  const intake = listIntakeEvents().filter((e) => e.status === "pending");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const hygiene = classifyCommWorkItem(item);
    return {
      ...item,
      title: `${COMM_HYGIENE_LABELS[hygiene]} — ${item.title}`,
      nextActionLabel:
        hygiene === "awaiting_response"
          ? "Mark Complete"
          : hygiene === "needs_ack"
            ? "Send Ack"
            : "Open Thread",
    };
  });

  const intakeSummary = intake.slice(0, 5).map((e) => ({
    id: e.id,
    label: `${e.channel} · ${classifyIntakeHygiene(e)} · ${e.fromName}`,
  }));

  return (
    <div>
      <Nav active="/communications" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Communications
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Account-centric thread desk — newest actionable inbound,
            ack/ticket/assignment signals, Complete / Awaiting Response, and
            missed-thread hygiene. Not a general Gmail clone.
          </p>
        </div>
        <LaneModeBanner mode={snapshot.mode} reason={snapshot.modeReason} count={items.length} sourceCount={snapshot.sourceCount} />
        {intakeSummary.length > 0 ? (
          <div className="mb-4 rounded-xl border border-[var(--rule)] bg-white px-4 py-3 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
              Local Intake (Pending)
            </p>
            <ul className="mt-2 space-y-1 text-[var(--ink)]">
              {intakeSummary.map((row) => (
                <li key={row.id}>{row.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <SectionLanePage lane="communications" mode={snapshot.mode} modeReason={snapshot.modeReason} items={items} />
      </main>
    </div>
  );
}
