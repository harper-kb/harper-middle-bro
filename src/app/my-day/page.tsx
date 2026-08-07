import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { DayStory } from "@/components/DayStory";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import { getRequestType } from "@/lib/catalog";
import {
  bucketize,
  buildDayStory,
  type StoryDecision,
  type StoryThread,
  type StoryTicket,
} from "@/lib/day-story";
import {
  getAccountDetail,
  listAccounts,
  listDecisions,
  listOperatorAccountIds,
  listThreads,
  listTickets,
} from "@/lib/db";
import { relativeAge } from "@/lib/format";
import { getSessionOperator } from "@/lib/session";
import {
  TICKET_STATUS_STYLES,
  isOpenTicket,
  ticketStatusLabel,
} from "@/lib/tickets";
import { ACCOUNT_STATUS_LABELS, type AccountDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

const ACCOUNT_STATUS_PILLS: Record<AccountDetail["status"], string> = {
  pre_bind: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  active: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};

export default async function MyDayPage() {
  const operator = await getSessionOperator();

  if (!operator) {
    return (
      <>
        <Nav active="/my-day" operator={null} />
        <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
          <div>
            <p className="eyebrow">Operator Dashboard</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
              My Day
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              The story of your day, built only from what the desk recorded.
            </p>
          </div>
          <section className="surface-card space-y-4 p-6">
            <p className="eyebrow">Clerk Sign In</p>
            <p className="text-sm text-[var(--muted)]">
              Harper Middle Bro is its own Clerk product. Create an account or
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
        </main>
      </>
    );
  }

  const isManager = operator.role === "manager";
  const accounts: AccountDetail[] = isManager
    ? listAccounts()
    : listOperatorAccountIds(operator.id)
        .map((id) => getAccountDetail(id))
        .filter((a): a is AccountDetail => a != null);

  const myTickets = listTickets({ operatorId: operator.id });
  // No `day` filter here on purpose: it keys off thread created_at, and a
  // message sent today on an older thread is still today's work. The pure
  // lib filters message timestamps to the local day itself.
  const myThreads = listThreads({ operatorId: operator.id });
  const myDecisions = myTickets.flatMap((t) =>
    listDecisions({ ticketId: t.id }),
  );

  const storyTickets: StoryTicket[] = myTickets.map((t) => ({
    id: t.id,
    srNumber: t.srNumber,
    requestTypeLabel: getRequestType(t.requestType).label,
    accountName: t.account.name,
    createdAt: t.createdAt,
    closedAt: t.closedAt,
    fastPathBasis: t.fastPathBasis,
  }));
  const storyThreads: StoryThread[] = myThreads.map((t) => ({
    ticketId: t.ticketId,
    carrier: t.policy.carrier,
    accountName: t.account.name,
    messages: t.messages.map((m) => ({
      createdAt: m.createdAt,
      direction: m.direction,
      party: m.party,
      subject: m.subject,
    })),
  }));
  const storyDecisions: StoryDecision[] = myDecisions.map((d) => ({
    ticketId: d.ticketId,
    createdAt: d.createdAt,
    headline: d.headline,
    summary: d.summary,
    kind: d.kind,
  }));

  const openTickets = myTickets
    .filter((t) => isOpenTicket(t.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const now = new Date().toISOString();
  const story = buildDayStory({
    tickets: storyTickets,
    threads: storyThreads,
    decisions: storyDecisions,
    openTicketCount: openTickets.length,
    now,
  });
  const buckets = {
    "60": bucketize(story.events, 60, now),
    "20": bucketize(story.events, 20, now),
    "10": bucketize(story.events, 10, now),
  } as const;

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <Nav active="/my-day" operator={operator} />
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Operator Dashboard</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
              My Day
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">{dateLabel}</p>
          </div>
          <span className="chip">
            {operator.displayName} · {operator.title}
            {operator.team ? ` · ${operator.team}` : ""}
          </span>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-8">
            <DayStory
              summary={story.summary}
              chapters={story.chapters}
              buckets={buckets}
            />

            <DeskSection
              title="On Your Plate"
              summary={`${openTickets.length} Open`}
            >
              {openTickets.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
                  Nothing is open under your name. New work is claimed from
                  the{" "}
                  <Link href="/queue" className="underline">
                    queue
                  </Link>
                  .
                </p>
              ) : (
                <ul className="space-y-2">
                  {openTickets.map((t) => (
                    <li
                      key={t.id}
                      className="row-link flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--rule)] bg-white px-4 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/tickets/${t.id}`}
                          className="font-medium text-[var(--ink)] transition-colors hover:text-[var(--coral)]"
                        >
                          {t.srNumber} — {t.account.name}
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
            </DeskSection>
          </div>

          <aside className="space-y-3">
            <DeskSection
              title="Your Accounts"
              summary={
                isManager ? `Full Book · ${accounts.length}` : `${accounts.length}`
              }
            >
            {accounts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--rule)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
                No accounts granted yet. Your manager assigns account access
                from the Manager Desk.
              </p>
            ) : (
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <li
                    key={a.id}
                    className="row-link flex items-center justify-between gap-3 rounded-xl border border-[var(--rule)] bg-white px-4 py-3"
                  >
                    <Link
                      href={`/accounts/${a.id}`}
                      className="min-w-0 truncate text-sm font-medium text-[var(--ink)] transition-colors hover:text-[var(--coral)]"
                    >
                      {a.name}
                    </Link>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ACCOUNT_STATUS_PILLS[a.status]}`}
                    >
                      {ACCOUNT_STATUS_LABELS[a.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            </DeskSection>
          </aside>
        </div>
      </main>
    </>
  );
}
