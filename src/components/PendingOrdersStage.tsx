"use client";

import Link from "next/link";
import {
  DeskStage,
  type DeskStageItem,
  type DeskStageView,
} from "@/components/DeskStage";
import {
  GATE_LABELS,
  GATE_ORDER,
  buildPendingOrderProgress,
  pendingOrderRowSignals,
  type GateId,
} from "@/lib/lanes/pending-orders";
import { sortWorkItems } from "@/lib/priority";
import type { LaneDataMode, WorkItem } from "@/lib/types";

function GateStrip({
  current,
  gates,
}: {
  current: GateId;
  gates: Record<GateId, string>;
}) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {GATE_ORDER.map((g) => {
        const state = gates[g];
        const active = g === current;
        return (
          <li
            key={g}
            title={`${g} — ${GATE_LABELS[g]} (${state})`}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
              state === "done"
                ? "bg-emerald-500/15 text-emerald-800"
                : active
                  ? "bg-[color-mix(in_srgb,var(--gold)_22%,transparent)] text-[var(--ink)] ring-1 ring-[var(--gold)]/40"
                  : state === "blocked"
                    ? "bg-rose-500/10 text-rose-700"
                    : "bg-[var(--sand)] text-[var(--muted)]"
            }`}
          >
            {g}
          </li>
        );
      })}
    </ol>
  );
}

export function PendingOrdersStage({
  items,
  mode,
  modeReason,
}: {
  items: WorkItem[];
  mode: LaneDataMode;
  modeReason: string | null;
}) {
  const sorted = sortWorkItems(items);
  const stageItems: DeskStageItem[] = sorted.map((wi) => {
    const signals = pendingOrderRowSignals(wi);
    return {
      id: wi.id,
      meta: signals.gate,
      dotClass: wi.isOnFire
        ? "bg-rose-500"
        : wi.clock.breached
          ? "bg-amber-500"
          : "bg-sky-500",
      title: wi.accountName,
      sub: [signals.what, signals.who, signals.clock, signals.blocker ?? "Clear", signals.action].join(
        " · ",
      ),
      tabIds: [signals.gate.toLowerCase()],
      searchText: [wi.accountName, wi.title, signals.what, signals.blocker ?? ""].join(" "),
    };
  });

  const views: Record<string, DeskStageView> = {};
  for (const wi of sorted) {
    const progress = buildPendingOrderProgress(wi);
    const signals = pendingOrderRowSignals(wi);
    views[wi.id] = {
      header: (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Pending Orders · {progress.currentGate}</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              {wi.accountName}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {GATE_LABELS[progress.currentGate]}
              {mode === "sample" ? " · Sample Mode" : " · Live"}
            </p>
          </div>
          <Link href={`/accounts/${wi.accountId}#checkout`} className="btn-primary text-sm">
            Open Checkout
          </Link>
        </div>
      ),
      panels: [
        {
          id: "gates",
          title: "G1–G6 Progression",
          subtitle: modeReason ?? "Order-grain checkout",
          defaultOpen: true,
          content: (
            <div className="space-y-3">
              <GateStrip current={progress.currentGate} gates={progress.gates} />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    What
                  </dt>
                  <dd>{signals.what}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    Who
                  </dt>
                  <dd>{signals.who}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    Clock
                  </dt>
                  <dd>{signals.clock}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    Blocker
                  </dt>
                  <dd>{signals.blocker ?? "—"}</dd>
                </div>
              </dl>
              {progress.bindReady ? (
                <p className="text-sm font-semibold text-emerald-700">
                  Bind Ready — confirm in Actions (human portal until safe door).
                </p>
              ) : null}
            </div>
          ),
        },
      ],
    };
  }

  return (
    <DeskStage
      railTitle="Pending Orders"
      searchPlaceholder="Search Orders…"
      tabs={GATE_ORDER.map((g) => ({ id: g.toLowerCase(), label: g }))}
      items={stageItems}
      views={views}
      emptyRailNote="No Pending Orders."
      emptyStageNote="Select An Order — G1–G6 Opens Beside The Queue."
    />
  );
}
