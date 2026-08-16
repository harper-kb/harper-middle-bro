import Link from "next/link";
import { Nav } from "@/components/Nav";
import { listAccounts } from "@/lib/db";
import {
  getPolicyFormSet,
  hasBlanketAi,
  hasBlanketWos,
} from "@/lib/forms";
import { getSessionOperator } from "@/lib/session";
import { ACCOUNT_STATUS_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The certificate desk's front door: pick an account, land in its Certificate
 * Studio. Active accounts issue; pre-bind accounts (new business awaiting
 * payment) open in Prepare Only — build and confirm everything, paper prints
 * once payment activates service. Cancelled accounts don't issue paper.
 */
export default async function CertificatesPage() {
  const operator = await getSessionOperator();
  const accounts = listAccounts().filter(
    (a) => a.status === "active" || a.status === "pre_bind",
  );

  const rows = accounts.map((a) => {
    const formSets = a.policies.map((p) => getPolicyFormSet(p));
    return {
      account: a,
      carriers: [...new Set(a.policies.map((p) => p.carrier))],
      blanketAi: formSets.some(hasBlanketAi),
      blanketWos: formSets.some(hasBlanketWos),
    };
  });

  return (
    <>
      <Nav active="/certificates" operator={operator} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="page-title text-3xl text-[var(--ink)]">
            Certificates
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Pick an account to open its Certificate Studio. The sheet fills
            from the schedule of record and the verifier blocks anything the
            paper can&apos;t back. Pre-bind accounts open in Prepare Only —
            payment activates issuance.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ account: a, carriers, blanketAi, blanketWos }) => (
            <Link
              key={a.id}
              href={`/accounts/${a.id}#certificates`}
              className="group rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] p-4 shadow-sm transition hover:border-[var(--accent)]/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)] group-hover:text-[var(--accent)]">
                    {a.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {a.industry} · {a.state}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                    a.status === "active"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                      : "bg-amber-50 text-amber-700 ring-amber-600/20"
                  }`}
                >
                  {a.status === "pre_bind"
                    ? "Pre-Bind — Prepare Only"
                    : ACCOUNT_STATUS_LABELS[a.status]}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {a.policies.length}{" "}
                {a.policies.length === 1 ? "Policy" : "Policies"} ·{" "}
                {carriers.join(", ")}
              </p>
              {(blanketAi || blanketWos) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {blanketAi && (
                    <span className="rounded-full border border-emerald-600/25 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Blanket AI On File
                    </span>
                  )}
                  {blanketWos && (
                    <span className="rounded-full border border-emerald-600/25 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Blanket WOS On File
                    </span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            No active or pre-bind accounts on the book.
          </p>
        )}
      </main>
    </>
  );
}
