"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PathMap } from "./PathMap";
import { StepCard } from "./StepCard";
import { formatDate, formatMoney } from "@/lib/format";
import {
  TRACE_AUTHOR_LABELS,
  TRACE_KIND_LABELS,
  VERDICT_DOTS,
  traceKindLabel,
  type TraceKind,
} from "@/lib/trace";
import {
  OVERVIEW_OUTCOME_LABELS,
  OVERVIEW_OUTCOME_ORDER,
  type TraceOverview,
  type TraceOverviewLane,
  type TraceOverviewTicket,
  type TraceRowView,
  type TraceThreadMessageView,
  type TraceTicketView,
} from "@/lib/trace-view";

const PLAY_MS = 1600;

/**
 * Manager review stage with a zoom hierarchy:
 *
 *   Overview (whole desk, lane per carrier)
 *     → Ticket (network map + thread)
 *       → Decision (reasoning spine)
 *         → Step (one card)
 *
 * The breadcrumb always names the level; clicking a crumb zooms back up.
 * Operational tool, not decoration.
 */
export function TraceExplorer({
  rows,
  tickets,
  overview,
  initialTicketId,
}: {
  rows: TraceRowView[];
  tickets: TraceTicketView[];
  overview: TraceOverview;
  initialTicketId: string | null;
}) {
  const [ticketId, setTicketId] = useState<string | null>(initialTicketId);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialTicketId
      ? (rows.find((r) => r.ticketId === initialTicketId)?.id ?? null)
      : null,
  );
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [threadOpen, setThreadOpen] = useState(true);
  const [reasonOpen, setReasonOpen] = useState(true);
  const [mapOpen, setMapOpen] = useState(true);

  const scoped = useMemo(
    () => (ticketId ? rows.filter((r) => r.ticketId === ticketId) : []),
    [rows, ticketId],
  );

  const kindOptions = useMemo(() => {
    const present = (Object.keys(TRACE_KIND_LABELS) as TraceKind[]).filter(
      (k) => scoped.some((r) => r.kind === k),
    );
    return present;
  }, [scoped]);

  const needle = q.trim().toLowerCase();
  const visible = scoped.filter((r) => {
    if (kind !== "all" && r.kind !== kind) return false;
    if (!needle) return true;
    const hay = [
      r.headline,
      r.summary,
      r.account,
      r.srNumber,
      r.requestLabel,
      ...r.steps.flatMap((s) => [
        s.label,
        s.outcome,
        s.rule,
        ...s.inputs.map((i) => `${i.label} ${i.value}`),
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });

  // Explicitly deselected (ticket level) stays deselected; a stale pick
  // that a filter hid falls back to the first visible row, as before.
  const selected =
    selectedId == null
      ? null
      : (visible.find((r) => r.id === selectedId) ?? visible[0] ?? null);
  const ticket = ticketId
    ? (tickets.find((t) => t.id === ticketId) ?? null)
    : null;
  const steps = selected?.steps ?? [];
  const current = Math.min(step, Math.max(steps.length - 1, 0));

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= steps.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, PLAY_MS);
    return () => clearInterval(id);
  }, [playing, steps.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        setPlaying(false);
        setStep((s) => Math.min(s + 1, steps.length - 1));
      }
      if (e.key === "ArrowLeft") {
        setPlaying(false);
        setStep((s) => Math.max(s - 1, 0));
      }
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === "Escape") {
        setPlaying(false);
        if (selectedId != null) {
          setSelectedId(null);
          setStep(0);
        } else if (ticketId != null) {
          setTicketId(null);
          setQ("");
          setKind("all");
          setStep(0);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length, selectedId, ticketId]);

  function pick(id: string) {
    setSelectedId(id);
    setStep(0);
    setPlaying(false);
  }

  function drillTicket(id: string) {
    setTicketId(id);
    setQ("");
    setKind("all");
    setSelectedId(rows.find((r) => r.ticketId === id)?.id ?? null);
    setStep(0);
    setPlaying(false);
  }

  function zoomOverview() {
    setTicketId(null);
    setSelectedId(null);
    setQ("");
    setKind("all");
    setStep(0);
    setPlaying(false);
  }

  function zoomTicket() {
    setSelectedId(null);
    setStep(0);
    setPlaying(false);
  }

  function zoomDecision() {
    setStep(0);
    setPlaying(false);
  }

  const atOverview = ticket == null;

  return (
    <div>
      {/* —— Zoom breadcrumb —— */}
      <nav className="trace-zoom mb-5" aria-label="Zoom Level">
        <button
          type="button"
          onClick={zoomOverview}
          aria-current={atOverview ? "location" : undefined}
          className={`trace-zoom-crumb ${atOverview ? "on" : ""}`}
        >
          Overview
        </button>
        {ticket && (
          <>
            <span className="trace-zoom-sep" aria-hidden>
              /
            </span>
            <button
              type="button"
              onClick={zoomTicket}
              aria-current={selected == null ? "location" : undefined}
              className={`trace-zoom-crumb ${selected == null ? "on" : ""}`}
            >
              {ticket.srNumber || ticket.account}
            </button>
          </>
        )}
        {ticket && selected && (
          <>
            <span className="trace-zoom-sep" aria-hidden>
              /
            </span>
            <button
              type="button"
              onClick={zoomDecision}
              aria-current={steps.length === 0 ? "location" : undefined}
              className={`trace-zoom-crumb ${steps.length === 0 ? "on" : ""}`}
              title={selected.headline}
            >
              {traceKindLabel(selected.kind)}
            </button>
          </>
        )}
        {ticket && selected && steps.length > 0 && (
          <>
            <span className="trace-zoom-sep" aria-hidden>
              /
            </span>
            <span className="trace-zoom-crumb on" aria-current="location">
              Step {String(current + 1).padStart(2, "0")} Of{" "}
              {String(steps.length).padStart(2, "0")}
            </span>
          </>
        )}
      </nav>

      {atOverview ? (
        <OverviewStage overview={overview} onDrill={drillTicket} />
      ) : (
        <div className="trace-stage grid gap-0 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:overflow-hidden lg:rounded-[1.75rem] lg:ring-1 lg:ring-[var(--rule)]">
          {/* —— Ledger —— */}
          <aside className="trace-ledger flex flex-col border-b border-[var(--rule)] bg-[var(--paper)] lg:border-b-0 lg:border-r">
            <div className="border-b border-[var(--rule)] px-5 py-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Decision Ledger
              </p>
              <label className="sr-only" htmlFor="trace-search">
                Search Decisions
              </label>
              <input
                id="trace-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Headline, desk, step…"
                className="w-full border-0 bg-transparent p-0 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                autoComplete="off"
              />
            </div>

            <div className="flex gap-0 overflow-x-auto border-b border-[var(--rule)] px-2">
              <LedgerTab on={kind === "all"} onClick={() => setKind("all")}>
                All
              </LedgerTab>
              {kindOptions.map((k) => (
                <LedgerTab key={k} on={kind === k} onClick={() => setKind(k)}>
                  {TRACE_KIND_LABELS[k]}
                </LedgerTab>
              ))}
            </div>

            <ul className="max-h-[42vh] flex-1 overflow-y-auto lg:max-h-[min(70vh,820px)]">
              {visible.map((r) => {
                const on = r.id === selected?.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pick(r.id)}
                      className={`trace-ledger-row group relative w-full px-5 py-4 text-left transition ${
                        on ? "trace-ledger-row-on" : ""
                      }`}
                    >
                      {on && <span className="trace-ledger-mark" aria-hidden />}
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[11px] tracking-tight text-[var(--muted)]">
                          {r.srNumber || "—"}
                        </span>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${VERDICT_DOTS[r.verdict]}`}
                          title={r.verdict}
                        />
                      </div>
                      <p
                        className={`mt-1.5 text-[13px] leading-snug ${
                          on
                            ? "font-medium text-[var(--ink)]"
                            : "text-[var(--ink)]/85 group-hover:text-[var(--ink)]"
                        }`}
                      >
                        {r.headline}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-[var(--muted)]">
                        {r.account}
                        <span className="mx-1.5 opacity-40">·</span>
                        {TRACE_AUTHOR_LABELS[
                          r.author as keyof typeof TRACE_AUTHOR_LABELS
                        ] ?? r.author}
                        {r.hasModel && (
                          <>
                            <span className="mx-1.5 opacity-40">·</span>
                            <span className="text-[var(--gold)]">Model</span>
                          </>
                        )}
                      </p>
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="px-5 py-16 text-center text-sm text-[var(--muted)]">
                  Nothing Matches.
                </li>
              )}
            </ul>
          </aside>

          {/* —— Stage —— */}
          <section className="trace-stage-main min-w-0 bg-[color-mix(in_srgb,var(--pierre)_70%,white)]">
            <div className="flex flex-col">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--rule)] px-6 py-5 sm:px-8">
                <div className="min-w-0">
                  <p className="font-mono text-[12px] tracking-tight text-[var(--coral)]">
                    {ticket.srNumber || "SR —"}
                  </p>
                  <h2 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.35rem)] leading-none tracking-[-0.02em] text-[var(--ink)]">
                    {ticket.account}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
                    {ticket.subject}
                  </p>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    {ticket.requestLabel}
                    <span className="mx-1.5 opacity-40">·</span>
                    {ticket.carriers.join(", ") || "No Carrier"}
                    <span className="mx-1.5 opacity-40">·</span>
                    {ticket.threads} Thread{ticket.threads === 1 ? "" : "s"}
                    <span className="mx-1.5 opacity-40">·</span>
                    {ticket.messages} Message
                    {ticket.messages === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                    {ticket.statusLabel}
                  </p>
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="text-sm font-medium text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--ink)]"
                  >
                    Open Ticket
                  </Link>
                </div>
              </div>

              {/* Network map — wish-stick path */}
              <Collapsible
                title="Network Map"
                subtitle="Ticket Path · Gold Marks Carry Reasoning"
                open={mapOpen}
                onToggle={() => setMapOpen((v) => !v)}
              >
                <div className="trace-path-plane relative px-3 pb-2 pt-1 sm:px-5">
                  <PathMap
                    path={ticket.path}
                    decisionByMessage={ticket.decisionByMessage}
                    selectedMessageId={selected?.messageId ?? null}
                    onSelect={pick}
                  />
                  <p className="mt-3 px-2 text-[11px] leading-relaxed text-[var(--muted)]">
                    Click a gold node to load that decision&apos;s reasoning.
                    Each lane is a market desk on this request.
                  </p>
                </div>
              </Collapsible>

              {/* Thread */}
              <Collapsible
                title="Thread"
                subtitle={`${ticket.threadMessages.length} Messages · Chronological`}
                open={threadOpen}
                onToggle={() => setThreadOpen((v) => !v)}
                border
              >
                <ThreadPane
                  messages={ticket.threadMessages}
                  selectedMessageId={selected?.messageId ?? null}
                  decisionByMessage={ticket.decisionByMessage}
                  onSelectDecision={pick}
                />
              </Collapsible>

              {/* Reasoning */}
              {selected ? (
                <Collapsible
                  title="Automation Reasoning"
                  subtitle={`${traceKindLabel(selected.kind)} · ${formatDate(selected.createdAt)}`}
                  open={reasonOpen}
                  onToggle={() => setReasonOpen((v) => !v)}
                  border
                >
                  <div className="trace-reason px-6 py-6 sm:px-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 max-w-2xl">
                        <p className="font-display text-2xl leading-tight tracking-[-0.02em] text-[var(--ink)]">
                          {selected.headline}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                          {selected.summary}
                        </p>
                      </div>

                      <div className="trace-transport flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setPlaying(false);
                            setStep(Math.max(current - 1, 0));
                          }}
                          disabled={current === 0}
                          className="trace-transport-btn disabled:opacity-30"
                          aria-label="Previous Step"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (current >= steps.length - 1) setStep(0);
                            setPlaying(!playing);
                          }}
                          className="trace-transport-play"
                        >
                          {playing ? "Pause" : "Replay"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPlaying(false);
                            setStep(Math.min(current + 1, steps.length - 1));
                          }}
                          disabled={current >= steps.length - 1}
                          className="trace-transport-btn disabled:opacity-30"
                          aria-label="Next Step"
                        >
                          ›
                        </button>
                      </div>
                    </div>

                    <ol className="trace-spine mt-8">
                      {steps.map((s, i) => {
                        const on = i === current;
                        const past = i < current;
                        return (
                          <li key={s.id} className="trace-spine-item">
                            <button
                              type="button"
                              onClick={() => {
                                setPlaying(false);
                                setStep(i);
                              }}
                              className={`trace-spine-btn ${on ? "on" : ""} ${past ? "past" : ""}`}
                              aria-current={on ? "step" : undefined}
                            >
                              <span className="font-mono text-[11px] tabular-nums">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="trace-spine-label">
                                {s.label}
                              </span>
                              {s.source === "model" && (
                                <span className="trace-spine-model">◆</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ol>

                    <div className="mt-4 h-px w-full overflow-hidden bg-[var(--sand)]">
                      <div
                        className="pace-bar h-full transition-all duration-500 ease-out"
                        style={{
                          width: `${((current + 1) / Math.max(steps.length, 1)) * 100}%`,
                        }}
                      />
                    </div>

                    {steps[current] && (
                      <div
                        key={`${selected.id}-${current}`}
                        className="step-in mt-6"
                      >
                        <StepCard step={steps[current]} index={current} />
                      </div>
                    )}

                    <p className="mt-6 text-center font-mono text-[10px] tracking-wide text-[var(--muted)]">
                      ← → Step · Space Play · Esc Zoom Out · Collapse Sections
                      To Focus Review
                    </p>
                  </div>
                </Collapsible>
              ) : (
                <div className="border-t border-[var(--rule)] px-6 py-12 text-center sm:px-8">
                  <p className="font-display text-xl text-[var(--muted)]">
                    Pick A Decision From The Ledger To Read Its Reasoning.
                  </p>
                  <p className="mt-3 font-mono text-[10px] tracking-wide text-[var(--muted)]">
                    Esc Zooms Back To The Overview
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ——— Overview level ——— */

const OUTCOME_BEADS: Record<string, string> = {
  needs_you: "trace-ov-bead-needs_you",
  waiting: "trace-ov-bead-waiting",
  ready: "trace-ov-bead-ready",
  delivered: "trace-ov-bead-delivered",
};

function OverviewStage({
  overview,
  onDrill,
}: {
  overview: TraceOverview;
  onDrill: (ticketId: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const lanes = overview.lanes
    .map((lane) => ({
      lane,
      dots: needle
        ? lane.tickets.filter((t) =>
            [t.srNumber, t.account, t.requestLabel, t.statusLabel, ...t.carriers]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
        : lane.tickets,
    }))
    .filter((l) => l.dots.length > 0);

  const { totals } = overview;

  return (
    <div className="trace-stage overflow-hidden rounded-[1.75rem] ring-1 ring-[var(--rule)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--rule)] px-6 py-5 sm:px-8">
        <div className="min-w-0">
          <p className="eyebrow">Desk Overview</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            One lane per carrier · click a ticket dot to zoom into its map.
          </p>
        </div>
        <div className="w-56 max-w-full">
          <label className="sr-only" htmlFor="trace-ov-search">
            Filter Tickets
          </label>
          <input
            id="trace-ov-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SR, account, carrier…"
            className="field"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-[var(--rule)] px-6 py-4 sm:px-8">
        <OverviewStat label="Tickets" value={totals.tickets} />
        <OverviewStat label="Decisions Logged" value={totals.decisions} />
        <OverviewStat label="Auto-Sends" value={totals.autoSends} />
        <OverviewStat label="Model-Touched" value={totals.modelDecisions} />
        <OverviewStat label="Fast Path Issues" value={totals.fastPaths} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--rule)] px-6 py-3 sm:px-8">
        {OVERVIEW_OUTCOME_ORDER.map((o) => (
          <span
            key={o}
            className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"
          >
            <span
              className={`trace-ov-bead ${OUTCOME_BEADS[o]}`}
              aria-hidden
            />
            {OVERVIEW_OUTCOME_LABELS[o]}
            <span className="font-mono tabular-nums">
              {totals.outcomes[o]}
            </span>
          </span>
        ))}
      </div>

      <ul>
        {lanes.map(({ lane, dots }) => (
          <OverviewLane
            key={lane.carrier}
            lane={lane}
            dots={dots}
            onDrill={onDrill}
          />
        ))}
        {lanes.length === 0 && (
          <li className="px-6 py-16 text-center text-sm text-[var(--muted)] sm:px-8">
            {needle ? "Nothing Matches." : "No Tickets On The Desk Yet."}
          </li>
        )}
      </ul>

      <p className="border-t border-[var(--rule)] px-6 py-4 text-[11px] leading-relaxed text-[var(--muted)] sm:px-8">
        A ticket spanning carriers appears in each of its lanes; the totals
        above count it once. Gold-ringed dots issued on the blanket fast path
        — no market contact, zero threads. Dimmed dots have no decisions
        logged yet, so there is nothing to zoom into.
      </p>
    </div>
  );
}

function OverviewLane({
  lane,
  dots,
  onDrill,
}: {
  lane: TraceOverviewLane;
  dots: TraceOverviewTicket[];
  onDrill: (ticketId: string) => void;
}) {
  return (
    <li className="border-t border-[var(--rule)] px-6 py-5 first:border-t-0 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-lg tracking-[-0.01em] text-[var(--ink)]">
          {lane.carrier}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
          {lane.tickets.length} Ticket{lane.tickets.length === 1 ? "" : "s"}
          <span className="mx-1.5 opacity-40">·</span>
          {lane.decisions} Decision{lane.decisions === 1 ? "" : "s"}
          {lane.autoSends > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              {lane.autoSends} Auto-Send{lane.autoSends === 1 ? "" : "s"}
            </>
          )}
        </p>
      </div>
      <div className="trace-ov-dots mt-3">
        {dots.map((t) => {
          const title = [
            `${t.srNumber || "SR —"} · ${t.account}`,
            `${t.statusLabel} · ${t.requestLabel}`,
            `${t.decisions} Decision${t.decisions === 1 ? "" : "s"} · ${t.threads} Thread${t.threads === 1 ? "" : "s"} · ${t.messages} Message${t.messages === 1 ? "" : "s"}`,
            ...(t.fastPath ? ["Blanket Fast Path — No Market Contact"] : []),
            t.hasTrace
              ? "Click to zoom into the ticket map"
              : "No decisions logged yet — nothing to zoom into",
          ].join("\n");
          return (
            <button
              key={t.id}
              type="button"
              disabled={!t.hasTrace}
              onClick={t.hasTrace ? () => onDrill(t.id) : undefined}
              className={`trace-ov-dot ${t.fastPath ? "fp" : ""}`}
              title={title}
            >
              <span
                className={`trace-ov-bead ${OUTCOME_BEADS[t.outcome]}`}
                aria-hidden
              />
              <span className="font-mono text-[11px] tracking-tight">
                {t.srNumber || "—"}
              </span>
            </button>
          );
        })}
      </div>
    </li>
  );
}

function OverviewStat({ label, value }: { label: string; value: number }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-display text-2xl tabular-nums tracking-[-0.02em] text-[var(--ink)]">
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </span>
    </p>
  );
}

/* ——— Shared panes ——— */

function Collapsible({
  title,
  subtitle,
  open,
  onToggle,
  border,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  border?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={border ? "border-t border-[var(--rule)]" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left sm:px-8"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="eyebrow">{title}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
          {open ? "Collapse" : "Expand"}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function ThreadPane({
  messages,
  selectedMessageId,
  decisionByMessage,
  onSelectDecision,
}: {
  messages: TraceThreadMessageView[];
  selectedMessageId: string | null;
  decisionByMessage: Record<string, string>;
  onSelectDecision: (decisionId: string) => void;
}) {
  if (messages.length === 0) {
    return (
      <p className="px-6 pb-6 text-sm text-[var(--muted)] sm:px-8">
        No messages on this ticket yet.
      </p>
    );
  }

  return (
    <ul className="max-h-[min(48vh,520px)] space-y-0 overflow-y-auto px-6 pb-6 sm:px-8">
      {messages.map((m) => {
        const decisionId = decisionByMessage[m.id] ?? null;
        const on = m.id === selectedMessageId;
        return (
          <li
            key={m.id}
            className={`border-l-2 py-4 pl-4 ${
              on
                ? "border-[var(--coral)] bg-[color-mix(in_srgb,var(--sand)_45%,transparent)]"
                : "border-[var(--rule)]"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {m.direction === "inbound" ? "Inbound" : "Outbound"}
                <span className="mx-1.5 opacity-40">·</span>
                {m.party === "client" ? "Client" : "Underwriter"}
                <span className="mx-1.5 opacity-40">·</span>
                {m.channel}
              </p>
              <time className="font-mono text-[10px] text-[var(--muted)]">
                {formatDate(m.createdAt)}
              </time>
            </div>
            <p className="mt-1.5 text-sm font-medium text-[var(--ink)]">
              {m.subject || "(No Subject)"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {m.desk} · {m.carrier}
              {m.toEmail ? ` · ${m.toName} <${m.toEmail}>` : ` · ${m.toName}`}
              {m.premiumImpactCents != null && (
                <>
                  {" · "}
                  {m.premiumImpactCents === 0
                    ? "No Charge"
                    : formatMoney(m.premiumImpactCents)}
                </>
              )}
            </p>
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--ink)]/90">
              {m.body}
            </pre>
            {decisionId && (
              <button
                type="button"
                onClick={() => onSelectDecision(decisionId)}
                className="mt-3 text-xs font-medium text-[var(--coral)] underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--coral)]"
              >
                {on ? "Viewing Reasoning" : "Open Reasoning For This Message"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LedgerTab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative shrink-0 px-3 py-3 text-[11px] font-medium tracking-wide transition ${
        on
          ? "text-[var(--ink)]"
          : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
      {on && (
        <span className="absolute inset-x-3 bottom-0 h-px bg-[var(--accent)]" />
      )}
    </button>
  );
}
