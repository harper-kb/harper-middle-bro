import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import { getRequestType } from "@/lib/catalog";
import { isoToLocalDateKey, localDateKey } from "@/lib/dates";
import {
  listAccountGrants,
  listAccounts,
  listEscalatedTickets,
  listOperators,
  listTickets,
} from "@/lib/db";
import {
  assignTicketAction,
  assumeManagerRoleAction,
  grantAccountAccessAction,
  resolveEscalationAction,
  revokeAccountAccessAction,
} from "@/lib/desk-actions";
import { formatDate, relativeAge } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import type { Operator } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ManagerPage() {
  const operator = await getSessionOperator();

  if (!operator) {
    return (
      <Shell operator={operator}>
        <section className="surface-card max-w-xl space-y-4 p-6">
          <p className="eyebrow">Sign In Required</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">
            Sign In To Run The Desk
          </h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            The manager dashboard shows the whole book — grants, unclaimed
            work, and escalations. Sign in first so the desk knows who is
            asking.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SignInButton mode="modal">
              <button type="button" className="btn-primary px-5 py-2">
                Sign In
              </button>
            </SignInButton>
            <Link href="/me" className="btn-ghost px-5 py-2 text-sm">
              Your Desk
            </Link>
          </div>
        </section>
      </Shell>
    );
  }

  if (operator.role !== "manager") {
    return (
      <Shell operator={operator}>
        <section className="surface-card max-w-xl space-y-4 p-6">
          <p className="eyebrow">Role-Scoped Desk</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">
            Manager Access Only
          </h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            This desk is scoped to the manager role — it hands out account
            grants, assigns unclaimed work, and answers escalations. Your seat
            ({operator.displayName}, {operator.title}) is signed in as an
            operator.
          </p>
          <form action={assumeManagerRoleAction}>
            <button type="submit" className="btn-primary px-5 py-2">
              Assume Manager Seat (Sandbox)
            </button>
          </form>
          <p className="text-xs text-[var(--muted)]">
            Sandbox affordance only — in production the manager role comes
            from the org directory, not a button.
          </p>
        </section>
      </Shell>
    );
  }

  const operators = listOperators();
  const accounts = listAccounts();
  const grants = listAccountGrants();
  const escalations = listEscalatedTickets();
  const unassigned = listTickets({ unclaimedOnly: true, openOnly: true });
  const today = localDateKey();
  // Request-time snapshot for overdue badges in this server render.
  // eslint-disable-next-line react-hooks/purity -- server component request clock
  const now = Date.now();

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const operatorNameById = new Map(operators.map((o) => [o.id, o.displayName]));

  const board = operators.map((op) => {
    const open = listTickets({ operatorId: op.id, openOnly: true }).length;
    const closedToday = listTickets({ operatorId: op.id }).filter(
      (t) => t.closedAt && isoToLocalDateKey(t.closedAt) === today,
    ).length;
    return {
      op,
      grantCount: grants.filter((g) => g.operatorId === op.id).length,
      open,
      closedToday,
      escalationsToThem: escalations.filter((t) => t.escalatedToId === op.id)
        .length,
    };
  });

  return (
    <Shell operator={operator}>
      {/* —— Escalations Inbox: the manager's job, open by default —— */}
      <DeskSection
        title="Escalations Inbox"
        summary={`${escalations.length} Open`}
        defaultOpen
      >
        <p className="mb-3 text-xs text-[var(--muted)]">
          Open flags across the desk, oldest promise first.
        </p>
        {escalations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
            No Open Escalations.
          </p>
        ) : (
          <ul className="space-y-3">
            {escalations.map((t) => {
              const overdue =
                t.escalationDueBy != null &&
                new Date(t.escalationDueBy).getTime() < now;
              return (
                <li
                  key={t.id}
                  className={`surface-card p-4 ${
                    overdue ? "ring-1 ring-rose-300" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="font-mono text-xs text-[var(--coral)] hover:underline"
                      >
                        {t.srNumber || "SR Pending"}
                      </Link>
                      <p className="text-sm font-medium text-[var(--ink)]">
                        {t.title}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {t.account.name}
                        {" · Flagged To "}
                        {t.escalatedToId
                          ? (operatorNameById.get(t.escalatedToId) ?? "Unknown")
                          : "—"}
                        {" · Assigned To "}
                        {t.operatorId
                          ? (operatorNameById.get(t.operatorId) ?? "Assigned")
                          : "Unclaimed"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {t.escalationDueBy && (
                        <span
                          title="The promise is end of the flagging day unless the flag says otherwise."
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            overdue
                              ? "bg-rose-100 text-rose-800 ring-1 ring-rose-300"
                              : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)]"
                          }`}
                        >
                          {overdue ? "Past Due — " : "Due By "}
                          {formatDate(t.escalationDueBy)}
                        </span>
                      )}
                      {t.escalatedAt && (
                        <span className="text-[11px] text-[var(--muted)]">
                          Flagged {formatDate(t.escalatedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {t.escalationNote && (
                    <p className="mt-3 border-l-2 border-[var(--gold)] pl-3 text-sm leading-relaxed text-[var(--ink)]">
                      {t.escalationNote}
                    </p>
                  )}
                  <div className="mt-3">
                    <form action={resolveEscalationAction}>
                      <input type="hidden" name="ticketId" value={t.id} />
                      <button type="submit" className="btn-primary px-4 py-1.5 text-xs">
                        Mark Handled
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DeskSection>

      {/* —— Team Board: former card grid, now a ledger —— */}
      <div className="mt-5">
      <DeskSection title="Team Board" summary={`${board.length} Seats`} flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                <th className="px-4 py-2.5">Seat</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5 text-right">Accounts</th>
                <th className="px-4 py-2.5 text-right">Open</th>
                <th className="px-4 py-2.5 text-right">Closed Today</th>
                <th className="px-4 py-2.5 text-right">Flags To Them</th>
              </tr>
            </thead>
            <tbody>
              {board.map(({ op, grantCount, open, closedToday, escalationsToThem }) => (
                <tr
                  key={op.id}
                  className="row-link border-b border-[var(--rule)] last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--ink)]">
                      {op.displayName}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {op.title}
                      {op.team ? ` · ${op.team}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        op.role === "manager"
                          ? "bg-[var(--ink)] text-white"
                          : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)]"
                      }`}
                    >
                      {op.role === "manager" ? "Manager" : "Operator"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right text-sm tabular-nums text-[var(--ink)]"
                    title={
                      op.role === "manager"
                        ? "Managers see the whole book — no grants needed."
                        : undefined
                    }
                  >
                    {op.role === "manager" ? "Full Book" : grantCount}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--ink)]">
                    {open}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--ink)]">
                    {closedToday}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${
                      escalationsToThem > 0 ? "text-rose-700" : "text-[var(--ink)]"
                    }`}
                  >
                    {escalationsToThem}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DeskSection>
      </div>

      {/* —— Assignment —— */}
      <div className="mt-5">
      <DeskSection
        title="Assignment"
        summary={`${unassigned.length} Unclaimed`}
      >
        <p className="mb-3 text-xs text-[var(--muted)]">
          Grant account access to operators and assign unclaimed Service
          Requests (SRs) to a desk.
        </p>

        <h3 className="eyebrow mb-2">Account Grants</h3>
        <ul className="mb-6 space-y-2">
          {operators.map((op) => {
            const granted = grants.filter((g) => g.operatorId === op.id);
            const grantedIds = new Set(granted.map((g) => g.accountId));
            const grantable = accounts.filter((a) => !grantedIds.has(a.id));
            return (
              <li key={op.id} className="surface-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 min-w-32 text-sm font-medium text-[var(--ink)]">
                    {op.displayName}
                    {op.role === "manager" && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Full Book
                      </span>
                    )}
                  </span>
                  {granted.length === 0 && (
                    <span className="text-xs text-[var(--muted)]">
                      {op.role === "manager"
                        ? "No explicit grants — the role covers everything."
                        : "No Accounts Granted"}
                    </span>
                  )}
                  {granted.map((g) => (
                    <form key={g.accountId} action={revokeAccountAccessAction}>
                      <input type="hidden" name="operatorId" value={op.id} />
                      <input type="hidden" name="accountId" value={g.accountId} />
                      <button
                        type="submit"
                        className="chip gap-1.5 text-[11px] transition hover:border-rose-400 hover:text-rose-700"
                        title={`Revoke ${accountNameById.get(g.accountId) ?? g.accountId}`}
                      >
                        {accountNameById.get(g.accountId) ?? g.accountId}
                        <span aria-hidden>×</span>
                      </button>
                    </form>
                  ))}
                  {grantable.length > 0 && (
                    <form
                      action={grantAccountAccessAction}
                      className="ml-auto flex items-center gap-1.5"
                    >
                      <input type="hidden" name="operatorId" value={op.id} />
                      <select
                        name="accountId"
                        required
                        defaultValue=""
                        className="field w-52 px-3 py-1.5 text-xs"
                        aria-label={`Grant An Account To ${op.displayName}`}
                      >
                        <option value="" disabled>
                          Grant An Account…
                        </option>
                        {grantable.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
                        Grant
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <h3 className="eyebrow mb-2">Unassigned Tickets</h3>
        {unassigned.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
            No Unclaimed Open Tickets — everything on the board has an owner.
          </p>
        ) : (
          <ul className="space-y-2">
            {unassigned.map((t) => (
              <li
                key={t.id}
                className="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/tickets/${t.id}`}
                    className="font-mono text-xs text-[var(--coral)] hover:underline"
                  >
                    {t.srNumber || "SR Pending"}
                  </Link>
                  <p className="truncate text-sm font-medium text-[var(--ink)]">
                    {t.title}
                  </p>
                  <p className="truncate text-[11px] text-[var(--muted)]">
                    {t.account.name} · {getRequestType(t.requestType).shortLabel}{" "}
                    · {relativeAge(t.createdAt)} Old
                  </p>
                </div>
                <form
                  action={assignTicketAction}
                  className="flex shrink-0 items-center gap-1.5"
                >
                  <input type="hidden" name="ticketId" value={t.id} />
                  <select
                    name="operatorId"
                    required
                    defaultValue=""
                    className="field w-44 px-3 py-1.5 text-xs"
                    aria-label={`Assign ${t.srNumber || "Ticket"}`}
                  >
                    <option value="" disabled>
                      Pick An Operator…
                    </option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.displayName}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn-primary px-4 py-1.5 text-xs">
                    Assign
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </DeskSection>
      </div>
    </Shell>
  );
}

function Shell({
  operator,
  children,
}: {
  operator: Operator | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav active="/manager" operator={operator} />
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-8">
          <p className="eyebrow">Oversight</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Manager Desk
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Escalations first — the team board and assignment sit below.
          </p>
        </div>
        {children}
      </main>
    </>
  );
}
