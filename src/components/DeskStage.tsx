"use client";

import { useState, type ReactNode } from "react";

/**
 * DeskStage — the trace/oversight look extracted into a reusable shell.
 *
 * Ledger rail on the left (search + filter tabs + scrollable rows), stage on
 * the right (header + collapsible panels). Server pages fetch real data,
 * render the stage content per item, and pass everything in as plain props —
 * this component only owns selection, search, tab filtering, and collapse
 * state. Styling deliberately reuses the trace-* classes and design tokens
 * from globals.css so it reads as the same instrument as /trace.
 */

export interface DeskStageTab {
  id: string;
  label: string;
}

export interface DeskStageItem {
  id: string;
  /** Mono top-left slug — SR number, carrier, channel */
  meta: string;
  /** Tailwind bg-* class for the status dot; omit for no dot */
  dotClass?: string;
  dotTitle?: string;
  title: string;
  sub: string;
  /** Filter tabs this row belongs to ("all" is implicit) */
  tabIds: string[];
  /** Haystack for the rail search box */
  searchText: string;
}

export interface DeskStagePanel {
  id: string;
  title: string;
  subtitle: string;
  content: ReactNode;
  defaultOpen?: boolean;
}

export interface DeskStageView {
  header: ReactNode;
  panels: DeskStagePanel[];
}

export function DeskStage({
  railTitle,
  searchPlaceholder,
  tabs,
  items,
  views,
  emptyRailNote = "Nothing Matches.",
  emptyStageNote = "Select A Row From The Rail.",
}: {
  railTitle: string;
  searchPlaceholder: string;
  tabs: DeskStageTab[];
  items: DeskStageItem[];
  views: Record<string, DeskStageView>;
  emptyRailNote?: string;
  emptyStageNote?: string;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.id ?? null,
  );
  // Collapse overrides keyed `${itemId}:${panelId}` — untouched panels use
  // their defaultOpen, so switching rows resets to the intended layout.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>(
    {},
  );

  const needle = q.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (tab !== "all" && !item.tabIds.includes(tab)) return false;
    if (!needle) return true;
    return item.searchText.toLowerCase().includes(needle);
  });

  const selected =
    visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  const view = selected ? (views[selected.id] ?? null) : null;

  function panelOpen(itemId: string, panel: DeskStagePanel): boolean {
    return openOverrides[`${itemId}:${panel.id}`] ?? panel.defaultOpen ?? true;
  }

  function togglePanel(itemId: string, panel: DeskStagePanel) {
    const key = `${itemId}:${panel.id}`;
    setOpenOverrides((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? panel.defaultOpen ?? true),
    }));
  }

  return (
    <div className="trace-stage grid gap-0 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:overflow-hidden lg:rounded-[1.75rem] lg:ring-1 lg:ring-[var(--rule)]">
      {/* —— Rail —— */}
      <aside className="trace-ledger flex flex-col border-b border-[var(--rule)] bg-[var(--paper)] lg:border-b-0 lg:border-r">
        <div className="border-b border-[var(--rule)] px-5 py-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {railTitle}
          </p>
          <label className="sr-only" htmlFor="desk-stage-search">
            Search The Rail
          </label>
          <input
            id="desk-stage-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full border-0 bg-transparent p-0 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
            autoComplete="off"
          />
        </div>

        <div className="flex gap-0 overflow-x-auto border-b border-[var(--rule)] px-2">
          <RailTab on={tab === "all"} onClick={() => setTab("all")}>
            All
          </RailTab>
          {tabs.map((t) => (
            <RailTab key={t.id} on={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </RailTab>
          ))}
        </div>

        <ul className="max-h-[42vh] flex-1 overflow-y-auto lg:max-h-[min(70vh,820px)]">
          {visible.map((item) => {
            const on = item.id === selected?.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`trace-ledger-row group relative w-full px-5 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)] ${
                    on ? "trace-ledger-row-on" : ""
                  }`}
                >
                  {on && <span className="trace-ledger-mark" aria-hidden />}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-[11px] tracking-tight text-[var(--muted)]">
                      {item.meta || "—"}
                    </span>
                    {item.dotClass && (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClass}`}
                        title={item.dotTitle}
                      />
                    )}
                  </div>
                  <p
                    className={`mt-1.5 text-[13px] leading-snug ${
                      on
                        ? "font-medium text-[var(--ink)]"
                        : "text-[var(--ink)]/85 group-hover:text-[var(--ink)]"
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-[var(--muted)]">
                    {item.sub}
                  </p>
                </button>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-5 py-16 text-center text-sm text-[var(--muted)]">
              {emptyRailNote}
            </li>
          )}
        </ul>
      </aside>

      {/* —— Stage —— */}
      <section className="trace-stage-main min-w-0 bg-[color-mix(in_srgb,var(--pierre)_70%,white)]">
        {!selected || !view ? (
          <div className="flex min-h-[420px] items-center justify-center px-8 text-center">
            <p className="font-display text-2xl text-[var(--muted)]">
              {emptyStageNote}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="border-b border-[var(--rule)] px-6 py-5 sm:px-8">
              {view.header}
            </div>
            {view.panels.map((panel, i) => {
              const open = panelOpen(selected.id, panel);
              return (
                <div
                  key={panel.id}
                  className={i > 0 ? "border-t border-[var(--rule)]" : undefined}
                >
                  <button
                    type="button"
                    onClick={() => togglePanel(selected.id, panel)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-[var(--sand)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)] sm:px-8"
                    aria-expanded={open}
                  >
                    <div className="min-w-0">
                      <p className="eyebrow">{panel.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {panel.subtitle}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
                      {open ? "Collapse" : "Expand"}
                    </span>
                  </button>
                  {open && panel.content}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function RailTab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative shrink-0 px-3 py-3 text-[11px] font-medium tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)] ${
        on
          ? "text-[var(--ink)]"
          : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
      {on && (
        <span className="absolute inset-x-3 bottom-0 h-px bg-[var(--ink)]" />
      )}
    </button>
  );
}
