"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Split account workspace tab contract (Step Bro CRM).
 * Depth lives here — section queues stay compact.
 */
export const ACCOUNT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "checkout", label: "Checkout Journey" },
  { id: "tickets", label: "Tickets" },
  { id: "communications", label: "Communications" },
  { id: "documents", label: "Documents" },
  { id: "certificates", label: "Certificates / COI" },
  { id: "portal", label: "Customer Portal" },
  { id: "actions", label: "Actions" },
] as const;

export type AccountTabId = (typeof ACCOUNT_TABS)[number]["id"];

export type AccountTabPanels = Partial<Record<AccountTabId, ReactNode>>;

function isTabId(value: string): value is AccountTabId {
  return ACCOUNT_TABS.some((t) => t.id === value);
}

const ACCOUNT_TAB_EVENT = "step-bro-account-tab";

function readHashTab(fallback: AccountTabId): AccountTabId {
  const fromHash = window.location.hash.replace(/^#/, "");
  return fromHash && isTabId(fromHash) ? fromHash : fallback;
}

function subscribeHashTab(onStoreChange: () => void): () => void {
  const handler = () => onStoreChange();
  window.addEventListener("hashchange", handler);
  window.addEventListener(ACCOUNT_TAB_EVENT, handler);
  return () => {
    window.removeEventListener("hashchange", handler);
    window.removeEventListener(ACCOUNT_TAB_EVENT, handler);
  };
}

export function AccountWorkspace({
  header,
  rail,
  panels,
  initialTab = "overview",
}: {
  header: ReactNode;
  /** Optional left rail (queue context / related work) */
  rail?: ReactNode;
  panels: AccountTabPanels;
  initialTab?: AccountTabId;
}) {
  const hashTab = useSyncExternalStore(
    subscribeHashTab,
    () => readHashTab(initialTab),
    () => initialTab,
  );
  const [overrideTab, setOverrideTab] = useState<AccountTabId | null>(null);
  const tab = overrideTab ?? hashTab;

  const selectTab = useCallback((id: AccountTabId) => {
    setOverrideTab(id);
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, "", url.toString());
    window.dispatchEvent(new Event(ACCOUNT_TAB_EVENT));
  }, []);

  const body = panels[tab] ?? (
    <p className="text-sm text-[var(--muted)]">Nothing in this tab yet.</p>
  );

  return (
    <div className="space-y-4">
      {header}
      <div
        className={`grid gap-4 ${rail ? "xl:grid-cols-[16rem_minmax(0,1fr)]" : ""}`}
      >
        {rail ? (
          <aside className="surface-card h-fit p-3 xl:sticky xl:top-4">
            {rail}
          </aside>
        ) : null}
        <div className="min-w-0">
          <div
            role="tablist"
            aria-label="Account workspace"
            className="flex flex-wrap gap-1 border-b border-[var(--rule)] pb-2"
          >
            {ACCOUNT_TABS.map((t) => {
              const available = panels[t.id] != null;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={!available}
                  onClick={() => selectTab(t.id)}
                  className={`rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
                    active
                      ? "bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-[var(--ink)]"
                      : available
                        ? "text-[var(--muted)] hover:bg-[var(--sand)] hover:text-[var(--ink)]"
                        : "cursor-not-allowed text-[var(--muted)]/50"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" className="mt-4">
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}
