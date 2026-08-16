import Link from "next/link";
import { Nav } from "@/components/Nav";
import { getRequestType } from "@/lib/catalog";
import { listTickets } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { CoiBenchStudio, type CoiTicket } from "./CoiBenchStudio";

export const dynamic = "force-dynamic";

function ageLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "today";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default async function CoiBenchPage() {
  const operator = await getSessionOperator();

  // The bench reads the tickets table directly: every open service request is
  // certificate work on this desk (AI / WOS / blanket / limits / notices).
  const tickets: CoiTicket[] = listTickets({ openOnly: true }).map((t) => {
    const def = getRequestType(t.requestType);
    return {
      id: t.id,
      srNumber: t.srNumber,
      requestType: t.requestType,
      requestTypeLabel: def.label,
      title: t.title,
      subject: t.subject,
      accountId: t.accountId,
      accountName: t.account.name,
      holderName: t.holderName,
      holderAddress: t.holderAddress,
      wording: t.wording,
      status: t.status,
      requestedBy: t.requestedBy,
      requestedByEmail: t.requestedByEmail,
      source: t.source,
      createdAt: t.createdAt,
      age: ageLabel(t.createdAt),
      policies: t.policies.map((p) => ({
        id: p.id,
        policyNumber: p.policyNumber,
        carrier: p.carrier,
        coverages: p.coverages,
      })),
    };
  });

  return (
    <div>
      <Nav active="/coi" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Section</p>
            <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">COI Studio</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Every pending certificate request on the book. Open a ticket to
              build its ACORD certificate from the schedule of record —
              generate, review field by field, correct, and download.
            </p>
          </div>
          <Link href="/certificates" className="btn-ghost text-sm">
            Certificate Studio Index
          </Link>
        </div>
        <CoiBenchStudio tickets={tickets} />
      </main>
    </div>
  );
}
