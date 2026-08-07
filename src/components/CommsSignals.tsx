import Link from "next/link";
import { getRequestType } from "@/lib/catalog";
import { CHASE_AFTER_HOURS, type CommsSignals as Signals } from "@/lib/comms";
import { ticketStatusLabel } from "@/lib/tickets";

/**
 * The numbers you can act on. Every panel here answers "what do I go
 * eliminate", not "how busy were we".
 */
export function CommsSignals({ signals }: { signals: Signals }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Threads Per Ticket"
          value={signals.threadsPerTicket.toFixed(2)}
          note={`Across ${signals.contacted} ticket${signals.contacted === 1 ? "" : "s"} that reached a market`}
          tone={signals.threadsPerTicket > 1.2 ? "warn" : "good"}
        />
        <Stat
          label="Emails Per Ticket"
          value={signals.emailsPerTicket.toFixed(2)}
          note="Both directions, every desk"
          tone={signals.emailsPerTicket > 3 ? "warn" : "good"}
        />
        <Stat
          label="Closed On First Email"
          value={`${Math.round(signals.closedOnFirstEmailPct)}%`}
          note={`${signals.closedOnFirstEmail} of ${signals.resolved} resolved`}
          tone={signals.closedOnFirstEmailPct >= 70 ? "good" : "warn"}
        />
        <Stat
          label="Chase Queue"
          value={String(signals.chase.length)}
          note={`No reply past ${CHASE_AFTER_HOURS}h`}
          tone={signals.chase.length > 0 ? "warn" : "good"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Where The Loops Come From"
          hint="Every outbound after the first, tagged. This is the eliminate-this list."
        >
          {signals.loops.length === 0 ? (
            <Empty>
              No second emails yet — every ticket went out once and stayed out
              once.
            </Empty>
          ) : (
            <ul className="space-y-2">
              {signals.loops.map((l) => {
                const top = signals.loops[0].count;
                return (
                  <li key={l.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-[var(--ink)]">{l.label}</span>
                      <span className="font-semibold text-[var(--ink)]">
                        {l.count}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--sand)]">
                      <div
                        className="pace-bar h-full rounded-full"
                        style={{ width: `${(l.count / top) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
              {signals.untaggedLoops > 0 && (
                <li className="pt-1 text-xs text-[var(--muted)]">
                  {signals.untaggedLoops} untagged — those came in before the
                  reason prompt.
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel
          title="Chase Queue"
          hint="Sent and silent. Chase once, and only once — the tag proves it."
        >
          {signals.chase.length === 0 ? (
            <Empty>Nothing waiting longer than {CHASE_AFTER_HOURS} hours.</Empty>
          ) : (
            <ul className="space-y-2">
              {signals.chase.map((c) => (
                <li key={c.thread.id}>
                  <Link
                    href={`/tickets/${c.ticket.id}?tab=comms`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--ink)]">
                        {c.ticket.account.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--muted)]">
                        {c.thread.underwriter.name} · {c.thread.policy.carrier}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-[var(--coral)]">
                        {c.hoursWaiting}h
                      </span>
                      {c.alreadyChased && (
                        <span className="block text-[10px] text-[var(--muted)]">
                          Already Chased
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Duplicate Tickets"
          hint="Same account, same request, same holder — opened twice."
        >
          {signals.duplicates.length === 0 ? (
            <Empty>No duplicates. Intake is holding.</Empty>
          ) : (
            <ul className="space-y-2">
              {signals.duplicates.map((d) => (
                <li
                  key={`${d.accountName}-${d.holderName}`}
                  className="rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-amber-200"
                >
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {d.accountName} — {d.holderName}
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {getRequestType(d.requestType as never).label} ·{" "}
                    {d.tickets.length} tickets
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.tickets.map((t) => (
                      <Link
                        key={t.id}
                        href={`/tickets/${t.id}`}
                        className="rounded-full bg-[var(--sand)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink)] hover:bg-[var(--gold)]/20"
                      >
                        {ticketStatusLabel(t.status)}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Slowest Desks"
          hint="Which market generates your volume, and how long they take to answer."
        >
          {signals.desks.length === 0 ? (
            <Empty>No market conversations yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {signals.desks.map((d) => (
                <li
                  key={`${d.carrier}-${d.underwriter}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-[var(--rule)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--ink)]">
                      {d.underwriter}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">
                      {d.carrier} · {d.openThreads} open
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-[var(--muted)]">
                    <span className="block font-semibold text-[var(--ink)]">
                      {d.touches} touches
                    </span>
                    {d.avgHoursToAnswer != null && (
                      <span>{d.avgHoursToAnswer.toFixed(1)}h to answer</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "good" | "warn";
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1 font-display text-3xl ${
          tone === "warn" ? "text-[var(--coral)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        {note}
      </p>
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <p className="eyebrow">{title}</p>
      <p className="mt-0.5 mb-3 text-[11px] leading-relaxed text-[var(--muted)]">
        {hint}
      </p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--rule)] px-4 py-6 text-center text-xs text-[var(--muted)]">
      {children}
    </p>
  );
}
