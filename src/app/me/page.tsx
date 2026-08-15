import Link from "next/link";
import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { PersonalScorecard } from "@/components/ServiceScorecard";
import { ProfileForm } from "@/components/ProfileForm";
import { loadScorecard, readPeriodState } from "@/lib/retention/scorecard.server";
import type { PersonScorecard } from "@/lib/retention/scorecard";
import type { Operator } from "@/lib/types";
import { setAutoSendAction } from "@/lib/actions";
import { AUTO_SEND_UNLOCK_AT } from "@/lib/aidesk";
import { getRequestType } from "@/lib/catalog";
import { relativeAge } from "@/lib/format";
import { listStreaks, listTickets } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { TICKET_STATUS_STYLES, ticketStatusLabel } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const operator = await getSessionOperator();
  const myOpen = operator
    ? listTickets({ operatorId: operator.id, openOnly: true })
    : [];
  const streaks = operator ? listStreaks(operator.id) : [];

  // The retention ledger keys on internal-agent ids, which the desk's operator
  // table does not carry. Email is the only identifier both sides share.
  const scorecard = await loadScorecard();
  const mine = operator ? findMyScorecard(scorecard.people, operator) : null;
  const myDisputes = operator
    ? readPeriodState(scorecard.period.id).disputes.filter(
        (d) => d.raisedBy === operator.id,
      )
    : [];

  return (
    <>
      <Nav active="/me" operator={operator} />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <div>
          <h1 className="font-display text-3xl text-[var(--ink)]">Your Desk</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            Sign in with Clerk. Your name and signature stamp every email draft.
          </p>
        </div>

        {!operator ? (
          <section className="surface-card space-y-4 p-6">
            <p className="eyebrow">Clerk Sign In</p>
            <p className="text-sm text-[var(--muted)]">
              Step Bro is its own Clerk product. Create an account or
              sign in; your desk operator profile is created on first login.
            </p>
            <div className="flex flex-wrap gap-2">
              <SignInButton mode="modal">
                <button type="button" className="btn-primary px-5 py-2.5">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button type="button" className="btn-ghost px-5 py-2.5">
                  Create Account
                </button>
              </SignUpButton>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Or use{" "}
              <Link href="/sign-in" className="underline">
                /sign-in
              </Link>{" "}
              /{" "}
              <Link href="/sign-up" className="underline">
                /sign-up
              </Link>
              .
            </p>
          </section>
        ) : (
          <>
            <section className="surface-card space-y-5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Profile</p>
                  <p className="mt-1 font-display text-2xl text-[var(--ink)]">
                    {operator.displayName}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {operator.email}
                  </p>
                </div>
                <UserButton />
              </div>

              <ProfileForm operator={operator} />
            </section>

            <PersonalScorecard
              person={mine}
              period={scorecard.period}
              ledgerNote={scorecard.ledgerNote}
              disputes={myDisputes}
              seatNames={{ [operator.id]: operator.displayName }}
            />

            <section className="space-y-3">
              <div>
                <p className="eyebrow">Earned Trust</p>
                <h2 className="font-display text-xl text-[var(--ink)]">
                  Auto-Send
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                  After {AUTO_SEND_UNLOCK_AT} consecutive sends with no edits and
                  no overridden warnings, that request type no longer requires
                  manual confirmation. Revocable at any time.
                </p>
              </div>

              {streaks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No sends recorded under your name yet. Each clean send counts
                  toward the streak.
                </p>
              ) : (
                <ul className="space-y-2">
                  {streaks.map((s) => (
                    <li
                      key={s.requestType}
                      className="rounded-xl border border-[var(--rule)] bg-white px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--ink)]">
                            {getRequestType(s.requestType).label}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            {s.confirmedTotal} sent · {s.cleanStreak} clean in a
                            row
                          </p>
                        </div>
                        <form action={setAutoSendAction}>
                          <input
                            type="hidden"
                            name="requestType"
                            value={s.requestType}
                          />
                          <input
                            type="hidden"
                            name="on"
                            value={s.autoSend ? "0" : "1"}
                          />
                          <button
                            type="submit"
                            disabled={
                              !s.autoSend && s.cleanStreak < AUTO_SEND_UNLOCK_AT
                            }
                            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                              s.autoSend
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)]"
                            }`}
                          >
                            {s.autoSend
                              ? "On — Revoke"
                              : s.cleanStreak >= AUTO_SEND_UNLOCK_AT
                                ? "Unlock Auto-Send"
                                : `${AUTO_SEND_UNLOCK_AT - s.cleanStreak} To Go`}
                          </button>
                        </form>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--sand)]">
                        <div
                          className="pace-bar h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (s.cleanStreak / AUTO_SEND_UNLOCK_AT) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="eyebrow">Open Tickets</p>
                  <h2 className="font-display text-xl text-[var(--ink)]">
                    Open Under Your Name
                  </h2>
                </div>
                <Link
                  href="/queue?view=mine"
                  className="text-xs font-semibold text-[var(--coral)] hover:underline"
                >
                  Full Queue
                </Link>
              </div>
              {myOpen.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
                  Nothing is open under your name. Open a ticket to start one.
                </p>
              ) : (
                <ul className="space-y-2">
                  {myOpen.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--rule)] bg-white px-4 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/tickets/${t.id}`}
                          className="font-medium text-[var(--ink)] hover:text-[var(--coral)]"
                        >
                          {t.account.name}
                        </Link>
                        <p className="truncate text-xs text-[var(--muted)]">
                          {getRequestType(t.requestType).shortLabel} ·{" "}
                          {t.subject} · {relativeAge(t.updatedAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TICKET_STATUS_STYLES[t.status]}`}
                      >
                        {ticketStatusLabel(t.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

/**
 * Match a signed-in seat to its ledger row. Email is the shared key; display
 * name is a fallback for seats the internal-agent directory has not synced.
 * No match means no row rather than a guessed one — attributing someone
 * else's saves to your desk is worse than showing nothing.
 */
function findMyScorecard(
  people: PersonScorecard[],
  operator: Operator,
): PersonScorecard | null {
  const email = operator.email?.trim().toLowerCase();
  if (email) {
    const byEmail = people.find((p) => p.email?.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = operator.displayName.trim().toLowerCase();
  return people.find((p) => p.displayName.trim().toLowerCase() === name) ?? null;
}
