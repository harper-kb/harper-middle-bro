import Link from "next/link";
import { CommsCsvButton } from "@/components/CommsCsvButton";
import { DeskSection } from "@/components/DeskSection";
import { formatDate } from "@/lib/format";
import {
  describeAge,
  type TriageDigestResult,
  type TriageRisk,
} from "@/lib/triage-digest";

/**
 * The hourly spreadsheet, rendered. Server component — the page builds the
 * digest from real intake events and passes it in; the only client piece is
 * the Download CSV button.
 */

const CHANNEL_LABELS = {
  email: "Email",
  text: "Text",
  call: "Call",
} as const;

const RISK_LABELS: Record<TriageRisk, string> = {
  overdue: "Overdue",
  aging: "Aging",
  fresh: "Fresh",
};

const RISK_ROW_CLASSES: Record<TriageRisk, string> = {
  overdue: "bg-rose-50",
  aging: "bg-amber-50",
  fresh: "",
};

const RISK_CHIP_CLASSES: Record<TriageRisk, string> = {
  overdue: "bg-rose-100 text-rose-800 ring-rose-200",
  aging: "bg-amber-100 text-amber-800 ring-amber-200",
  fresh: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export function TriageDigest({
  digest,
  accountNamesById,
}: {
  digest: TriageDigestResult;
  accountNamesById: Record<string, string>;
}) {
  const { rows, totals } = digest;

  const accountName = (id: string | null) =>
    id ? (accountNamesById[id] ?? id) : "No Account Match";

  const csvHeaders = [
    "Time",
    "Channel",
    "From",
    "Contact",
    "Account",
    "Age (Minutes)",
    "Risk",
    "Finding",
    "Recommended Action",
  ];
  const csvRows = rows.map((r) => [
    r.at,
    CHANNEL_LABELS[r.channel],
    r.from,
    r.fromContact,
    accountName(r.account),
    r.ageMinutes,
    RISK_LABELS[r.risk],
    r.finding,
    r.recommendedAction,
  ]);

  return (
    <section>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Missed Calls Pending"
          value={String(totals.missedCallsPending)}
          hot={totals.missedCallsPending > 0}
        />
        <StatCard
          label="Emails Awaiting Acknowledgment"
          value={String(totals.emailsAwaitingAck)}
          hot={totals.emailsAwaitingAck > 0}
        />
        <StatCard
          label="Oldest Pending"
          value={
            totals.oldestPendingMinutes > 0
              ? describeAge(totals.oldestPendingMinutes)
              : "—"
          }
          hot={totals.oldestPendingMinutes >= 24 * 60}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">
          {rows.length} item{rows.length === 1 ? "" : "s"} require
          {rows.length === 1 ? "s" : ""} action · generated{" "}
          {formatDate(digest.generatedAt)}
        </p>
        <CommsCsvButton
          filename="triage-digest.csv"
          headers={csvHeaders}
          rows={csvRows}
        />
      </div>

      <div className="surface-card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--rule)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Age</th>
              <th className="px-4 py-3">Finding</th>
              <th className="px-4 py-3">Recommended Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-[var(--rule)] last:border-b-0 ${RISK_ROW_CLASSES[r.risk]}`}
              >
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-[var(--muted)]">
                  {formatDate(r.at)}
                </td>
                <td className="px-4 py-3">
                  <span className="chip">{CHANNEL_LABELS[r.channel]}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-[var(--ink)]">{r.from}</p>
                  <p className="font-mono text-[11px] text-[var(--muted)]">
                    {r.fromContact}
                  </p>
                </td>
                <td className="px-4 py-3 text-[var(--ink)]/85">
                  {accountName(r.account)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${RISK_CHIP_CLASSES[r.risk]}`}
                  >
                    {describeAge(r.ageMinutes)} · {RISK_LABELS[r.risk]}
                  </span>
                </td>
                <td className="max-w-[260px] px-4 py-3 text-xs leading-relaxed text-[var(--ink)]/85">
                  {r.finding}
                </td>
                <td className="max-w-[260px] px-4 py-3 text-xs leading-relaxed text-[var(--ink)]">
                  {r.recommendedAction}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-[var(--muted)]"
                >
                  No items require action — every communication is triaged.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <DeskSection title="How This Works">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            The digest is regenerated on load — the hourly cadence arrives with
            the live phone and mail integration. Rows are sorted by how long
            they have been waiting; work them on the{" "}
            <Link href="/pending" className="underline hover:text-[var(--ink)]">
              Pending
            </Link>{" "}
            board.
          </p>
        </DeskSection>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  hot,
}: {
  label: string;
  value: string;
  hot: boolean;
}) {
  return (
    <div className="surface-card px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1.5 font-display text-3xl tabular-nums ${
          hot ? "text-rose-700" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
