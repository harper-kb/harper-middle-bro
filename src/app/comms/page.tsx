import Link from "next/link";
import { Nav } from "@/components/Nav";
import { CommsEmails } from "./CommsEmails";
import { CommsSignals } from "./CommsSignals";
import type { MassTextRecipient } from "./CommsMassText";
import { PhoneDesk } from "./PhoneDesk";
import { ServiceInbox } from "./ServiceInbox";
import { TriageDigest } from "./TriageDigest";
import { SERVICE_MAILBOX } from "@/lib/brand";
import { REQUEST_TYPES } from "@/lib/catalog";
import { getCommsSignals, listComms } from "@/lib/comms";
import {
  getTicketDetail,
  listAccounts,
  listIntakeEvents,
  listUnderwriters,
} from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { buildTriageDigest } from "@/lib/triage-digest";
import type { IntakeEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

const VIEWS = [
  { id: "inbox", label: "Service Inbox" },
  { id: "phone", label: "Quo Phone" },
  { id: "digest", label: "Hourly Digest" },
  { id: "emails", label: "Emails" },
  { id: "signals", label: "Signals" },
] as const;

const VIEW_BLURBS: Record<string, string> = {
  inbox: `The direct service mailbox, thread by thread — every inbound email to ${SERVICE_MAILBOX} with its acknowledgment story.`,
  phone:
    "The Quo phone desk — every call with its transcript, every text, and mass text at scale.",
  digest:
    "The hourly ledger of missed calls and unanswered communications, sorted by wait time, so nothing goes unanswered for days.",
  emails: `Every message Harper sent or received from ${SERVICE_MAILBOX}, measured against the ticket that produced it.`,
  signals: `Every message Harper sent or received from ${SERVICE_MAILBOX}, measured against the ticket that produced it.`,
};

/** Account id → name for chips across the intake views. */
function accountNames(): Record<string, string> {
  return Object.fromEntries(listAccounts().map((a) => [a.id, a.name]));
}

/** Ticket id → SR number for the events that already produced a ticket. */
function srNumbers(events: IntakeEvent[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const ticketId of new Set(
    events.flatMap((e) => (e.ticketId ? [e.ticketId] : [])),
  )) {
    const ticket = getTicketDetail(ticketId);
    if (ticket) map[ticketId] = ticket.srNumber;
  }
  return map;
}

export default async function CommsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    email?: string;
    q?: string;
    carrier?: string;
    uw?: string;
    type?: string;
    direction?: string;
    mine?: string;
  }>;
}) {
  const [sp, operator] = await Promise.all([
    searchParams,
    getSessionOperator(),
  ]);
  const view = VIEWS.some((v) => v.id === sp.view) ? sp.view! : "inbox";
  const mine = sp.mine === "1" && Boolean(operator);

  return (
    <>
      <Nav active="/comms" operator={operator} />
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">The Service Desk, Market And Client Side</p>
            <Link
              href="/samples/comms"
              className="chip mt-1.5 transition hover:border-[var(--coral)] hover:text-[var(--coral)]"
            >
              Preview New Layout
            </Link>
            <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">
              Communications
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              {VIEW_BLURBS[view]}
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-1.5">
            {VIEWS.map((v) => (
              <Link
                key={v.id}
                href={`/comms?view=${v.id}`}
                className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                  v.id === view
                    ? "bg-[var(--ink)] text-white"
                    : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
                }`}
              >
                {v.label}
              </Link>
            ))}
          </nav>
        </div>

        {view === "inbox" && <InboxSection selectedId={sp.email} />}
        {view === "phone" && <PhoneSection />}
        {view === "digest" && <DigestSection />}
        {view === "emails" && (
          <MarketEmailsSection sp={sp} mine={mine} operatorId={operator?.id} />
        )}
        {view === "signals" && <CommsSignals signals={getCommsSignals()} />}
      </main>
    </>
  );
}

// ————————————————— Service Inbox —————————————————

function InboxSection({ selectedId }: { selectedId?: string }) {
  const emails = listIntakeEvents().filter((e) => e.channel === "email");
  const selected =
    emails.find((e) => e.id === selectedId) ?? emails[0] ?? null;

  return (
    <ServiceInbox
      emails={emails}
      selected={selected}
      accountNamesById={accountNames()}
      srByTicketId={srNumbers(emails)}
    />
  );
}

// ————————————————— Quo Phone —————————————————

function PhoneSection() {
  const events = listIntakeEvents();
  const calls = events.filter((e) => e.channel === "call");
  const texts = events.filter((e) => e.channel === "text");

  // Distinct phone-number senders (texts + calls), newest first.
  const names = accountNames();
  const seen = new Set<string>();
  const recipients: MassTextRecipient[] = [];
  for (const e of events) {
    if (e.channel === "email") continue;
    if (seen.has(e.fromContact)) continue;
    seen.add(e.fromContact);
    recipients.push({
      name: e.fromName,
      number: e.fromContact,
      account: e.accountId ? (names[e.accountId] ?? e.accountId) : null,
    });
  }

  return (
    <PhoneDesk
      calls={calls}
      texts={texts}
      accountNamesById={names}
      srByTicketId={srNumbers([...calls, ...texts])}
      recipients={recipients}
    />
  );
}

// ————————————————— Hourly Digest —————————————————

function DigestSection() {
  const digest = buildTriageDigest(
    listIntakeEvents(),
    new Date().toISOString(),
  );
  return <TriageDigest digest={digest} accountNamesById={accountNames()} />;
}

// ————————————————— Everything Market-Facing (the original page) —————————————————

function MarketEmailsSection({
  sp,
  mine,
  operatorId,
}: {
  sp: {
    q?: string;
    carrier?: string;
    uw?: string;
    type?: string;
    direction?: string;
  };
  mine: boolean;
  operatorId?: string;
}) {
  const desks = listUnderwriters();
  const carriers = [...new Set(desks.map((d) => d.carrier))].sort();

  const rows = listComms({
    q: sp.q,
    carrier: sp.carrier,
    underwriterId: sp.uw,
    requestType: sp.type,
    direction: sp.direction as "all" | "outbound" | "inbound" | undefined,
    operatorId: mine ? operatorId : undefined,
  });

  return (
    <>
      <div className="mb-4">
        <p className="eyebrow">Everything Market-Facing</p>
      </div>
      <form action="/comms" className="mb-5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value="emails" />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search subject, body, account, or desk"
          className="field max-w-xs"
        />
        <select
          name="carrier"
          defaultValue={sp.carrier ?? "all"}
          className="field max-w-[160px] text-xs"
        >
          <option value="all">All Carriers</option>
          {carriers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="uw"
          defaultValue={sp.uw ?? "all"}
          className="field max-w-[180px] text-xs"
        >
          <option value="all">All Desks</option>
          {desks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={sp.type ?? "all"}
          className="field max-w-[180px] text-xs"
        >
          <option value="all">All Request Types</option>
          {REQUEST_TYPES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          name="direction"
          defaultValue={sp.direction ?? "all"}
          className="field max-w-[130px] text-xs"
        >
          <option value="all">Both Ways</option>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        {operatorId && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <input type="checkbox" name="mine" value="1" defaultChecked={mine} />
            Mine
          </label>
        )}
        <button type="submit" className="btn-ghost text-xs">
          Filter
        </button>
        <Link
          href="/comms?view=emails"
          className="text-xs text-[var(--muted)] hover:underline"
        >
          Clear
        </Link>
      </form>

      <p className="mb-3 px-1 text-xs tabular-nums text-[var(--muted)]">
        {rows.length} message{rows.length === 1 ? "" : "s"}
      </p>
      <CommsEmails rows={rows} />
    </>
  );
}
