"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface InboxItem {
  id: string;
  ticketId: string | null;
  accountName: string;
  carrier: string;
  requestLabel: string;
  premiumCents: number | null;
  premiumLabel: string;
  underwriterName: string;
  updatedAt: string;
  preview: string;
}

const SEEN_KEY = "uw-desk-inbox-seen";

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(ids: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
}

function playDing() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const ding = (freq: number, start: number, dur: number, gain = 0.08) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(gain, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    // Two soft “text message” pings
    ding(880, 0, 0.12, 0.07);
    ding(1174, 0.14, 0.18, 0.06);

    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Audio may be blocked until user gesture — ignore
  }
}

export function OperatorInbox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [pulse, setPulse] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: InboxItem[] };
      const next = data.items ?? [];

      if (!primed.current) {
        knownIds.current = new Set(next.map((i) => i.id));
        primed.current = true;
        setItems(next);
        return;
      }

      const fresh = next.filter((i) => !knownIds.current.has(i.id));
      if (fresh.length > 0) {
        playDing();
        setPulse(true);
        setTimeout(() => setPulse(false), 1600);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const first = fresh[0];
          new Notification("Needs Your Review", {
            body: first.preview,
            tag: first.id,
          });
        }
        // Auto-open tray on new ping — text-message feel
        setOpen(true);
      }

      knownIds.current = new Set(next.map((i) => i.id));
      setItems(next);
    } catch {
      // ignore network blips
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void fetchInbox());
    const id = setInterval(() => void fetchInbox(), 4000);
    function onRefresh() {
      void fetchInbox();
    }
    window.addEventListener("uw-desk-inbox-refresh", onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("uw-desk-inbox-refresh", onRefresh);
      window.removeEventListener("focus", onRefresh);
    };
  }, [fetchInbox]);

  const count = items.length;

  function enableBrowserNotify() {
    if (typeof Notification === "undefined") return;
    void Notification.requestPermission();
  }

  function openTicket(item: InboxItem) {
    const seen = loadSeen();
    seen.add(item.id);
    saveSeen(seen);
    setOpen(false);
    router.push(
      item.ticketId ? `/tickets/${item.ticketId}?tab=comms` : `/threads/${item.id}`,
    );
  }

  return (
    <>
      {/* Floating text-message style button */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          enableBrowserNotify();
        }}
        className={`fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition ${
          count > 0
            ? "bg-[var(--coral)] text-white"
            : "bg-[var(--navy)] text-white/90"
        } ${pulse ? "inbox-pulse scale-110" : "hover:scale-105"}`}
        aria-label={
          count > 0
            ? `${count} messages need your review`
            : "Operator inbox"
        }
      >
        <span className="text-lg" aria-hidden>
          ✉
        </span>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-raised)] px-1 text-[11px] font-bold text-[var(--coral)]">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[min(100vw-2rem,360px)] overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-2xl">
          <div className="flex items-center justify-between bg-[var(--navy)] px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">Needs Your Review</p>
              <p className="text-[11px] text-white/60">
                Chimes when an underwriter quotes over $500
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10"
            >
              Close
            </button>
          </div>

          {count === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
              Inbox clear. The agent handles quotes ≤ $500.
            </div>
          ) : (
            <ul className="max-h-[420px] divide-y divide-[var(--rule)] overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openTicket(item)}
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-[var(--sand)]/80"
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-700">
                      {item.carrier.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-[var(--ink)]">
                          {item.accountName}
                        </p>
                        <span className="shrink-0 text-[10px] font-semibold text-rose-600">
                          {item.premiumLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
                        {item.underwriterName}: quoted {item.premiumLabel} for{" "}
                        {item.requestLabel}. Select to reply.
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
