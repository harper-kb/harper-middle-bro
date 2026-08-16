"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearBotRecent,
  forgetBotEntry,
  loadBotMemory,
  rememberExchange,
  toggleBotPin,
  type BotMemoryEntry,
} from "@/lib/bot-memory";
import {
  askDeskBrain,
  askDeskWide,
  type DeskBrainBundle,
  type DeskBrainResult,
  type DeskWideBundle,
} from "@/lib/desk-brain";

/**
 * Step Bro Bot — the follow-you dock. Same doctrine as Desk Brain (no
 * model, cited answers, honest refusals), on every page. The /api/desk-brain
 * route hands over a structured bundle for the current scope; the question
 * never leaves this component — the deterministic engine answers client-side.
 */

type BotOperator = { id: string; name: string };

type BotPayload =
  | { operator: BotOperator; scope: "desk"; bundle: DeskWideBundle }
  | {
      operator: BotOperator;
      scope: "account" | "ticket";
      bundle: DeskBrainBundle;
    };

type BotStatus = "loading" | "ready" | "signed_out" | "error";

const DESK_SUGGESTIONS = [
  "How Many Tickets Are Open?",
  "What's Pending?",
  "Who Has The Most Open Tickets?",
  "Which Accounts Are Pre-Bind?",
  "Any Escalations?",
  "What Changed Today?",
];

const ACCOUNT_SUGGESTIONS = [
  "Account Status",
  "General Liability Limits",
  "Endorsements On File",
  "Blanket Additional Insured?",
  "Premium Of Each Policy",
];

const TICKET_SUGGESTIONS = [
  "Ticket Status",
  "Fast Path?",
  "Holder Info",
  "Thread Summary",
  ...ACCOUNT_SUGGESTIONS,
];

/** Route-derived scope: the query string the API route understands. */
function routeScopeQuery(pathname: string): string {
  const acct = pathname.match(/^\/accounts\/([^/]+)/);
  if (acct) return `account=${acct[1]}`;
  const tkt = pathname.match(/^\/tickets\/([^/]+)/);
  if (tkt) return `ticket=${tkt[1]}`;
  return "";
}

function scopeLabelFor(payload: BotPayload): string {
  if (payload.scope === "desk") return "Desk-Wide";
  if (payload.scope === "ticket" && payload.bundle.ticket) {
    return `${payload.bundle.ticket.srNumber} · ${payload.bundle.account.name}`;
  }
  return payload.bundle.account.name;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MiddleBroBot() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ask" | "memory">("ask");
  const [status, setStatus] = useState<BotStatus>("loading");
  const [payload, setPayload] = useState<BotPayload | null>(null);
  /** null = follow the route; "" = desk-wide; "account=…" / "ticket=…" */
  const [scopeOverride, setScopeOverride] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<DeskBrainResult | null>(null);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [memory, setMemory] = useState<BotMemoryEntry[]>([]);
  const pendingQuestion = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const routeQuery = routeScopeQuery(pathname);
  const effectiveQuery = scopeOverride ?? routeQuery;

  const runAsk = useCallback(
    (q: string, data: BotPayload, scopeQuery: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const r =
        data.scope === "desk"
          ? askDeskWide(trimmed, data.bundle)
          : askDeskBrain(trimmed, data.bundle);
      setAsked(trimmed);
      setResult(r);
      const updated = rememberExchange(data.operator.id, {
        question: trimmed,
        answer: r.answer,
        kind: r.kind,
        scopeKind: data.scope,
        scopeLabel: scopeLabelFor(data),
        scopeQuery,
      });
      setMemory(updated);
      setLastEntryId(updated[0]?.id ?? null);
    },
    [],
  );

  const fetchScope = useCallback(
    async (query: string) => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/desk-brain${query ? `?${query}` : ""}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          setPayload(null);
          setStatus("signed_out");
          return;
        }
        if (!res.ok) {
          setPayload(null);
          setStatus("error");
          return;
        }
        const data = (await res.json()) as BotPayload;
        setPayload(data);
        setStatus("ready");
        setMemory(loadBotMemory(data.operator.id));
        const pending = pendingQuestion.current;
        if (pending) {
          pendingQuestion.current = null;
          runAsk(pending, data, query);
        }
      } catch {
        setPayload(null);
        setStatus("error");
      }
    },
    [runAsk],
  );

  // New page → back to route scope, stale answer cleared.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setScopeOverride(null);
      setAsked(null);
      setResult(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void fetchScope(effectiveQuery), 0);
    return () => window.clearTimeout(timer);
  }, [open, effectiveQuery, fetchScope]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && tab === "ask" && status === "ready") {
      inputRef.current?.focus();
    }
  }, [open, tab, status]);

  function switchScope(query: string | null) {
    setScopeOverride(query);
    setAsked(null);
    setResult(null);
  }

  function reAsk(entry: BotMemoryEntry) {
    setTab("ask");
    setQuestion(entry.question);
    if (entry.scopeQuery === effectiveQuery && payload && status === "ready") {
      runAsk(entry.question, payload, effectiveQuery);
      return;
    }
    pendingQuestion.current = entry.question;
    switchScope(entry.scopeQuery);
  }

  const operatorId = payload?.operator.id ?? null;
  const suggestions =
    payload?.scope === "ticket"
      ? TICKET_SUGGESTIONS
      : payload?.scope === "account"
        ? ACCOUNT_SUGGESTIONS
        : DESK_SUGGESTIONS;
  const pinned = memory.filter((e) => e.pinned);
  const recent = memory.filter((e) => !e.pinned);
  const lastEntry = memory.find((e) => e.id === lastEntryId) ?? null;

  return (
    <div className="no-print print:hidden">
      {/* Launcher — compact pill left of the operator inbox bubble */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-[5.5rem] z-50 flex h-11 items-center gap-2 rounded-full border border-[var(--rule)] bg-[var(--paper)] px-4 shadow-xl transition hover:scale-105"
        aria-label={open ? "Close Step Bro" : "Open Step Bro"}
        aria-expanded={open}
      >
        <span
          className="h-2.5 w-2.5 rounded-sm bg-[var(--harper-orange)]"
          aria-hidden
        />
        <span className="text-sm font-semibold text-[var(--ink)]">
          Step Bro
        </span>
      </button>

      {open && (
        <div className="fixed bottom-[5.25rem] right-5 z-50 flex max-h-[70vh] w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--paper)] shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--rule)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-sm bg-[var(--harper-orange)]"
                aria-hidden
              />
              <p className="font-display text-lg leading-none text-[var(--ink)]">
                Step Bro
              </p>
            </div>
            <div className="flex items-center gap-1">
              {(["ask", "memory"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                    tab === t
                      ? "bg-[var(--sand)] text-[var(--ink)]"
                      : "text-[var(--muted)] hover:bg-[var(--sand)]/60"
                  }`}
                >
                  {t === "ask" ? "Ask" : "Memory"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-1 rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--sand)]/60"
              >
                Close
              </button>
            </div>
          </div>

          {/* Scope row */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--rule)] bg-[var(--sand)]/40 px-4 py-2">
            <span className="chip">
              {status === "ready" && payload
                ? payload.scope === "desk"
                  ? "Desk-Wide"
                  : `Scoped To: ${scopeLabelFor(payload)}`
                : "Scope Loading…"}
            </span>
            {status === "ready" && payload && payload.scope !== "desk" && (
              <button
                type="button"
                onClick={() => switchScope("")}
                className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
              >
                Go Desk-Wide
              </button>
            )}
            {scopeOverride !== null && routeQuery !== "" && (
              <button
                type="button"
                onClick={() => switchScope(null)}
                className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
              >
                Back To Page Scope
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {status === "signed_out" && (
              <div className="py-8 text-center">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  Sign In To Ask
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Step Bro answers only for a signed-in operator — the desk
                  record and your memory are keyed to your seat.
                </p>
              </div>
            )}
            {status === "error" && (
              <div className="py-8 text-center">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  Scope Unavailable
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  The desk record for this scope did not load.
                </p>
                <button
                  type="button"
                  onClick={() => switchScope("")}
                  className="mt-3 rounded-lg border border-[var(--rule)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--sand)]"
                >
                  Try Desk-Wide
                </button>
              </div>
            )}
            {status === "loading" && (
              <p className="py-8 text-center text-xs text-[var(--muted)]">
                Loading the record…
              </p>
            )}

            {status === "ready" && payload && tab === "ask" && (
              <>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    runAsk(question, payload, effectiveQuery);
                  }}
                >
                  <input
                    ref={inputRef}
                    className="field"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={
                      payload.scope === "desk"
                        ? "Ask About The Desk…"
                        : "Ask About This Record…"
                    }
                    aria-label="Ask Step Bro"
                  />
                  <button type="submit" className="btn-primary shrink-0">
                    Ask
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip transition hover:border-[var(--gold)]/60 hover:bg-[var(--sand)]"
                      onClick={() => {
                        setQuestion(s);
                        runAsk(s, payload, effectiveQuery);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {result && asked && (
                  <div
                    className={`mt-4 rounded-xl border px-4 py-3 ${
                      result.kind === "refusal"
                        ? "border-[var(--coral)]/30 bg-[var(--coral)]/5"
                        : "border-[var(--rule)] bg-white"
                    }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                      You Asked — {asked}
                    </p>
                    <p
                      className={`mt-1.5 text-sm leading-relaxed ${
                        result.kind === "refusal"
                          ? "font-medium text-[var(--coral)]"
                          : "text-[var(--ink)]"
                      }`}
                    >
                      {result.answer}
                    </p>
                    {result.kind === "answer" && result.citations.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {result.citations.map((c) =>
                          c.href ? (
                            <Link
                              key={`${c.label}-${c.href}`}
                              href={c.href}
                              className="chip transition hover:border-[var(--gold)]/60 hover:bg-[var(--sand)]"
                            >
                              {c.label}
                            </Link>
                          ) : (
                            <span key={c.label} className="chip">
                              {c.label}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {result.kind === "refusal" && (
                      <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                        Step Bro answers only what the desk record can back —
                        queue counts, escalations, intake, limits, forms,
                        threads, premiums, quote history, status.
                      </p>
                    )}
                    {lastEntry && operatorId && (
                      <div className="mt-2.5 border-t border-[var(--rule)] pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            setMemory(toggleBotPin(operatorId, lastEntry.id))
                          }
                          className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
                        >
                          {lastEntry.pinned ? "Unpin From Memory" : "Pin To Memory"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {status === "ready" && payload && tab === "memory" && (
              <div>
                {memory.length === 0 && (
                  <p className="py-8 text-center text-xs text-[var(--muted)]">
                    Nothing remembered yet. Questions you ask are recorded
                    here.
                  </p>
                )}
                {pinned.length > 0 && (
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    Pinned
                  </p>
                )}
                {[...pinned, ...recent].map((entry, i) => (
                  <div key={entry.id}>
                    {i === pinned.length && pinned.length > 0 && recent.length > 0 && (
                      <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                        Recent
                      </p>
                    )}
                    <div className="mb-2 rounded-xl border border-[var(--rule)] bg-white px-3 py-2.5">
                      <p className="text-xs font-semibold text-[var(--ink)]">
                        {entry.question}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                        {entry.answer}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="chip">{entry.scopeLabel}</span>
                        <span className="text-[10px] text-[var(--muted)]">
                          {timeLabel(entry.askedAt)}
                        </span>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => reAsk(entry)}
                          className="text-[11px] font-semibold text-[var(--ink)] underline-offset-2 hover:underline"
                        >
                          Re-Ask
                        </button>
                        {operatorId && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setMemory(toggleBotPin(operatorId, entry.id))
                              }
                              className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
                            >
                              {entry.pinned ? "Unpin" : "Pin"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setMemory(forgetBotEntry(operatorId, entry.id))
                              }
                              className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {recent.length > 0 && operatorId && (
                  <button
                    type="button"
                    onClick={() => setMemory(clearBotRecent(operatorId))}
                    className="mt-1 text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
                  >
                    Clear Recent
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--rule)] bg-[var(--sand)]/40 px-4 py-2">
            <p className="text-[10px] leading-snug text-[var(--muted)]">
              Deterministic — answers come from the desk record only, with
              citations. Memory lives in this browser; the sandbox has no
              synced profile store.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
