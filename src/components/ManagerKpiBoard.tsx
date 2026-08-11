import type { HeadlineKpis, QueueHealthKpis } from "@/lib/manager/kpis";

function KpiCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl text-[var(--ink)]">{value}</p>
      {note ? <p className="mt-1 text-[11px] text-[var(--muted)]">{note}</p> : null}
    </div>
  );
}

export function ManagerKpiBoard({
  headline,
  queue,
}: {
  headline: HeadlineKpis;
  queue: QueueHealthKpis;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--ink)]">
        <span className="font-semibold">
          {headline.source === "sample" ? "Sample Metrics" : "Live Metrics"}
        </span>
        {" — "}
        {headline.sourceNote}
        {" · "}
        {headline.rangeLabel}
      </div>

      <section>
        <h2 className="font-display text-xl text-[var(--ink)]">Headline KPIs</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Incoming calls intentionally omitted.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="DocuSigns Signed" value={headline.docusignsSigned} />
          <KpiCard label="Binds Sent" value={headline.bindsSent} />
          <KpiCard label="Bind Backlog" value={headline.bindBacklog} />
          <KpiCard label="New Orders" value={headline.newOrders} />
          <KpiCard label="Bound Policies" value={headline.boundPolicies} />
          <KpiCard
            label="Bound Policies To Date"
            value={headline.boundPoliciesToDate}
          />
          <KpiCard label="COIs Sent" value={headline.coisSent} />
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl text-[var(--ink)]">Queue Health</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Queue Depth" value={queue.queueDepth} />
          <KpiCard
            label="Oldest Task"
            value={`${queue.oldestTaskAgeHours}h`}
          />
          <KpiCard
            label="SLA Hit Rate"
            value={
              queue.slaHitRate == null
                ? "—"
                : `${Math.round(queue.slaHitRate * 100)}%`
            }
          />
          <KpiCard label="Throughput" value={queue.throughput} />
          <KpiCard
            label="Rework Rate"
            value={
              queue.reworkRate == null
                ? "—"
                : `${Math.round(queue.reworkRate * 100)}%`
            }
          />
          <KpiCard label="Handoffs" value={queue.handoffs} />
        </div>
        <div className="mt-4 surface-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Blocked Reason Mix
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {queue.blockedReasonMix.map((row) => (
              <li key={row.reason} className="flex justify-between gap-3">
                <span>{row.reason}</span>
                <span className="font-semibold">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
