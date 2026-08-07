import Link from "next/link";
import { Nav } from "@/components/Nav";
import { NewTicketForm } from "@/components/NewTicketForm";
import { listAccounts } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const accounts = listAccounts();
  const operator = await getSessionOperator();

  return (
    <>
      <Nav active="/tickets" operator={operator} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/queue" className="text-xs text-[var(--muted)] hover:underline">
          ← Ticket Queue
        </Link>
        <div className="mb-6 mt-2">
          <p className="eyebrow">Manual Intake</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            New Ticket
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Someone asked for something and we owe them an outcome. Record it
            here and the market email, the certificate, and the audit trail all
            hang off this one record.
          </p>
        </div>
        <NewTicketForm
          accounts={accounts}
          defaultRequestedBy={operator?.displayName ?? ""}
        />
      </main>
    </>
  );
}
