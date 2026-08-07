import Link from "next/link";
import { Nav } from "@/components/Nav";
import { AiDesk } from "@/components/AiDesk";
import { getStreak, listAccounts, listTickets, listUnderwriters } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AiDeskPage() {
  const accounts = listAccounts();
  const carrierDesks = listUnderwriters();
  const operator = await getSessionOperator();
  const tickets = listTickets({ requestType: "additional_insured" });
  const streak = operator
    ? getStreak(operator.id, "additional_insured")
    : { cleanStreak: 0, autoSend: false };

  return (
    <>
      <Nav active="/ai-desk" operator={operator} />
      <main className="mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <p className="eyebrow">One Request Type, Mastered</p>
          <Link href="/samples/ai-desk" className="chip mt-1.5 transition hover:border-[var(--coral)] hover:text-[var(--coral)]">Preview New Layout</Link>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Additional Insured Desk
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            A paced view of Additional Insured (AI) tickets: a few in play,
            the rest held.
          </p>
        </div>
        <AiDesk
          tickets={tickets}
          accounts={accounts}
          carrierDesks={carrierDesks}
          operator={operator}
          cleanStreak={streak.cleanStreak}
          autoSend={streak.autoSend}
        />
      </main>
    </>
  );
}
