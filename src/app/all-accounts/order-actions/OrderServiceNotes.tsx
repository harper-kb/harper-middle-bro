"use client";

import { useCallback, useState } from "react";

type ServiceNote = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

export function OrderServiceNotes({
  accountId,
  orderId,
}: {
  accountId: string;
  orderId: number;
}) {
  const companyId = accountId.replace(/^co-/, "");
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<ServiceNote[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        companyId,
        orderId: String(orderId),
      });
      const response = await fetch(
        `/api/orders/service-notes?${params.toString()}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        notes?: ServiceNote[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Notes unavailable");
      setNotes(result.notes ?? []);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notes unavailable");
    } finally {
      setBusy(false);
    }
  }, [companyId, orderId]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) await load();
  }

  async function submit() {
    if (!body.trim() || body.trim().length > 2000) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/orders/service-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, orderId, body: body.trim() }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Note was not added");
      setBody("");
      setLoaded(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Note was not added");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 border-t border-dashed border-[var(--rule)] pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => void toggle()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:bg-[var(--sand)]/35 hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        ▱ {notes.length > 0 ? `${notes.length} service notes` : "Add note for service team"}
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          {busy && !loaded ? (
            <p className="text-center text-xs text-[var(--muted)]">
              Loading notes…
            </p>
          ) : null}
          {notes.length > 0 ? (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border border-[var(--rule)] bg-[var(--sand)]/25 px-2.5 py-2"
                >
                  <p className="whitespace-pre-wrap text-xs text-[var(--ink)]">
                    {note.body}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    {note.author}
                    {note.createdAt
                      ? ` · ${new Date(note.createdAt).toLocaleString("en-US")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : loaded ? (
            <p className="text-center text-xs text-[var(--muted)]">
              No service notes on this order yet.
            </p>
          ) : null}

          <div className="rounded-lg border border-[var(--rule)] bg-[var(--surface)] p-2">
            <textarea
              value={body}
              maxLength={2000}
              rows={2}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Add a concise note for the service team…"
              className="w-full resize-y bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] tabular-nums text-[var(--muted)]">
                {body.length.toLocaleString()}/2,000
              </span>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !body.trim()}
                className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? "Adding…" : "Add note"}
              </button>
            </div>
          </div>
          {error ? (
            <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
