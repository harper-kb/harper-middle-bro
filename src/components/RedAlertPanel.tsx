import {
  raiseRedAlertAction,
  resolveRedAlertAction,
} from "@/lib/desk-actions";
import { RED_ALERT_DIRECTIVE, type RedAlert } from "@/lib/red-alerts";
import type { Operator } from "@/lib/types";

/**
 * The account-page face of a red alert. The active alert renders loud with
 * both citations — the No Loss letter and the claims acknowledgment that
 * contradicts it — plus the stand-down directive. Any signed-in operator can
 * raise one; only a manager resolves, and only with a written note. Resolved
 * alerts stay on the account as history.
 */
export function RedAlertPanel({
  accountId,
  alerts,
  operator,
}: {
  accountId: string;
  alerts: RedAlert[];
  operator: Operator | null;
}) {
  const active = alerts.find((a) => a.resolvedAt == null) ?? null;
  const resolved = alerts.filter((a) => a.resolvedAt != null);
  const isManager = operator?.role === "manager";

  return (
    <section className="mb-8 space-y-3">
      {active && (
        <div className="overflow-hidden rounded-xl border-2 border-red-700 bg-red-50">
          <div className="flex flex-wrap items-center gap-2 bg-red-700 px-4 py-2">
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">
              Red Alert
            </span>
            <p className="text-sm font-semibold text-white">
              No Loss Letter Contradicted By Claims Acknowledgment — Stand Down
            </p>
          </div>
          <div className="space-y-2 px-4 py-3">
            <p className="text-sm font-semibold text-red-900">
              {RED_ALERT_DIRECTIVE}
            </p>
            <dl className="space-y-1.5 text-sm">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-red-800/70">
                  No Loss Letter On Record
                </dt>
                <dd className="text-red-950">{active.noLossRef}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-red-800/70">
                  Claims Acknowledgment
                </dt>
                <dd className="text-red-950">{active.claimsRef}</dd>
              </div>
              {active.note && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-red-800/70">
                    Note
                  </dt>
                  <dd className="text-red-950">{active.note}</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-red-800">
              Raised By {active.raisedBy} · {active.raisedAt.slice(0, 16).replace("T", " ")} ·
              While active: the blanket fast path and operator auto-send refuse
              this account.
            </p>
            {isManager ? (
              <form action={resolveRedAlertAction} className="space-y-2 pt-1">
                <input type="hidden" name="alertId" value={active.id} />
                <input type="hidden" name="accountId" value={accountId} />
                <textarea
                  name="resolutionNote"
                  required
                  rows={2}
                  placeholder="What was corrected, and how — the letter retracted, the carrier notified, the claims disclosed…"
                  className="field w-full text-sm"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-red-700 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Resolve With Note — Manager
                </button>
              </form>
            ) : (
              <p className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs text-red-800">
                Only a manager resolves a red alert, and only with a written
                resolution on record.
              </p>
            )}
          </div>
        </div>
      )}

      {!active && operator && (
        <details className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Report A No Loss / Claims Conflict
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            If a No Loss letter went out on this account and anyone —
            especially a sales representative — has since acknowledged claims,
            raise it here. The whole desk sees the alert immediately and the
            account stands down until a manager resolves it.
          </p>
          <form action={raiseRedAlertAction} className="mt-3 space-y-2">
            <input type="hidden" name="accountId" value={accountId} />
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                No Loss Letter On Record
              </span>
              <input
                name="noLossRef"
                required
                placeholder="What was sent, when, and to whom"
                className="field mt-1 w-full text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Claims Acknowledgment
              </span>
              <input
                name="claimsRef"
                required
                placeholder="Who acknowledged claims, where, and when"
                className="field mt-1 w-full text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Note (Optional)
              </span>
              <input
                name="note"
                placeholder="Anything else the desk should know"
                className="field mt-1 w-full text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
            >
              Raise Red Alert — Stand The Account Down
            </button>
          </form>
        </details>
      )}

      {resolved.length > 0 && (
        <details className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Resolved Red Alerts · {resolved.length}
          </summary>
          <ul className="mt-2 space-y-2">
            {resolved.map((a) => (
              <li key={a.id} className="text-xs leading-relaxed">
                <p className="font-semibold text-[var(--ink)]">
                  {a.noLossRef} — contradicted by: {a.claimsRef}
                </p>
                <p className="text-[var(--muted)]">
                  Raised By {a.raisedBy} · {a.raisedAt.slice(0, 10)} — Resolved
                  By {a.resolvedBy} · {a.resolvedAt?.slice(0, 10)}:{" "}
                  {a.resolutionNote}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
