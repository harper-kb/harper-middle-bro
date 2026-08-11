"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { sortTicketsOldestFirst } from "@/lib/all-tickets";
import {
  SERVICE_LANE_IDS,
  SERVICE_LANE_LABELS,
  type ServiceLaneId,
  type WorkItem,
} from "@/lib/types";

type Scope = "all" | "mine" | "breached";

export function AllTicketsBoard({
  items,
  operatorId,
  now,
}: {
  items: WorkItem[];
  operatorId: string | null;
  now: string;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [lane, setLane] = useState<ServiceLaneId | "all">("all");
  const [owner, setOwner] = useState("all");
  const owners = useMemo(
    () =>
      [...new Set(items.map((item) => item.owner.displayName ?? "Unassigned"))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [items],
  );
  const visible = useMemo(
    () =>
      sortTicketsOldestFirst(items).filter((item) => {
        if (scope === "mine" && item.owner.operatorId !== operatorId) return false;
        if (scope === "breached" && !item.clock.breached) return false;
        if (lane !== "all" && item.homeLane !== lane) return false;
        if (owner !== "all" && (item.owner.displayName ?? "Unassigned") !== owner) {
          return false;
        }
        return true;
      }),
    [items, lane, operatorId, owner, scope],
  );

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--rule)] p-4">
        <div className="flex flex-wrap gap-1">
          {(["all", "mine", "breached"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                scope === id
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "bg-[var(--sand)] text-[var(--muted)]"
              }`}
            >
              {id === "all" ? "All" : id === "mine" ? "Mine" : "Breached"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs text-[var(--muted)]">
            Section
            <select
              className="field ml-2"
              value={lane}
              onChange={(event) => setLane(event.target.value as ServiceLaneId | "all")}
            >
              <option value="all">All sections</option>
              {SERVICE_LANE_IDS.map((id) => (
                <option key={id} value={id}>
                  {SERVICE_LANE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Owner
            <select
              className="field ml-2"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            >
              <option value="all">All owners</option>
              {owners.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-xs">
          <thead className="bg-[var(--sand)]/60 text-[10px] uppercase tracking-[0.1em] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3">Ticket</th>
              <th className="px-3 py-3">Section</th>
              <th className="px-3 py-3">Owner</th>
              <th className="px-3 py-3">Age</th>
              <th className="px-3 py-3">SLA</th>
              <th className="px-3 py-3">State</th>
              <th className="px-3 py-3">Blocker</th>
              <th className="px-3 py-3">Next Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--rule)]">
            {visible.map((item) => (
              <tr key={item.id} className="transition hover:bg-[var(--sand)]/40">
                <td className="px-4 py-3">
                  <Link
                    href={`/accounts/${item.accountId}`}
                    className="block font-semibold text-[var(--ink)] hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="text-[var(--muted)]">{item.accountName}</span>
                </td>
                <td className="px-3 py-3">{SERVICE_LANE_LABELS[item.homeLane]}</td>
                <td className="px-3 py-3">{item.owner.displayName ?? "Unassigned"}</td>
                <td className="px-3 py-3 font-mono">{formatAge(item.createdAt, now)}</td>
                <td className="px-3 py-3">{item.clock.label}</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-1 font-semibold ${
                      item.clock.breached
                        ? "bg-rose-100 text-rose-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {item.clock.breached ? "Breached" : "On track"}
                  </span>
                </td>
                <td className="px-3 py-3">{item.blocker?.label ?? "—"}</td>
                <td className="px-3 py-3 font-semibold">{item.nextActionLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
          No tickets match these filters.
        </p>
      ) : null}
    </section>
  );
}

function formatAge(createdAt: string, now: string): string {
  const hours = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(createdAt)) / 3_600_000),
  );
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

