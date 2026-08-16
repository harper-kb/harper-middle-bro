import Link from "next/link";
import { notFound } from "next/navigation";
import { DeskBrain } from "@/components/DeskBrain";
import { EscalationPanel } from "./EscalationPanel";
import { Nav } from "@/components/Nav";
import { TicketActivity } from "./TicketActivity";
import { TicketAdditionalInsureds } from "@/components/TicketAdditionalInsureds";
import { TicketCertificate } from "./TicketCertificate";
import { TicketComms } from "./TicketComms";
import { TicketCoverages } from "./TicketCoverages";
import { TicketFiles } from "./TicketFiles";
import { TicketPipeline } from "./TicketPipeline";
import { claimTicketAction, setTicketStatusAction } from "@/lib/actions";
import { getRequestType } from "@/lib/catalog";
import {
  getAccountAdditionalInsureds,
  getTicketDetail,
  getTicketDocuments,
  listDecisions,
  listOperators,
  listQuoteSamples,
  listUnderwriters,
} from "@/lib/db";
import { buildDeskBrainBundle } from "@/lib/desk-brain";
import { getPolicyFormSet } from "@/lib/forms";
import { summarizeQuotes } from "@/lib/price-guidance";
import { buildTicketDraft } from "@/lib/draft";
import { formatMoney, relativeAge } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import {
  ticketSourceLabel,
  ticketStatusLabel,
} from "@/lib/tickets";
import { AUTO_APPROVE_THRESHOLD_CENTS, type TicketStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "coverages", label: "Coverages" },
  { id: "files", label: "Files" },
  { id: "additional-insureds", label: "Additional Insureds" },
  { id: "comms", label: "Comms" },
  { id: "certificate", label: "Certificate" },
  { id: "activity", label: "Activity" },
] as const;

function StatusButton({
  ticketId,
  status,
  label,
}: {
  ticketId: string;
  status: TicketStatus;
  label: string;
}) {
  return (
    <form action={setTicketStatusAction}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="btn-ghost text-xs">
        {label}
      </button>
    </form>
  );
}

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }, operator] = await Promise.all([
    params,
    searchParams,
    getSessionOperator(),
  ]);
  const ticket = getTicketDetail(id);
  if (!ticket) notFound();

  const carrierDesks = listUnderwriters();
  const operators = listOperators();
  const owner = ticket.operatorId
    ? (operators.find((o) => o.id === ticket.operatorId) ?? null)
    : null;
  const active = TABS.some((t) => t.id === tab) ? tab! : "coverages";

  const drafts = ticket.policies.map((policy) =>
    buildTicketDraft({
      ticket,
      account: ticket.account,
      policy,
      carrierDesks,
      operator,
    }),
  );

  const documents = getTicketDocuments(ticket.id);
  const aiRows = getAccountAdditionalInsureds(ticket.accountId);
  const answered = [...ticket.threads]
    .reverse()
    .find((t) => t.offeredPremiumCents != null);
  const certReady =
    ticket.status === "ready_to_issue" ||
    (answered?.offeredPremiumCents ?? null) === 0;

  // Desk Brain context — plain serializable data, assembled server-side so
  // the client panel answers deterministically without touching the db.
  const quoteSamples = listQuoteSamples();
  const brainBundle = buildDeskBrainBundle({
    account: ticket.account,
    formSets: Object.fromEntries(
      ticket.account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
    ),
    ticket,
    ticketThreads: ticket.threads,
    decisions: listDecisions({ ticketId: ticket.id }).map((d) => ({
      headline: d.headline,
      kind: d.kind,
      createdAt: d.createdAt,
    })),
    quoteSamples,
  });

  return (
    <>
      <Nav active="/tickets" operator={operator} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href="/queue"
          className="text-xs text-[var(--muted)] hover:underline"
        >
          ← Ticket Queue
        </Link>

        <header className="mt-3 border-b border-[var(--rule)] pb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-sm tracking-tight text-[var(--coral)]">
                {ticket.srNumber || "SR Pending"}
              </p>
              <h1 className="page-title mt-1 text-[clamp(2rem,4vw,2.75rem)] text-[var(--ink)]">
                {ticket.account.name}
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">{ticket.subject}</p>
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                {getRequestType(ticket.requestType).label}
                {" · "}
                {ticketStatusLabel(ticket.status)}
                {" · "}
                {ticketSourceLabel(ticket.source)}
                {" · "}
                {relativeAge(ticket.createdAt)}
              </p>
            </div>

            <div className="shrink-0 text-right">
              {answered?.offeredPremiumCents != null && (
                <p
                  className={`font-display text-2xl ${
                    answered.offeredPremiumCents === 0
                      ? "text-[var(--ink)]"
                      : answered.offeredPremiumCents >
                          AUTO_APPROVE_THRESHOLD_CENTS
                        ? "text-[var(--coral)]"
                        : "text-[var(--ink)]"
                  }`}
                >
                  {answered.offeredPremiumCents === 0
                    ? "No Charge"
                    : formatMoney(answered.offeredPremiumCents)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {drafts.map((d) => (
              <div
                key={d.policy.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--rule)] pt-3 text-xs"
              >
                <span className="font-mono text-[var(--ink)]">
                  {d.policy.policyNumber} · {d.policy.carrier}
                </span>
                <span className="text-[var(--muted)]">
                  {d.underwriter
                    ? `${d.underwriter.name} · ${d.underwriter.serviceEmail ?? d.underwriter.email}`
                    : "No Desk On File"}
                </span>
              </div>
            ))}
          </div>

          {ticket.holderName && (
            <p className="mt-4 text-xs text-[var(--muted)]">
              Holder:{" "}
              <span className="font-medium text-[var(--ink)]">
                {ticket.holderName}
              </span>
              {ticket.holderAddress ? ` — ${ticket.holderAddress}` : ""}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {operator && ticket.operatorId !== operator.id && (
              <form action={claimTicketAction}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <button
                  type="submit"
                  className="btn-primary px-4 py-1.5 text-xs"
                >
                  Claim {ticket.srNumber || "Ticket"}
                </button>
              </form>
            )}
            {ticket.status === "ready_to_issue" && (
              <StatusButton
                ticketId={ticket.id}
                status="delivered"
                label="Mark Delivered"
              />
            )}
            {ticket.status === "delivered" && (
              <StatusButton
                ticketId={ticket.id}
                status="closed"
                label="Close Ticket"
              />
            )}
            {(ticket.status === "delivered" || ticket.status === "closed") && (
              <StatusButton
                ticketId={ticket.id}
                status="needs_you"
                label="Reopen"
              />
            )}
            <span className="ml-auto text-[11px] text-[var(--muted)]">
              {owner
                ? `Owned by ${owner.id === operator?.id ? "you" : owner.displayName}`
                : "Unclaimed"}
            </span>
          </div>
        </header>

        <div className="mt-6">
          <TicketPipeline ticket={ticket} />
        </div>

        <div className="mt-4">
          <EscalationPanel
            ticket={ticket}
            operators={operators}
            currentOperatorId={operator?.id ?? null}
          />
        </div>

        <nav className="mt-6 flex flex-wrap gap-0 border-b border-[var(--rule)]">
          {TABS.map((t) => {
            const on = t.id === active;
            return (
              <Link
                key={t.id}
                href={`/tickets/${ticket.id}?tab=${t.id}`}
                className={`relative px-3.5 py-3 text-xs font-medium transition ${
                  on
                    ? "text-[var(--ink)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t.label}
                {t.id === "certificate" && certReady && (
                  <span className="ml-1.5 font-mono text-[9px] text-[var(--gold)]">
                    READY
                  </span>
                )}
                {t.id === "files" && documents.length > 0 && (
                  <span className="ml-1.5 font-mono text-[9px] text-[var(--muted)]">
                    {documents.length}
                  </span>
                )}
                {on && (
                  <span className="absolute inset-x-3 bottom-0 h-px bg-[var(--accent)]" />
                )}
              </Link>
            );
          })}
          <Link
            href={`/trace?ticket=${ticket.id}`}
            className="ml-auto px-3.5 py-3 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Trace
          </Link>
        </nav>

        <div className="mt-8">
          {active === "coverages" && (
            <TicketCoverages policies={ticket.policies} />
          )}
          {active === "files" && <TicketFiles documents={documents} />}
          {active === "additional-insureds" && (
            <TicketAdditionalInsureds
              rows={aiRows}
              accountId={ticket.accountId}
            />
          )}
          {active === "comms" && (
            <TicketComms ticket={ticket} drafts={drafts} operator={operator} />
          )}
          {active === "certificate" && (
            <TicketCertificate
              ticket={ticket}
              operator={operator}
              guidance={summarizeQuotes(quoteSamples)}
            />
          )}
          {active === "activity" && <TicketActivity ticket={ticket} />}
        </div>

        <div className="mt-10">
          <DeskBrain bundle={brainBundle} />
        </div>
      </main>
    </>
  );
}
