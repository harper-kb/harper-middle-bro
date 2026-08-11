"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { outstandingWorkItems, type DeskBundle } from "@/lib/desk/types";
import {
  SERVICE_LANE_LABELS,
  type ServiceLaneId,
  type WorkItem,
} from "@/lib/types";
import { pickNextWorkItem, explainWhyNext } from "@/lib/priority";

type StripKey = "assigned" | "parked" | "followUps" | "handoffs" | "doneToday";

const STRIP_TABS: { id: StripKey; label: string }[] = [
  { id: "assigned", label: "Assigned" },
  { id: "parked", label: "Parked" },
  { id: "followUps", label: "Follow-Ups" },
  { id: "handoffs", label: "Handoffs" },
  { id: "doneToday", label: "Done Today" },
];

/**
 * Unified Desk: next task + account context + personal strip.
 * Completing / skipping advances to the next highest-priority item.
 */
export function UnifiedDesk({ bundle }: { bundle: DeskBundle }) {
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [parked, setParked] = useState<Record<string, { until: string; reason: string }>>(
    {},
  );
  const [strip, setStrip] = useState<StripKey>("assigned");
  const [parkReason, setParkReason] = useState("");
  const [parkHours, setParkHours] = useState("4");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [laneFilter, setLaneFilter] = useState<ServiceLaneId | "all">("all");
  const [, startTransition] = useTransition();

  const exclude = useMemo(() => new Set(completedIds), [completedIds]);
  const liveQueue = useMemo(() => {
    return bundle.queue.map((item) => {
      const p = parked[item.id];
      if (!p) return item;
      return { ...item, parkedUntil: p.until, parkReason: p.reason };
    });
  }, [bundle.queue, parked]);

  const outstanding = useMemo(
    () => outstandingWorkItems(liveQueue, exclude),
    [exclude, liveQueue],
  );
  const current =
    outstanding.find((item) => item.id === focusedId) ??
    pickNextWorkItem(outstanding);
  const why = current ? explainWhyNext(current) : [];
  const currentAgentView = current ? bundle.agentViews[current.id] : null;
  const currentRecommendations = current
    ? (bundle.recommendations[current.id] ?? [])
    : [];

  function completeCurrent() {
    if (!current) return;
    startTransition(() => {
      setCompletedIds((ids) => [...ids, current.id]);
      setFocusedId(null);
    });
  }

  function parkCurrent() {
    if (!current || !parkReason.trim()) return;
    const hours = Math.max(1, Number(parkHours) || 4);
    const until = new Date(Date.now() + hours * 3_600_000).toISOString();
    startTransition(() => {
      setParked((prev) => ({
        ...prev,
        [current.id]: { until, reason: parkReason.trim() },
      }));
      setFocusedId(null);
      setParkReason("");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="space-y-4">
        <ServiceSystemsStatus bundle={bundle} />

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--ink)]">
          <span className="font-semibold">Sample Mode</span> — {bundle.modeReason}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Desk Queue</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              {outstanding.length} {outstanding.length === 1 ? "ticket" : "tickets"} outstanding
            </h2>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Completed and parked tickets are excluded.
          </p>
        </div>

        {!current ? (
          <div className="surface-card p-8 text-center">
            <p className="font-display text-2xl text-[var(--ink)]">Desk Clear</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              No next action in the queue. Browse a section or wait for new work.
            </p>
          </div>
        ) : (
          <div className="surface-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Next Action</p>
                <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                  {current.accountName}
                </h2>
                <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                  {current.title}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">{current.summary}</p>
              </div>
              <Link
                href={`/accounts/${current.accountId}`}
                className="btn-primary text-sm"
              >
                Open Account
              </Link>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
              <Signal label="Owner" value={current.owner.displayName ?? "Unassigned"} />
              <Signal label="Clock" value={current.clock.label} />
              <Signal label="Blocker" value={current.blocker?.label ?? "—"} />
              <Signal label="Action" value={current.nextActionLabel} />
              <Signal
                label="Agent"
                value={currentAgentView?.label ?? "Your Action"}
              />
            </dl>

            <div className="mt-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                Why This Is Next
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-[var(--ink)]">
                {why.map((r) => (
                  <li key={`${r.code}-${r.label}`}>
                    <span className="font-semibold">{r.label}</span>
                    {r.detail ? (
                      <span className="text-[var(--muted)]"> — {r.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {currentAgentView?.detail ? (
              <div className="mt-4 rounded-lg border border-[var(--rule)] bg-[var(--sand)]/40 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Service Agent
                </p>
                <p className="mt-1 text-sm text-[var(--ink)]">
                  {currentAgentView.detail}
                </p>
                {currentAgentView.reminderAt ? (
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Next wake {formatWake(currentAgentView.reminderAt)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 border-t border-[var(--rule)] pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Agent Recommendations
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {bundle.activation.agent.enabled
                    ? "Guarded actions require review + confirmation"
                    : "Preview only · Service Agent not activated"}
                </p>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {currentRecommendations.slice(0, 4).map((recommendation) => {
                  const inactive = !bundle.activation.agent.enabled;
                  const blocked = recommendation.gateState !== "available";
                  return (
                    <div
                      key={recommendation.id}
                      className="rounded-lg border border-[var(--rule)] px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--ink)]">
                            {recommendation.label}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
                            {recommendation.rationale}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost shrink-0 text-xs"
                          disabled={inactive || blocked}
                          title={
                            inactive
                              ? bundle.activation.agent.blockerLabel ?? undefined
                              : recommendation.blockerLabel ?? undefined
                          }
                        >
                          {recommendation.confirmation === "none"
                            ? "Prepare"
                            : "Review"}
                        </button>
                      </div>
                      {inactive || blocked ? (
                        <p className="mt-1.5 text-[11px] text-amber-700">
                          {inactive
                            ? bundle.activation.agent.blockerLabel
                            : recommendation.blockerLabel}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-[var(--rule)] pt-4">
              <button type="button" className="btn-primary" onClick={completeCurrent}>
                Complete — Next
              </button>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-[var(--muted)]">
                  Park Reason
                  <input
                    className="field mt-1 block min-w-[12rem]"
                    value={parkReason}
                    onChange={(e) => setParkReason(e.target.value)}
                    placeholder="Waiting on insured…"
                  />
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Wake (Hours)
                  <input
                    className="field mt-1 block w-20"
                    value={parkHours}
                    onChange={(e) => setParkHours(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={parkCurrent}
                  disabled={!parkReason.trim()}
                >
                  Park / Skip
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="surface-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                Outstanding Tickets
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Select any row to focus it in Next Action.
              </p>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Filter tickets by section">
              <LaneChip
                active={laneFilter === "all"}
                onClick={() => setLaneFilter("all")}
                label="All"
              />
              {[...new Set(outstanding.map((item) => item.homeLane))].map((lane) => (
                <LaneChip
                  key={lane}
                  active={laneFilter === lane}
                  onClick={() => setLaneFilter(lane)}
                  label={SERVICE_LANE_LABELS[lane]}
                />
              ))}
            </div>
          </div>
          <ol className="mt-3 divide-y divide-[var(--rule)]">
            {outstanding
              .filter((item) => laneFilter === "all" || item.homeLane === laneFilter)
              .map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setFocusedId(item.id)}
                    className={`grid w-full gap-2 px-2 py-3 text-left transition hover:bg-[var(--sand)]/50 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)] ${
                      item.id === current?.id ? "bg-[var(--sand)]/60" : ""
                    }`}
                  >
                    <CompactSignal label="What" value={`${item.accountName} — ${item.title}`} />
                    <CompactSignal label="Who" value={item.owner.displayName ?? "Unassigned"} />
                    <CompactSignal label="Clock" value={item.clock.label} alert={item.clock.breached} />
                    <CompactSignal label="Blocker" value={item.blocker?.label ?? "—"} />
                    <CompactSignal label="Action" value={item.nextActionLabel} />
                  </button>
                </li>
              ))}
          </ol>
          {outstanding.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">No outstanding tickets.</p>
          ) : null}
        </div>
      </section>

      <aside className="surface-card h-fit p-4">
        <p className="eyebrow">Personal Strip</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {STRIP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStrip(t.id)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                strip === t.id
                  ? "bg-[var(--sand)] text-[var(--ink)]"
                  : "text-[var(--muted)] hover:bg-[var(--sand)]/60"
              }`}
            >
              {t.label}
              <span className="ml-1 text-[var(--muted)]">
                {t.id === "doneToday"
                  ? bundle.strip.doneToday.length
                  : bundle.strip[t.id].length}
              </span>
            </button>
          ))}
        </div>
        <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
          {strip === "doneToday"
            ? bundle.strip.doneToday.map((d) => (
                <li key={d.id} className="rounded-lg border border-[var(--rule)] px-3 py-2">
                  <p className="text-sm font-semibold text-[var(--ink)]">{d.accountName}</p>
                  <p className="text-xs text-[var(--muted)]">{d.title}</p>
                </li>
              ))
            : bundle.strip[strip].map((item) => (
                <li key={item.id}>
                  <QueueRow
                    item={item}
                    agentLabel={bundle.agentViews[item.id]?.label}
                  />
                </li>
              ))}
          {(strip === "doneToday"
            ? bundle.strip.doneToday.length === 0
            : bundle.strip[strip].length === 0) && (
            <li className="py-6 text-center text-xs text-[var(--muted)]">
              Nothing here yet.
            </li>
          )}
        </ul>
      </aside>
    </div>
  );
}

function ServiceSystemsStatus({ bundle }: { bundle: DeskBundle }) {
  return (
    <section className="grid gap-2 md:grid-cols-2" aria-label="Service systems status">
      <div className="rounded-xl border border-sky-300/60 bg-sky-50/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--ink)]">Service Spine</p>
          <StatusDot active={bundle.activation.spine.enabled} />
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {bundle.spine.statusLabel}
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {bundle.spine.drivesDesk
            ? "Driving next-action order and auto-advance."
            : "Projection only — not driving queue order or auto-advance."}
          {bundle.spine.laneClock
            ? ` Proposed next: ${bundle.spine.urgency} · ${bundle.spine.laneClock}.`
            : ""}
        </p>
      </div>
      <div className="rounded-xl border border-violet-300/60 bg-violet-50/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--ink)]">Service Agent</p>
          <StatusDot active={bundle.activation.agent.enabled} />
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">{bundle.agent.summary}</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {bundle.activation.agent.enabled
            ? "Run status and human-task projection are live through Agent Tools."
            : "No agent runs are started or presented as live. Recommendations remain preview-only."}
        </p>
      </div>
    </section>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
        active
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-200 text-slate-700"
      }`}
    >
      {active ? "Active" : "Off"}
    </span>
  );
}

function formatWake(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function LaneChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        active
          ? "bg-[var(--ink)] text-[var(--paper)]"
          : "bg-[var(--sand)] text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
    </button>
  );
}

function CompactSignal({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </span>
      <span
        className={`mt-0.5 block truncate text-xs ${
          alert ? "font-semibold text-rose-700" : "text-[var(--ink)]"
        }`}
        title={value}
      >
        {value}
      </span>
    </span>
  );
}

function QueueRow({
  item,
  agentLabel,
}: {
  item: WorkItem;
  agentLabel?: string;
}) {
  return (
    <Link
      href={`/accounts/${item.accountId}`}
      className="block rounded-lg border border-[var(--rule)] px-3 py-2 transition hover:bg-[var(--sand)]/50"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink)]">{item.accountName}</p>
        {item.isOnFire ? (
          <span className="text-[10px] font-bold uppercase text-rose-600">Fire</span>
        ) : null}
      </div>
      <p className="text-xs text-[var(--muted)]">
        {item.title} · {item.clock.label} · {item.nextActionLabel}
      </p>
      {agentLabel ? (
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          {agentLabel}
        </p>
      ) : null}
    </Link>
  );
}
