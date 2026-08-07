"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  REQUEST_TYPES,
  coverageLabels,
  formatRequestStackLabel,
  getRequestType,
  premiumBearingLabel,
} from "@/lib/catalog";
import { sendSandboxAction } from "@/lib/actions";
import {
  EmailStatusChip,
  emailGateOpen,
  emailGateReason,
  useEmailCheck,
} from "@/components/ContactValidation";
import {
  EMAIL_TEMPLATES,
  renderEmailBody,
  type EmailTemplateId,
} from "@/lib/templates";
import { DeskTour, restartDeskTour } from "@/components/DeskTour";
import { UwCard } from "@/components/UwCard";
import type { AccountDetail, Operator, RequestTypeId } from "@/lib/types";

const QUICK_ADD: RequestTypeId[] = [
  "additional_insured",
  "waiver_of_subrogation",
  "notice_cancellation_30",
  "business_change",
  "primary_non_contributory",
];

type StackLine = {
  key: string;
  typeId: RequestTypeId;
  note: string;
};

function newLine(typeId: RequestTypeId): StackLine {
  return {
    key: `${typeId}-${Math.random().toString(36).slice(2, 8)}`,
    typeId,
    note: "",
  };
}

export function SandboxCompose({
  accounts,
  operator,
}: {
  accounts: AccountDetail[];
  operator: Operator | null;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [stack, setStack] = useState<StackLine[]>([
    newLine("additional_insured"),
  ]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [templateId, setTemplateId] = useState<EmailTemplateId>(
    operator?.defaultTemplate ?? "standard",
  );
  const [sharedDetails, setSharedDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tourForce, setTourForce] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, 10);
    return accounts
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.dba?.toLowerCase().includes(q) ?? false) ||
          a.industry.toLowerCase().includes(q) ||
          a.state.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [accounts, query]);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const policy =
    account?.policies.find((p) => p.id === policyId) ??
    account?.policies[0] ??
    null;

  useEffect(() => {
    if (account && !policyId && account.policies[0]) {
      setPolicyId(account.policies[0].id);
    }
  }, [account, policyId]);

  // Recipient hard gate — the primary UW email on file must take mail
  // before anything leaves this desk. Wrong email = stop, fix it first.
  const recipientCheck = useEmailCheck(account?.primaryUw.email ?? "");
  const recipientOk = !account || emailGateOpen(recipientCheck, true);

  const typeIds = useMemo(() => stack.map((l) => l.typeId), [stack]);
  const stackLabel = formatRequestStackLabel(typeIds);

  const composedDetails = useMemo(() => {
    const parts: string[] = [];
    if (sharedDetails.trim()) parts.push(sharedDetails.trim());
    for (const line of stack) {
      const r = getRequestType(line.typeId);
      if (line.note.trim()) {
        parts.push(`${r.label}: ${line.note.trim()}`);
      }
    }
    return parts.join("\n\n");
  }, [sharedDetails, stack]);

  const requestItems = useMemo(
    () =>
      stack.map((l) => {
        const r = getRequestType(l.typeId);
        return `${r.label}${l.note.trim() ? ` — ${l.note.trim()}` : ""}`;
      }),
    [stack],
  );

  const preview = useMemo(() => {
    if (!account || !policy || !operator) return "";
    return renderEmailBody(templateId, {
      uwName: account.primaryUw.name,
      accountName: account.name,
      policyNumber: policy.policyNumber,
      carrier: policy.carrier,
      coverages: coverageLabels(policy.coverages),
      requestLabel: stackLabel,
      requestItems: stack.length > 1 ? requestItems : undefined,
      details: composedDetails,
      signature: operator.signature,
    });
  }, [
    account,
    policy,
    operator,
    templateId,
    stackLabel,
    requestItems,
    composedDetails,
    stack.length,
  ]);

  const catalogFiltered = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return REQUEST_TYPES;
    return REQUEST_TYPES.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.shortLabel.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [catalogQuery]);

  const premiumSummary = useMemo(() => {
    const usually = stack.filter(
      (l) => getRequestType(l.typeId).premiumBearing === "usually",
    ).length;
    const sometimes = stack.filter(
      (l) => getRequestType(l.typeId).premiumBearing === "sometimes",
    ).length;
    return { usually, sometimes };
  }, [stack]);

  const pickAccount = useCallback(
    (id: string) => {
      const a = accounts.find((x) => x.id === id);
      setAccountId(id);
      setPolicyId(a?.policies[0]?.id ?? null);
      setQuery(a?.name ?? "");
      setError(null);
      detailsRef.current?.focus();
    },
    [accounts],
  );

  const addToStack = useCallback((typeId: RequestTypeId) => {
    setStack((prev) => [...prev, newLine(typeId)]);
  }, []);

  const removeLine = useCallback((key: string) => {
    setStack((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }, []);

  const send = useCallback(() => {
    if (!operator) {
      setError("Sign in on Profile first — your signature stamps every draft.");
      return;
    }
    if (!accountId || !policyId) {
      setError("Select an account and policy first.");
      return;
    }
    if (stack.length === 0) {
      setError("Add at least one request to the stack.");
      return;
    }
    if (!recipientOk) {
      setError(
        `${emailGateReason(recipientCheck) ?? "Recipient Email Unverified"} — correct the underwriter email on file before sending.`,
      );
      return;
    }
    setError(null);
    const form = new FormData();
    form.set("accountId", accountId);
    form.set("policyId", policyId);
    form.set("requestTypes", JSON.stringify(typeIds));
    form.set("templateId", templateId);
    form.set("details", composedDetails);
    startTransition(async () => {
      try {
        const result = await sendSandboxAction(form);
        router.push(`/threads/${result.threadId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      }
    });
  }, [
    operator,
    accountId,
    policyId,
    stack.length,
    typeIds,
    templateId,
    composedDetails,
    recipientOk,
    recipientCheck,
    router,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  return (
    <>
      <DeskTour
        signedIn={Boolean(operator)}
        forceOpen={tourForce}
        onClose={() => setTourForce(false)}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          {accounts.length} accounts in the book · combine multiple requests in one send
        </p>
        <button
          type="button"
          onClick={() => {
            restartDeskTour();
            setTourForce(true);
          }}
          className="text-xs text-[var(--muted)] underline"
          data-tour="tour-welcome"
        >
          Replay Walkthrough
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-5">
          <div className="glass rounded-2xl p-5" data-tour="tour-account">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="eyebrow">1 · Account</p>
              <span className="text-[11px] text-[var(--muted)]">
                Press <kbd className="chip">/</kbd> to search
              </span>
            </div>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setAccountId(null);
              }}
              placeholder="Type a company name…"
              className="field text-base"
              autoComplete="off"
            />
            {!account && (
              <ul className="mt-3 max-h-64 space-y-1 overflow-auto">
                {filtered.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => pickAccount(a.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left ring-1 ring-[var(--rule)] transition hover:ring-[var(--gold)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--ink)]">
                          {a.name}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--muted)]">
                          {a.industry}
                          {a.dba ? ` · DBA ${a.dba}` : ""} · {a.state}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">
                        {a.primaryUw.carrier}
                      </span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-2 py-4 text-sm text-[var(--muted)]">
                    No accounts match.
                  </li>
                )}
              </ul>
            )}
            {account && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--ink)] px-3 py-1 text-xs font-medium text-white">
                  {account.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAccountId(null);
                    setPolicyId(null);
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="text-xs text-[var(--muted)] underline"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {account && (
            <div className="glass rounded-2xl p-5">
              <p className="eyebrow mb-3">Policy</p>
              <div className="space-y-1.5">
                {account.policies.map((p) => {
                  const on = p.id === (policy?.id ?? "");
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPolicyId(p.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left ring-1 transition ${
                        on
                          ? "bg-[var(--ink)] text-white ring-[var(--ink)]"
                          : "bg-white text-[var(--ink)] ring-[var(--rule)] hover:ring-[var(--gold)]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {p.policyNumber} · {p.carrier}
                        </span>
                        <span
                          className={`block truncate text-[11px] ${on ? "text-white/60" : "text-[var(--muted)]"}`}
                        >
                          {coverageLabels(p.coverages)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl p-5" data-tour="tour-stack">
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="eyebrow">2 · Request Stack</p>
              <span className="text-[11px] text-[var(--muted)]">
                Include every request in one submission
              </span>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
              Begin with the Additional Insured request, then add Waiver Of
              Subrogation, 30-Day Notice Of Cancellation, business changes, and
              anything else the contract requires. Every request travels in a
              single thread of record.
            </p>

            <div className="mb-4 flex flex-wrap gap-2">
              {QUICK_ADD.map((id) => {
                const r = getRequestType(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => addToStack(id)}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink)] ring-1 ring-[var(--rule)] transition hover:ring-[var(--gold)]"
                    title={r.description}
                  >
                    + {r.shortLabel}
                  </button>
                );
              })}
            </div>

            <ul className="space-y-3">
              {stack.map((line, idx) => {
                const r = getRequestType(line.typeId);
                return (
                  <li
                    key={line.key}
                    className="rounded-xl bg-[var(--sand)]/50 p-3.5 ring-1 ring-[var(--rule)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--ink)]">
                          {idx + 1}. {r.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {premiumBearingLabel(r.premiumBearing)} · {r.premiumNote}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={stack.length <= 1}
                        className="text-[11px] text-[var(--muted)] underline disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      value={line.note}
                      onChange={(e) =>
                        setStack((prev) =>
                          prev.map((l) =>
                            l.key === line.key
                              ? { ...l, note: e.target.value }
                              : l,
                          ),
                        )
                      }
                      placeholder={r.detailHint}
                      className="field mt-2 text-[13px]"
                    />
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 border-t border-[var(--rule)] pt-4">
              <p className="eyebrow mb-2">Add From Catalog</p>
              <input
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Search types (limits, renewal, correction…)"
                className="field mb-2 text-sm"
              />
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto">
                {catalogFiltered.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addToStack(r.id)}
                    className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
                    title={`${r.description} — ${r.premiumNote}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl p-5" data-tour="tour-premium">
            <p className="eyebrow mb-3">Premium Outlook</p>
            <p className="text-sm leading-relaxed text-[var(--ink)]">
              {premiumSummary.usually > 0 ? (
                <>
                  <span className="font-medium text-[var(--coral)]">
                    {premiumSummary.usually} item
                    {premiumSummary.usually === 1 ? "" : "s"} usually
                    premium-bearing
                  </span>
                  {" — expect a quote before you can issue."}
                </>
              ) : premiumSummary.sometimes > 0 ? (
                <>
                  <span className="font-medium">
                    {premiumSummary.sometimes} item
                    {premiumSummary.sometimes === 1 ? "" : "s"} may carry
                    premium
                  </span>
                  {" — market-dependent (blanket forms, scheduled Additional Insured, NEXT fees)."}
                </>
              ) : (
                <>
                  This stack is mostly wording and certificate work — premium
                  is uncommon, but always confirm with the market.
                </>
              )}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Auto-approval still applies once a quote arrives at ≤ $500.
            </p>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow">3 · Shared Context</p>
              <div className="flex flex-wrap gap-1.5">
                {EMAIL_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      t.id === templateId
                        ? "bg-[var(--ink)] text-white"
                        : "bg-white text-[var(--muted)] ring-1 ring-[var(--rule)]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={detailsRef}
              value={sharedDetails}
              onChange={(e) => setSharedDetails(e.target.value)}
              rows={4}
              placeholder="Contract cite, need-by date, job site — anything that applies to the whole stack…"
              className="field font-mono text-[13px] leading-relaxed"
            />
          </div>

          <div className="glass rounded-2xl p-5" data-tour="tour-send">
            <p className="eyebrow mb-3">Preview · {stackLabel}</p>
            {!operator ? (
              <p className="text-sm text-[var(--coral)]">
                Sign in on Profile so drafts carry your signature.
              </p>
            ) : !account || !policy ? (
              <p className="text-sm text-[var(--muted)]">
                Select an account to preview the email.
              </p>
            ) : (
              <pre className="whitespace-pre-wrap rounded-xl bg-[var(--sand)]/60 p-4 font-mono text-[12px] leading-relaxed text-[var(--ink)]">
                {preview}
              </pre>
            )}
            {account && (
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                <span>To {account.primaryUw.email}</span>
                <EmailStatusChip check={recipientCheck} />
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={send}
                disabled={pending || !account || !policy || !operator || !recipientOk}
                className="btn-primary px-6 py-2.5 disabled:opacity-40"
              >
                {pending
                  ? "Sending…"
                  : !recipientOk && account
                    ? "Blocked — Recipient Email Unverified"
                    : "Send To Underwriter"}
              </button>
              <span className="text-[11px] text-[var(--muted)]">
                <kbd className="chip">⌘</kbd>
                <kbd className="chip">↵</kbd> to send
              </span>
            </div>
            {error && (
              <p className="mt-3 text-sm text-[var(--coral)]">{error}</p>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {account ? (
            <>
              <UwCard uw={account.primaryUw} role="Primary Underwriter" />
              {account.backupUw && (
                <UwCard uw={account.backupUw} role="Backup Underwriter" />
              )}
              {account.notes && (
                <div className="surface-card p-4 text-xs leading-relaxed text-[var(--muted)]">
                  <p className="eyebrow mb-2">Account Notes</p>
                  {account.notes}
                </div>
              )}
              <div className="surface-card p-4 text-xs leading-relaxed text-[var(--muted)]">
                <p className="eyebrow mb-2">This Send</p>
                <ul className="space-y-1.5">
                  {stack.map((l) => {
                    const r = getRequestType(l.typeId);
                    return (
                      <li key={l.key} className="flex justify-between gap-2">
                        <span>{r.shortLabel}</span>
                        <span>{premiumBearingLabel(r.premiumBearing)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : (
            <div className="surface-card p-5 text-sm text-[var(--muted)]">
              <p className="eyebrow mb-2">Underwriter</p>
              Select an account and the primary underwriter on file appears
              here, with email, portal, and notes ready to copy.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
