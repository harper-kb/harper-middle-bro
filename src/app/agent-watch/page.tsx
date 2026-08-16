import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import {
  runAgentWatch,
  SEVERITY_LABELS,
  WATCH_RULES,
  type WatchBlanket,
  type WatchFinding,
  type WatchReport,
  type WatchRuleId,
  type WatchSeverity,
} from "@/lib/agent-watch";
import { listDecisions, listIntakeEvents, listTickets } from "@/lib/db";
import { getPolicyFormSet, hasBlanketAi, hasBlanketWos } from "@/lib/forms";
import { getSessionOperator } from "@/lib/session";
import { traceKindLabel } from "@/lib/trace";

export const dynamic = "force-dynamic";

/**
 * Agent Watch — every action the desk's AI took, audited by rule, cited to
 * the record. The page only gathers data and lays it out; every judgment
 * comes from the pure engine in src/lib/agent-watch.ts.
 */

const SEVERITY_DOTS: Record<WatchSeverity, string> = {
  critical: "bg-rose-500",
  warn: "bg-amber-500",
  info: "bg-slate-400",
};

const SEVERITY_CARD: Record<WatchSeverity, string> = {
  critical: "border-rose-200 bg-rose-50",
  warn: "border-amber-200 bg-amber-50",
  info: "border-slate-200 bg-slate-50",
};

const SEVERITY_CHIP: Record<WatchSeverity, string> = {
  critical: "bg-rose-100 text-rose-900 ring-rose-200",
  warn: "bg-amber-100 text-amber-900 ring-amber-200",
  info: "bg-slate-100 text-slate-700 ring-slate-200",
};

export default async function AgentWatchPage() {
  const operator = await getSessionOperator();

  if (!operator) {
    return (
      <>
        <Nav active="/agent-watch" operator={operator} />
        <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
          <div>
            <h1 className="page-title text-3xl text-[var(--ink)]">
              Agent Watch
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Every action the desk&apos;s automation took, audited by rule and
              cited to the record. Sign in to open the audit.
            </p>
          </div>
          <section className="surface-card space-y-4 p-6">
            <p className="eyebrow">Clerk Sign In</p>
            <p className="text-sm text-[var(--muted)]">
              The audit reads the whole desk, so it sits behind a sign-in.
              Create an account or sign in; your desk operator profile is
              created on first login.
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

  // —— Gather the corpus and hand it to the pure engine ——

  const tickets = listTickets();
  const decisions = listDecisions();
  const intakeEvents = listIntakeEvents();

  const blanketByPolicyId: Record<string, WatchBlanket> = {};
  for (const t of tickets) {
    for (const p of t.policies) {
      if (blanketByPolicyId[p.id]) continue;
      const set = getPolicyFormSet(p);
      blanketByPolicyId[p.id] = {
        ai: hasBlanketAi(set),
        wos: hasBlanketWos(set),
      };
    }
  }

  const messages = tickets.flatMap((t) =>
    t.threads.flatMap((th) =>
      th.messages.map((m) => ({
        id: m.id,
        ticketId: t.id,
        direction: m.direction,
        createdAt: m.createdAt,
      })),
    ),
  );

  const report = runAgentWatch({
    asOf: new Date().toISOString(),
    tickets,
    blanketByPolicyId,
    decisions,
    messages,
    intakeEvents,
  });

  // —— Rail: one row per rule, plus the rollup overview ——

  const findingsByRule = new Map<WatchRuleId, WatchFinding[]>();
  for (const f of report.findings) {
    const list = findingsByRule.get(f.ruleId) ?? [];
    list.push(f);
    findingsByRule.set(f.ruleId, list);
  }

  const tabs = [
    { id: "fired", label: "Fired" },
    { id: "clean", label: "Clean" },
    { id: "critical", label: "Critical" },
    { id: "warn", label: "Warn" },
    { id: "info", label: "Info" },
  ];

  const items: DeskStageItem[] = [
    {
      id: "overview",
      meta: "ROLLUPS",
      dotClass: "bg-[var(--gold)]",
      dotTitle: "Aggregates",
      title: "Desk Rollups",
      sub: `${report.rollups.aiActionsTotal} Automated Actions · ${report.findings.length} Findings`,
      tabIds: [],
      searchText: "desk rollups overview totals aggregates activity",
    },
    ...WATCH_RULES.map((rule) => {
      const fired = findingsByRule.get(rule.id) ?? [];
      return {
        id: rule.id,
        meta: rule.severity.toUpperCase(),
        dotClass: fired.length ? SEVERITY_DOTS[rule.severity] : "bg-emerald-500",
        dotTitle: fired.length ? `${fired.length} Findings` : "No Findings",
        title: rule.title,
        sub:
          fired.length > 0
            ? `${fired.length} Finding${fired.length === 1 ? "" : "s"} · Checked ${report.checked[rule.id]} Records`
            : `0 Findings — Checked ${report.checked[rule.id]} Records`,
        tabIds: [fired.length ? "fired" : "clean", rule.severity],
        searchText: [rule.id, rule.title, rule.doctrine, rule.severity].join(
          " ",
        ),
      };
    }),
  ];

  const views: Record<string, DeskStageView> = {
    overview: buildOverviewView(report),
  };
  for (const rule of WATCH_RULES) {
    views[rule.id] = buildRuleView(
      rule.id,
      findingsByRule.get(rule.id) ?? [],
      report.checked[rule.id],
    );
  }

  const sev = report.totals.findingsBySeverity;

  return (
    <>
      <Nav active="/agent-watch" operator={operator} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div>
          <h1 className="page-title text-3xl text-[var(--ink)]">
            Agent Watch
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Every action the desk&apos;s automation took, audited by rule and
            cited to the record. Deterministic checks over the stored data;
            every flag names the exact tickets, events, and decisions that
            triggered it.
          </p>
        </div>

        {/* —— Totals strip —— */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Tickets Checked" value={report.totals.tickets} />
          <Stat label="Decisions Checked" value={report.totals.decisions} />
          <Stat label="Messages Checked" value={report.totals.messages} />
          <Stat label="Intake Checked" value={report.totals.intakeEvents} />
          <Stat
            label="Critical"
            value={sev.critical}
            tone={sev.critical > 0 ? "text-rose-700" : "text-emerald-700"}
          />
          <Stat
            label="Warn"
            value={sev.warn}
            tone={sev.warn > 0 ? "text-amber-700" : "text-emerald-700"}
          />
          <Stat
            label="Info"
            value={sev.info}
            tone={sev.info > 0 ? "text-slate-700" : "text-emerald-700"}
          />
        </section>

        <DeskStage
          railTitle="Audit Rules"
          searchPlaceholder="Rule, doctrine…"
          tabs={tabs}
          items={items}
          views={views}
          emptyRailNote="No Rules Match."
          emptyStageNote="Select A Rule From The Rail."
        />
      </main>
    </>
  );
}

// ————————————————— Stage views —————————————————

function buildOverviewView(report: WatchReport): DeskStageView {
  const r = report.rollups;
  const kinds = [
    ...new Set(r.aiActionsByDay.flatMap((d) => Object.keys(d.byKind))),
  ].sort();

  return {
    header: (
      <div>
        <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
          ROLLUPS
        </p>
        <h2 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.35rem)] leading-none tracking-[-0.02em] text-[var(--ink)]">
          Desk Rollups
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
          Aggregates over the same corpus the rules audited — counts, not
          judgments.
        </p>
      </div>
    ),
    panels: [
      {
        id: "totals",
        title: "Activity Totals",
        subtitle: `${r.aiActionsTotal} Automated Decisions On Record`,
        content: (
          <div className="px-6 pb-6 sm:px-8">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Automated Actions" value={r.aiActionsTotal} />
              <Stat label="Auto-Sends" value={r.autoSends} />
              <Stat label="Human Sends" value={r.humanSends} />
              <Stat label="Fast Paths" value={r.fastPaths.total} />
              <Stat label="Acknowledgments Sent" value={r.acksSent} />
            </dl>
          </div>
        ),
      },
      {
        id: "by-day",
        title: "Automated Activity By Day",
        subtitle: `${r.aiActionsByDay.length} Day${r.aiActionsByDay.length === 1 ? "" : "s"} With Automated Decisions`,
        content: (
          <div className="px-6 pb-6 sm:px-8">
            {r.aiActionsByDay.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No automated decisions on record.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--rule)] text-left">
                      <th className="py-2 pr-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                        Day
                      </th>
                      {kinds.map((k) => (
                        <th
                          key={k}
                          className="py-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
                        >
                          {traceKindLabel(k)}
                        </th>
                      ))}
                      <th className="py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.aiActionsByDay.map((d) => (
                      <tr
                        key={d.day}
                        className="border-b border-[var(--rule)]/60"
                      >
                        <td className="py-2 pr-4 font-mono text-xs text-[var(--ink)]">
                          {d.day}
                        </td>
                        {kinds.map((k) => (
                          <td
                            key={k}
                            className="py-2 pr-4 text-right font-mono text-xs text-[var(--ink)]"
                          >
                            {d.byKind[k] ?? "—"}
                          </td>
                        ))}
                        <td className="py-2 text-right font-mono text-xs font-semibold text-[var(--ink)]">
                          {d.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ),
      },
      {
        id: "fast-paths",
        title: "Fast Paths Applied",
        subtitle: `${r.fastPaths.total} Blanket Fast Path${r.fastPaths.total === 1 ? "" : "s"} On Record`,
        content: (
          <div className="px-6 pb-6 sm:px-8">
            {r.fastPaths.bases.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No ticket carries a fast-path basis.
              </p>
            ) : (
              <ul className="space-y-2">
                {r.fastPaths.bases.map((b) => (
                  <li
                    key={b.basis}
                    className="surface-card flex flex-wrap items-baseline justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0 break-words font-mono text-xs text-[var(--ink)]">
                      {b.basis}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-semibold text-[var(--ink)]">
                      ×{b.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
      },
      {
        id: "per-ticket",
        title: "Decisions Per Ticket",
        subtitle: "Densest Decision Trails First",
        defaultOpen: false,
        content: (
          <div className="px-6 pb-6 sm:px-8">
            {r.decisionsPerTicket.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No decision traces on record.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {r.decisionsPerTicket.slice(0, 15).map((row) => (
                  <li
                    key={row.ticketId}
                    className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)]/60 py-1.5"
                  >
                    <Link
                      href={`/tickets/${row.ticketId}`}
                      className="font-mono text-xs text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]"
                    >
                      {row.srNumber}
                    </Link>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {row.count} Decision{row.count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
      },
    ],
  };
}

function buildRuleView(
  ruleId: WatchRuleId,
  findings: WatchFinding[],
  checkedCount: number,
): DeskStageView {
  const rule = WATCH_RULES.find((r) => r.id === ruleId)!;

  return {
    header: (
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
            {rule.id}
          </p>
          <h2 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.35rem)] leading-none tracking-[-0.02em] text-[var(--ink)]">
            {rule.title}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            {rule.doctrine}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${SEVERITY_CHIP[rule.severity]}`}
          >
            {SEVERITY_LABELS[rule.severity]}
          </span>
          <p className="font-mono text-[11px] text-[var(--muted)]">
            Checked {checkedCount} Records
          </p>
        </div>
      </div>
    ),
    panels: [
      {
        id: "findings",
        title: "Findings",
        subtitle:
          findings.length > 0
            ? `${findings.length} Finding${findings.length === 1 ? "" : "s"} — Every One Cited To The Record`
            : "No Findings",
        content: (
          <div className="px-6 pb-6 sm:px-8">
            {findings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-8 text-center">
                <p className="font-display text-xl text-emerald-800">
                  No Findings
                </p>
                <p className="mt-1 text-sm text-emerald-900/70">
                  0 findings — checked {checkedCount} record
                  {checkedCount === 1 ? "" : "s"}. Nothing in the stored data
                  triggers this rule.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {findings.map((f, i) => (
                  <li
                    key={`${f.ruleId}-${i}`}
                    className={`rounded-xl border px-4 py-3 ${SEVERITY_CARD[f.severity]}`}
                  >
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {f.headline}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink)]/70">
                      {f.detail}
                    </p>
                    <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                        Cites
                      </span>
                      {f.citations.map((c) =>
                        c.href ? (
                          <Link
                            key={`${c.kind}-${c.id}`}
                            href={c.href}
                            className="font-mono text-[11px] text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]"
                          >
                            {c.label}
                          </Link>
                        ) : (
                          <span
                            key={`${c.kind}-${c.id}`}
                            className="font-mono text-[11px] text-[var(--ink)]"
                          >
                            {c.label}
                          </span>
                        ),
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
      },
    ],
  };
}

// ————————————————— Bits —————————————————

function Stat({
  label,
  value,
  tone = "text-[var(--ink)]",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="surface-card px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-lg font-semibold ${tone}`}>
        {value}
      </p>
    </div>
  );
}
