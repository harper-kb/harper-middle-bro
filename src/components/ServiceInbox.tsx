import Link from "next/link";
import { SERVICE_MAILBOX } from "@/lib/brand";
import { formatDate, relativeAge } from "@/lib/format";
import { verbatimExcerpt } from "@/lib/service-ack";
import type { IntakeEvent, IntakeStatus } from "@/lib/types";

/**
 * The Service Email Inbox — the direct service mailbox, thread by thread,
 * where the client acknowledgment behavior is observable. Accuracy doctrine:
 * every snippet and quote is verbatim, the recorded ack renders exactly as
 * sent, and no SR number ever appears before the Pending board assigns one.
 *
 * Server-rendered: selection travels in the URL (?view=inbox&email={id}),
 * matching the page-convention searchParams pattern — no client tabs.
 */

const STATUS_LABELS: Record<IntakeStatus, string> = {
  pending: "Pending Triage",
  ticketed: "Ticketed",
  merged: "Merged",
  dismissed: "Dismissed",
};

const STATUS_CHIP_CLASSES: Record<IntakeStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  ticketed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  merged: "bg-sky-100 text-sky-800 ring-sky-200",
  dismissed: "bg-neutral-100 text-neutral-600 ring-neutral-200",
};

const STATUS_DOT_CLASSES: Record<IntakeStatus, string> = {
  pending: "bg-amber-500",
  ticketed: "bg-emerald-500",
  merged: "bg-sky-500",
  dismissed: "bg-neutral-400",
};

function StatusChip({ status }: { status: IntakeStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${STATUS_CHIP_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ServiceInbox({
  emails,
  selected,
  accountNamesById,
  srByTicketId,
}: {
  emails: IntakeEvent[];
  selected: IntakeEvent | null;
  accountNamesById: Record<string, string>;
  srByTicketId: Record<string, string>;
}) {
  const accountName = (id: string | null) =>
    id ? (accountNamesById[id] ?? id) : null;

  return (
    <section>
      <div className="grid gap-0 overflow-hidden rounded-[1.75rem] ring-1 ring-[var(--rule)] lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        {/* —— Thread list —— */}
        <aside className="border-b border-[var(--rule)] bg-[var(--paper)] lg:border-b-0 lg:border-r">
          <div className="border-b border-[var(--rule)] px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {SERVICE_MAILBOX}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-[var(--muted)]">
              {emails.length} thread{emails.length === 1 ? "" : "s"}, newest
              first
            </p>
          </div>
          <ul className="max-h-[42vh] overflow-y-auto lg:max-h-[min(70vh,820px)]">
            {emails.map((e) => {
              const on = e.id === selected?.id;
              const acct = accountName(e.accountId);
              return (
                <li key={e.id} className="border-b border-[var(--rule)] last:border-b-0">
                  <Link
                    href={`/comms?view=inbox&email=${e.id}`}
                    className={`group relative block px-5 py-4 transition ${
                      on
                        ? "bg-[color-mix(in_srgb,var(--gold)_12%,white)]"
                        : "hover:bg-[var(--sand)]"
                    }`}
                    aria-current={on ? "true" : undefined}
                  >
                    {on && (
                      <span
                        className="absolute inset-y-3 left-0 w-[3px] rounded-r bg-[var(--coral)]"
                        aria-hidden
                      />
                    )}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[12px] font-medium text-[var(--ink)]">
                        {e.fromName}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--muted)]">
                          {relativeAge(e.receivedAt)}
                        </span>
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[e.status]}`}
                          title={STATUS_LABELS[e.status]}
                        />
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-[var(--ink)]/90">
                      {e.subject ?? "(No Subject)"}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-[var(--muted)]">
                      {verbatimExcerpt(e.body, 90)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="chip">
                        {acct ?? "No Account Match"}
                      </span>
                      <StatusChip status={e.status} />
                      {e.ackSentAt && (
                        <span className="inline-flex items-center rounded-full bg-[var(--ink)] px-2.5 py-0.5 text-[11px] font-medium text-white">
                          Acknowledgment Sent
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
            {emails.length === 0 && (
              <li className="px-5 py-16 text-center text-sm text-[var(--muted)]">
                No Email Threads.
              </li>
            )}
          </ul>
        </aside>

        {/* —— Selected thread —— */}
        <div className="min-w-0 bg-[color-mix(in_srgb,var(--pierre)_70%,white)] px-6 py-6 sm:px-8">
          {!selected ? (
            <div className="flex min-h-[320px] items-center justify-center text-center">
              <p className="font-display text-2xl text-[var(--muted)]">
                Select A Thread From The List.
              </p>
            </div>
          ) : (
            <SelectedThread
              event={selected}
              accountName={accountName(selected.accountId)}
              sr={
                selected.ticketId
                  ? (srByTicketId[selected.ticketId] ?? null)
                  : null
              }
            />
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--muted)]">
        Sandbox mailbox — these threads are seeded fixtures; there is no live
        mail sync behind {SERVICE_MAILBOX}.
      </p>
    </section>
  );
}

function SelectedThread({
  event,
  accountName,
  sr,
}: {
  event: IntakeEvent;
  accountName: string | null;
  sr: string | null;
}) {
  return (
    <article>
      {/* The email, rendered like mail */}
      <div className="surface-card px-5 py-5">
        <dl className="space-y-1 border-b border-[var(--rule)] pb-3 text-[12px]">
          <HeaderRow label="From">
            {event.fromName}{" "}
            <span className="font-mono text-[11px] text-[var(--muted)]">
              &lt;{event.fromContact}&gt;
            </span>
          </HeaderRow>
          <HeaderRow label="To">
            <span className="font-mono text-[11px]">{SERVICE_MAILBOX}</span>
          </HeaderRow>
          <HeaderRow label="Received">{formatDate(event.receivedAt)}</HeaderRow>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 font-display text-lg text-[var(--ink)]">
            {event.subject ?? "(No Subject)"}
          </h3>
          <span className="chip">{accountName ?? "No Account Match"}</span>
          <StatusChip status={event.status} />
        </div>
        <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--ink)]/90">
          {event.body}
        </pre>
      </div>

      {/* The acknowledgment story */}
      <div className="mt-5">
        {event.ackSentAt && event.ackBody ? (
          <div className="ml-0 rounded-2xl border border-[var(--rule)] bg-white px-5 py-5 sm:ml-10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Acknowledgment Sent
              </p>
              <p className="font-mono text-[11px] text-[var(--muted)]">
                {formatDate(event.ackSentAt)} · From {SERVICE_MAILBOX}
              </p>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-[var(--sand)] px-4 py-3 font-mono text-[12px] leading-relaxed text-[var(--ink)]/90">
              {event.ackBody}
            </pre>
            {event.ticketId && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Opened as{" "}
                <Link
                  href={`/tickets/${event.ticketId}`}
                  className="font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
                >
                  {sr ?? "the linked ticket"}
                </Link>
                {" — "}the Service Request (SR) quoted in the acknowledgment
                above.
              </p>
            )}
          </div>
        ) : event.status === "pending" ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
              Awaiting Triage
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-amber-900">
              The acknowledgment goes out the moment an operator confirms the
              ticket on the{" "}
              <Link
                href="/comms"
                className="font-medium underline underline-offset-4"
              >
                Pending
              </Link>{" "}
              board.
            </p>
            <details className="disclosure mt-2">
              <summary className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline">
                <span className="disclosure-caret" aria-hidden>
                  ›
                </span>
                Preview The Acknowledgment Format
              </summary>
              <p className="mt-2 text-[11px] text-amber-900">
                The Service Request (SR) number is assigned at confirmation,
                never before.
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/70 px-4 py-3 font-mono text-[12px] leading-relaxed text-amber-950">
                {ackTemplate(event)}
              </pre>
            </details>
          </div>
        ) : event.status === "dismissed" ? (
          <p className="rounded-2xl border border-[var(--rule)] bg-white px-5 py-4 text-[13px] text-[var(--muted)]">
            No Acknowledgment — Dismissed (no action needed).
          </p>
        ) : (
          <p className="rounded-2xl border border-[var(--rule)] bg-white px-5 py-4 text-[13px] text-[var(--muted)]">
            No acknowledgment recorded on this event.
            {event.ticketId && (
              <>
                {" "}
                It is attached to{" "}
                <Link
                  href={`/tickets/${event.ticketId}`}
                  className="font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
                >
                  {sr ?? "a ticket"}
                </Link>
                .
              </>
            )}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * The ack template SHAPE for a not-yet-confirmed email. Mirrors
 * buildServiceAck exactly, except the SR slot is explicitly marked as
 * unassigned — we never print a number that doesn't exist yet.
 */
function ackTemplate(event: IntakeEvent): string {
  const firstName = event.fromName.trim().split(/\s+/)[0];
  const greeting =
    firstName && firstName !== "Unknown" ? firstName : "there";
  const quoted = [
    ...(event.subject ? [`> ${event.subject}`] : []),
    `> ${verbatimExcerpt(event.body)}`,
  ].join("\n");

  return [
    `Hi ${greeting},`,
    "",
    "We received your email — here is your request exactly as it reached us:",
    "",
    quoted,
    "",
    "We opened service request [SR — Assigned At Confirm] and it's with the desk now. Track it any time on the portal.",
    "",
    "If anything above reads wrong, reply here and an operator will pick it up directly.",
    "",
    "— Harper Service Desk",
  ].join("\n");
}

function HeaderRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="min-w-0 text-[var(--ink)]">{children}</dd>
    </div>
  );
}
