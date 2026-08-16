"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { REQUEST_TYPES, coverageLabels, getRequestType } from "@/lib/catalog";
import { createTicketAction } from "@/lib/actions";
import {
  AddressStatusChip,
  EmailStatusChip,
  addressGateOpen,
  addressGateReason,
  emailGateOpen,
  emailGateReason,
  useAddressCheck,
  useEmailCheck,
} from "@/components/ContactValidation";
import { TICKET_SOURCES, ticketSourceLabel } from "@/lib/tickets";
import type { AccountDetail, RequestTypeId, TicketSource } from "@/lib/types";

/**
 * Portal request, producer relay, service request — not different systems,
 * just different values of source. One form covers all the manual roads in.
 */
export function NewTicketForm({
  accounts,
  defaultRequestedBy,
}: {
  accounts: AccountDetail[];
  defaultRequestedBy: string;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [policyIds, setPolicyIds] = useState<string[]>(
    accounts[0]?.policies[0] ? [accounts[0].policies[0].id] : [],
  );
  const [requestType, setRequestType] =
    useState<RequestTypeId>("additional_insured");
  const [source, setSource] = useState<TicketSource>("producer");
  const [requestedByEmail, setRequestedByEmail] = useState("");
  const [holderAddress, setHolderAddress] = useState("");

  // Hard gates — a wrong email or address stops the ticket right here.
  const emailCheck = useEmailCheck(requestedByEmail);
  const addressCheck = useAddressCheck(holderAddress);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const needsHolder = useMemo(
    () =>
      requestType === "additional_insured" ||
      requestType === "waiver_of_subrogation" ||
      requestType === "primary_non_contributory" ||
      requestType === "additional_named_insured",
    [requestType],
  );

  function pickAccount(id: string) {
    setAccountId(id);
    const first = accounts.find((a) => a.id === id)?.policies[0];
    setPolicyIds(first ? [first.id] : []);
  }

  // A typed email must verify; a typed holder address (when the holder box
  // is in play) must verify. Empty optional fields stay open — blank beats
  // wrong.
  const gateReason =
    emailGateReason(emailCheck) ??
    (needsHolder ? addressGateReason(addressCheck) : null);

  function togglePolicy(id: string) {
    setPolicyIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  return (
    <form action={createTicketAction} className="space-y-5">
      <input type="hidden" name="accountId" value={accountId} />
      {policyIds.map((id) => (
        <input key={id} type="hidden" name="policyIds" value={id} />
      ))}

      <div className="glass rounded-2xl p-5">
        <p className="eyebrow mb-3">Requester</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
              Source
            </span>
            <select
              name="source"
              value={source}
              onChange={(e) => setSource(e.target.value as TicketSource)}
              className="field"
            >
              {TICKET_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {ticketSourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
              Requested By
            </span>
            <input
              name="requestedBy"
              defaultValue={defaultRequestedBy}
              required
              placeholder="Producer, insured contact, or portal reference"
              className="field"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-[var(--ink)]">
              Requester Email
              <EmailStatusChip
                check={emailCheck}
                onApplySuggestion={setRequestedByEmail}
              />
            </span>
            <input
              name="requestedByEmail"
              type="email"
              placeholder="Optional"
              value={requestedByEmail}
              onChange={(e) => setRequestedByEmail(e.target.value)}
              className={`field ${!emailGateOpen(emailCheck) ? "field-bad" : ""}`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
              Subject
            </span>
            <input
              name="subject"
              placeholder="How the request read when it arrived"
              className="field"
            />
          </label>
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="eyebrow">Request Details</p>
          <Link
            href="/glossary"
            className="text-[11px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)]"
          >
            Glossary
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
              Account
            </span>
            <select
              value={accountId}
              onChange={(e) => pickAccount(e.target.value)}
              className="field"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
              Request Type
            </span>
            <select
              name="requestType"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as RequestTypeId)}
              className="field"
            >
              {REQUEST_TYPES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {getRequestType(requestType).description}
        </p>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-[var(--ink)]">
            Policies On This Ticket
          </p>
          <div className="space-y-1.5">
            {account?.policies.map((p) => {
              const on = policyIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePolicy(p.id)}
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
                  <span className="shrink-0 text-xs">{on ? "On" : "Add"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            One request can span policies — a certificate that touches General
            Liability (GL) and umbrella coverage is one ticket, not two.
          </p>
        </div>
      </div>

      {needsHolder && (
        <div className="glass rounded-2xl p-5">
          <p className="eyebrow mb-3">Holder</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
                Entity To Be Added
              </span>
              <input
                name="holderName"
                placeholder="Exact legal name from the contract"
                className="field"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-[var(--ink)]">
                Address
                <AddressStatusChip
                  check={addressCheck}
                  onApplyStandardized={setHolderAddress}
                />
              </span>
              <input
                name="holderAddress"
                placeholder="Street, city, state ZIP"
                value={holderAddress}
                onChange={(e) => setHolderAddress(e.target.value)}
                className={`field ${!addressGateOpen(addressCheck) ? "field-bad" : ""}`}
              />
            </label>
          </div>
          {(requestType === "additional_insured" ||
            requestType === "waiver_of_subrogation") && (
            <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--rule)] bg-white/60 p-3">
              <input
                type="checkbox"
                name="namedOnPolicy"
                value="1"
                className="mt-0.5"
              />
              <span className="text-xs leading-relaxed text-[var(--ink)]">
                <span className="font-semibold">
                  Holder Must Be Named On The Policy
                </span>
                <span className="block text-[var(--muted)]">
                  Some contracts require a scheduled endorsement even when
                  blanket wording exists — that goes to the underwriter and is
                  sometimes charged. Leave off if certificate wording
                  satisfies the holder.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      <div className="glass rounded-2xl p-5">
        <p className="eyebrow mb-3">Wording</p>
        <textarea
          name="wording"
          rows={4}
          placeholder="What the contract or the requester actually asked for."
          className="field font-mono text-[13px] leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={policyIds.length === 0 || Boolean(gateReason)}
          className="btn-primary px-6 py-2.5 disabled:opacity-40"
        >
          {gateReason ? "Blocked — Correct Contact Details" : "Open Ticket"}
        </button>
        <p className={`text-xs ${gateReason ? "font-medium text-rose-700" : "text-[var(--muted)]"}`}>
          {gateReason ?? "The draft to the market is written the moment this opens."}
        </p>
      </div>
    </form>
  );
}
