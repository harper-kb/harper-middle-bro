import { markCertErroneousAction } from "@/lib/cert-issue";
import type {
  HolderNoticeRecord,
  IssueAttemptRecord,
  IssuedCertRecord,
  PreparedCertRecord,
} from "@/lib/cert-ledger";

/**
 * Certificate Ledger — the account's issued paper, on record.
 *
 * Every certificate that left the system is a row here with its frozen fact
 * snapshot; corrections form a visible supersede chain (revoked paper links
 * to its replacement); holder re-notifications and blocked attempts sit
 * alongside. Server-rendered off the ledger tables.
 */
export function CertificateLedgerPanel({
  accountId,
  certs,
  attempts,
  notices,
  prepared,
}: {
  accountId: string;
  certs: IssuedCertRecord[];
  attempts: IssueAttemptRecord[];
  notices: HolderNoticeRecord[];
  prepared: PreparedCertRecord[];
}) {
  const blockedAttempts = attempts.filter((a) => a.outcome === "blocked");
  const empty =
    certs.length === 0 && blockedAttempts.length === 0 && prepared.length === 0;

  return (
    <section className="surface-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rule)] px-5 py-4">
        <div>
          <p className="eyebrow">Chain Of Custody</p>
          <h3 className="mt-0.5 font-display text-lg text-[var(--ink)]">
            Certificate Ledger
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="chip">{certs.length} Issued</span>
          <span className="chip">{blockedAttempts.length} Blocked</span>
        </div>
      </header>

      {empty ? (
        <p className="px-5 py-4 text-sm text-[var(--muted)]">
          Nothing issued yet. Every certificate that leaves this account will
          land here with its frozen fact snapshot and the checks it passed.
        </p>
      ) : (
        <div className="space-y-4 px-5 py-4">
          {certs.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Issued Certificates</p>
              <ul className="space-y-2">
                {certs.map((c) => (
                  <li
                    key={c.id}
                    className={`rounded-xl border px-3 py-2.5 text-xs ${
                      c.status === "revoked"
                        ? "border-rose-200 bg-rose-50/60"
                        : c.status === "superseded"
                          ? "border-[var(--rule)] bg-[var(--paper)] opacity-80"
                          : "border-emerald-200 bg-emerald-50/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] ${
                          c.status === "revoked"
                            ? "text-rose-700"
                            : c.status === "superseded"
                              ? "text-[var(--muted)]"
                              : "text-emerald-700"
                        }`}
                      >
                        {c.status === "revoked"
                          ? "Revoked"
                          : c.status === "superseded"
                            ? "Superseded"
                            : "Active"}
                      </span>
                      <span className="font-semibold text-[var(--ink)]">
                        {c.holderName}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--muted)]">
                        {c.id}
                      </span>
                      <span className="ml-auto text-[var(--muted)]">
                        {c.issuedAt.slice(0, 10)} · {c.issuedBy}
                      </span>
                    </div>
                    <p className="mt-1 text-[var(--muted)]">
                      {c.formKey === "acord30" ? "ACORD 30" : "ACORD 25"} ·{" "}
                      {c.policyNumbers.join(", ") || "—"} · Snapshot{" "}
                      <span className="font-mono">{c.snapshotDigest.slice(0, 12)}</span>{" "}
                      taken {c.snapshot.takenAt.slice(0, 19).replace("T", " ")} ·{" "}
                      {c.snapshot.fields.length} fields with provenance
                    </p>
                    {(c.supersedes || c.supersededBy) && (
                      <p className="mt-1 text-[var(--muted)]">
                        {c.supersedes && (
                          <>
                            Replaces{" "}
                            <span className="font-mono text-[10px]">{c.supersedes}</span>
                          </>
                        )}
                        {c.supersedes && c.supersededBy && " · "}
                        {c.supersededBy && (
                          <>
                            Replaced By{" "}
                            <span className="font-mono text-[10px]">{c.supersededBy}</span>
                          </>
                        )}
                      </p>
                    )}
                    {c.status === "revoked" && (
                      <p className="mt-1 text-rose-800">
                        Revoked {c.revokedAt?.slice(0, 10)} by {c.revokedBy}: {c.revokeReason}
                      </p>
                    )}
                    {c.status === "active" && (
                      <form
                        action={markCertErroneousAction}
                        className="mt-2 flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="accountId" value={accountId} />
                        <input type="hidden" name="certId" value={c.id} />
                        <input
                          name="reason"
                          required
                          placeholder="Found erroneous because…"
                          className="field w-64 py-1.5 text-xs"
                        />
                        <button type="submit" className="btn-ghost text-xs">
                          Mark Erroneous &amp; Revoke
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {prepared.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Prepared (Not Issued)</p>
              <ul className="space-y-1.5">
                {prepared.map((p) => {
                  const dead = p.invalidatedAt != null;
                  const consumed = p.consumedByCertId != null;
                  return (
                    <li
                      key={p.id}
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        dead
                          ? "border-[var(--rule)] bg-[var(--paper)] opacity-75"
                          : "border-amber-200 bg-amber-50/50"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                          {consumed ? "Consumed" : dead ? "Invalidated" : "Pending"}
                        </span>
                        <span className="font-semibold text-[var(--ink)]">{p.holderName}</span>
                        <span className="ml-auto text-[var(--muted)]">
                          Prepared {p.preparedAt.slice(0, 10)} by {p.preparedBy} · TTL to{" "}
                          {p.expiresAt.slice(0, 16).replace("T", " ")}
                        </span>
                      </div>
                      {dead && !consumed && (
                        <p className="mt-0.5 text-[var(--muted)]">
                          {p.invalidatedReason} — regeneration forced at send.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {notices.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Holder Notifications</p>
              <ul className="space-y-1.5">
                {notices.map((n) => (
                  <li
                    key={n.id}
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      n.kind === "revoked"
                        ? "border-rose-200 bg-rose-50/60 text-rose-900"
                        : n.kind === "corrected"
                          ? "border-amber-200 bg-amber-50/50 text-amber-900"
                          : "border-[var(--rule)] bg-[var(--paper)] text-[var(--ink)]"
                    }`}
                  >
                    <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                      {n.kind === "revoked"
                        ? "Revocation Notice"
                        : n.kind === "corrected"
                          ? "Corrected Certificate"
                          : "Issued"}
                    </span>
                    {n.body}
                    <span className="ml-2 text-[var(--muted)]">
                      {n.createdAt.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blockedAttempts.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Blocked Attempts</p>
              <ul className="space-y-1.5">
                {blockedAttempts.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2 text-xs text-rose-900"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{a.holderName}</span>
                      <span className="text-[10px] uppercase tracking-[0.08em] opacity-75">
                        Via {a.path}
                      </span>
                      <span className="ml-auto opacity-80">
                        {a.attemptedAt.slice(0, 16).replace("T", " ")} · {a.attemptedBy}
                      </span>
                    </div>
                    <p className="mt-0.5">
                      Blocked By:{" "}
                      {a.results
                        .filter((r) => a.blockedCheckIds.includes(r.id))
                        .map((r) => r.name)
                        .join(", ") || a.blockedCheckIds.join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
