import Link from "next/link";
import { Nav } from "@/components/Nav";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Desk shell — continuous next-action workspace lands in the unified Desk PR.
 * This route establishes the nav landing target.
 */
export default async function DeskShellPage() {
  const operator = await getSessionOperator();
  return (
    <div>
      <Nav active="/desk" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <p className="eyebrow">Desk</p>
        <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">Desk</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
          One Desk for next-action execution — account context, composer,
          documents, reminders, and the personal strip. Continuous auto-advance
          ships in the unified Desk PR.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/pending-orders" className="btn-ghost text-sm">
            Browse Sections
          </Link>
          <Link href="/accounts" className="btn-ghost text-sm">
            Accounts
          </Link>
        </div>
      </main>
    </div>
  );
}
