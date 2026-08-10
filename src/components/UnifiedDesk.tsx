"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { DeskBundle } from "@/lib/desk/types";
import type { WorkItem } from "@/lib/types";
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
  const [, startTransition] = useTransition();

  const exclude = useMemo(() => new Set(completedIds), [completedIds]);
  const liveQueue = useMemo(() => {
    return bundle.queue.map((item) => {
      const p = parked[item.id];
      if (!p) return item;
      return { ...item, parkedUntil: p.until, parkReason: p.reason };
    });
  }, [bundle.queue, parked]);

  const current =
    pickNextWorkItem(liveQueue, { excludeIds: exclude }) ?? bundle.next;
  const why = current ? explainWhyNext(current) : [];

  function completeCurrent() {
    if (!current) return;
    startTransition(() => {
      setCompletedIds((ids) => [...ids, current.id]);
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
      setParkReason("");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="space-y-4">
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--ink)]">
          <span className="font-semibold">Sample Mode</span> — {bundle.modeReason}
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

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Signal label="Owner" value={current.owner.displayName ?? "Unassigned"} />
              <Signal label="Clock" value={current.clock.label} />
              <Signal label="Blocker" value={current.blocker?.label ?? "—"} />
              <Signal label="Action" value={current.nextActionLabel} />
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
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Up Next
          </p>
          <ol className="mt-2 space-y-2">
            {liveQueue
              .filter((i) => !exclude.has(i.id) && i.id !== current?.id)
              .slice(0, 5)
              .map((item) => (
                <QueueRow key={item.id} item={item} />
              ))}
          </ol>
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
                  <QueueRow item={item} />
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

function QueueRow({ item }: { item: WorkItem }) {
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
    </Link>
  );
}
