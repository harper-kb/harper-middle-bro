"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { BookOrderListItem } from "@/lib/db";

function toDay(value: string | null): string {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function plusOneYear(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1]) + 1}-${match[2]}-${match[3]}` : "";
}

export function BindPolicyModal({
  order,
  companyId,
  accountName,
  bigBrotherHref,
  onClose,
}: {
  order: BookOrderListItem;
  companyId: string;
  accountName: string;
  bigBrotherHref: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const unbound = useMemo(
    () => order.rich.deals.filter((deal) => !deal.isBound),
    [order.rich.deals],
  );
  const [selectedDealId, setSelectedDealId] = useState(
    unbound[0]?.dealId ?? 0,
  );
  const selected = unbound.find((deal) => deal.dealId === selectedDealId);
  const [policyNumber, setPolicyNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    toDay(selected?.effectiveDate ?? null),
  );
  const [expirationDate, setExpirationDate] = useState(
    toDay(selected?.expirationDate ?? null),
  );
  const [available, setAvailable] = useState<boolean | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/orders/bind", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          available?: boolean;
          blocker?: string | null;
        };
        setAvailable(response.ok && body.available === true);
        setBlocker(body.blocker ?? null);
      })
      .catch(() => {
        setAvailable(false);
        setBlocker("Binding is temporarily unavailable from Step Bro.");
      });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function selectDeal(dealId: number) {
    const deal = unbound.find((candidate) => candidate.dealId === dealId);
    setSelectedDealId(dealId);
    setPolicyNumber("");
    setEffectiveDate(toDay(deal?.effectiveDate ?? null));
    setExpirationDate(toDay(deal?.expirationDate ?? null));
    setError(null);
  }

  async function bind() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/orders/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          orderId: order.harperOrderId,
          dealId: selected.dealId,
          policyNumber,
          effectiveDate,
          expirationDate,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "That bind did not go through.");
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("That bind did not go through. Try again or use BigBrother.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bind-policy-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--rule)] px-4 py-3">
          <div>
            <p className="eyebrow">Bind Policy</p>
            <h2
              id="bind-policy-title"
              className="mt-0.5 text-lg font-semibold text-[var(--ink)]"
            >
              Order #{order.harperOrderId} · {accountName}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Policy number and term dates use the governed Harper bind path.
              This action never sends a customer COI.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--sand)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Close Bind Policy"
          >
            ×
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {available === false ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <p className="font-semibold">Not live from here right now</p>
              <p className="mt-0.5 text-xs">{blocker}</p>
              <a
                href={bigBrotherHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex font-semibold underline underline-offset-2"
              >
                Open Bind Policy in BigBrother
              </a>
            </div>
          ) : null}

          {unbound.length > 1 ? (
            <label className="block text-xs font-semibold text-[var(--muted)]">
              Policy to bind
              <select
                value={selectedDealId}
                onChange={(event) => selectDeal(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {unbound.map((deal) => (
                  <option key={deal.dealId} value={deal.dealId}>
                    {deal.carrierName ?? `Deal #${deal.dealId}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Policy number
              <input
                value={policyNumber}
                onChange={(event) => setPolicyNumber(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Effective date
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => {
                  const value = event.target.value;
                  setEffectiveDate(value);
                  if (!expirationDate) setExpirationDate(plusOneYear(value));
                }}
                className="mt-1 w-full rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Expiration date
              <input
                type="date"
                value={expirationDate}
                onChange={(event) => setExpirationDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </label>
          </div>

          {error ? (
            <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--rule)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void bind()}
            disabled={
              available !== true ||
              busy ||
              !policyNumber.trim() ||
              !effectiveDate ||
              !expirationDate
            }
            className="rounded-lg border border-emerald-600/40 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Binding…" : "Bind Policy"}
          </button>
        </footer>
      </div>
    </div>
  );
}
