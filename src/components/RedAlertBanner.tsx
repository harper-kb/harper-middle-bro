"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The desk-wide stand-down strip. When any red alert is active — a No Loss
 * letter contradicted by a claims acknowledgment — this renders on every
 * page for every operator until a manager resolves it on the account page.
 * It cannot be dismissed; it can only be collapsed to a one-line strip so
 * the account name and the order to stand down stay in view.
 */

interface BannerAlert {
  id: string;
  accountId: string;
  accountName: string;
  noLossRef: string;
  claimsRef: string;
  raisedBy: string;
  raisedAt: string;
}

const POLL_MS = 60_000;

export function RedAlertBanner() {
  const [alerts, setAlerts] = useState<BannerAlert[]>([]);
  const [directive, setDirective] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/red-alerts", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          alerts: BannerAlert[];
          directive: string;
        };
        if (!alive) return;
        setAlerts(data.alerts);
        setDirective(data.directive);
      } catch {
        // Network hiccup — keep the last known state; never hide on error.
      }
    }
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="red-alert-banner no-print fixed inset-x-0 top-0 z-[70] border-b border-red-950 bg-red-700 text-white shadow-lg">
      <div className="flex items-center gap-3 px-4 py-1.5">
        <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">
          Red Alert
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {alerts.length === 1
            ? `${alerts[0].accountName} — No Loss Letter Contradicted By Claims Acknowledgment. Stand Down — Do Not Push.`
            : `${alerts.length} Accounts Under Stand-Down — No Loss / Claims Conflicts. Do Not Push.`}
        </p>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="shrink-0 rounded border border-white/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-white/10"
        >
          {collapsed ? "Details" : "Collapse"}
        </button>
      </div>
      {!collapsed && (
        <div className="border-t border-red-800 bg-red-800/60 px-4 py-2">
          <p className="max-w-4xl text-[11px] leading-relaxed text-red-50">
            {directive}
          </p>
          <ul className="mt-1.5 space-y-1">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
              >
                <Link
                  href={`/accounts/${a.accountId}`}
                  className="font-semibold underline decoration-red-300 underline-offset-2 hover:text-red-100"
                >
                  {a.accountName}
                </Link>
                <span className="text-red-100/90">
                  {a.noLossRef} {a.claimsRef}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-red-200">
                  Raised By {a.raisedBy}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
