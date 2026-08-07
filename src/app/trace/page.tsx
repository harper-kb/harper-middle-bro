import Link from "next/link";
import { Nav } from "@/components/Nav";
import { TraceExplorer } from "@/components/TraceExplorer";
import { listDecisions, listTickets } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { buildTraceOverview, buildTraceViews } from "@/lib/trace-view";

export const dynamic = "force-dynamic";

export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  const sp = await searchParams;
  const operator = await getSessionOperator();

  const tickets = listTickets();
  const decisions = listDecisions();
  const { rows, ticketViews } = buildTraceViews(tickets, decisions);
  const overview = buildTraceOverview(tickets, decisions);

  const asked = sp.ticket ?? null;
  const focused = asked && ticketViews.some((t) => t.id === asked) ? asked : null;
  const askedButEmpty = asked != null && focused == null;
  const askedTicket = askedButEmpty
    ? (tickets.find((t) => t.id === asked) ?? null)
    : null;

  return (
    <>
      <Nav active="/trace" operator={operator} />
      <main className="trace-shell relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
        <div className="trace-shell-glow" aria-hidden />
        <div className="relative mx-auto max-w-[1600px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
          <header className="mb-8 max-w-3xl">
            <p className="eyebrow text-[var(--gold)]">Manager Review</p>
            <h1 className="mt-2 font-display text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] tracking-[-0.03em] text-[var(--ink)]">
              Trace
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
              Start wide, with the whole desk in one lane per carrier, then
              zoom into a ticket&apos;s network map, its thread, and the
              automation&apos;s step-by-step reasoning. The breadcrumb always
              shows where you are.
            </p>
          </header>

          {askedButEmpty && (
            <div className="trace-empty-callout mb-8">
              <p>
                Nothing has been decided on{" "}
                <span className="font-medium text-[var(--ink)]">
                  {askedTicket?.srNumber
                    ? `${askedTicket.srNumber} · ${askedTicket.account.name}`
                    : (askedTicket?.account.name ?? "that ticket")}
                </span>{" "}
                yet — it has not gone to a market.
              </p>
              {askedTicket && (
                <Link
                  href={`/tickets/${askedTicket.id}`}
                  className="mt-3 inline-block text-sm font-medium text-[var(--coral)] hover:underline"
                >
                  Open {askedTicket.srNumber || "the ticket"} →
                </Link>
              )}
            </div>
          )}

          <TraceExplorer
            rows={rows}
            tickets={ticketViews}
            overview={overview}
            initialTicketId={focused}
          />
        </div>
      </main>
    </>
  );
}
