import Link from "next/link";
import { Nav } from "@/components/Nav";
import { listAccounts } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { id: "all" | AccountStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pre_bind", label: "Pre-Bind" },
  { id: "cancelled", label: "Cancelled" },
];

function statusPillClass(status: AccountStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pre_bind":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "cancelled":
      return "bg-stone-100 text-stone-500 ring-stone-400/20";
  }
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const statusFilter = (params.status ?? "all") as "all" | AccountStatus;
  const accounts = listAccounts().filter(
    (a) => statusFilter === "all" || a.status === statusFilter,
  );
  const operator = await getSessionOperator();

  return (
    <>
      <Nav active="/accounts" operator={operator} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <p className="eyebrow">Records</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Accounts
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Seeded commercial-lines book with primary and backup underwriters.
          </p>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.id}
              href={f.id === "all" ? "/accounts" : `/accounts?status=${f.id}`}
              className={`chip transition ${
                statusFilter === f.id
                  ? "bg-[var(--navy)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--navy)]/10 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--navy)]/10 bg-[var(--sand)]/50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Account</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Industry</th>
                <th className="px-4 py-3 font-semibold">Primary Underwriter</th>
                <th className="px-4 py-3 font-semibold">Policies</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-[var(--navy)]/5 transition-colors hover:bg-[var(--sand)]/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/accounts/${a.id}`}
                      className="font-medium text-[var(--navy)] transition-colors hover:text-[var(--coral)]"
                    >
                      {a.name}
                    </Link>
                    <p className="text-xs text-[var(--muted)]">{a.state}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      title={
                        a.status === "pre_bind"
                          ? "New business awaiting payment — payment activates service."
                          : undefined
                      }
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusPillClass(a.status)}`}
                    >
                      {ACCOUNT_STATUS_LABELS[a.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{a.industry}</td>
                  <td className="px-4 py-3">
                    <p>{a.primaryUw.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {a.primaryUw.carrier}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-[var(--muted)]">
                    {a.policies.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {accounts.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
              No accounts with this status.
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
