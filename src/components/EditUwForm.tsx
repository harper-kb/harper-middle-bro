"use client";

import { useState, useTransition } from "react";
import { updateUwAction } from "@/lib/actions";
import {
  EmailStatusChip,
  emailGateOpen,
  emailGateReason,
  useEmailCheck,
} from "@/components/ContactValidation";
import type { Underwriter } from "@/lib/types";

export function EditUwForm({
  uw,
  accountId,
}: {
  uw: Underwriter;
  accountId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(uw.email);

  // Hard gate: a desk email that can't take mail never gets saved.
  const emailCheck = useEmailCheck(email);
  const emailOk = emailGateOpen(emailCheck, true);

  return (
    <form
      className="space-y-3 rounded-xl border border-[var(--navy)]/10 bg-white p-4 shadow-sm"
      action={(fd) => {
        startTransition(async () => {
          await updateUwAction(fd);
        });
      }}
    >
      <input type="hidden" name="id" value={uw.id} />
      <input type="hidden" name="accountId" value={accountId} />
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        Edit Underwriter · {uw.carrier}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-[var(--muted)]">
          Name
          <input
            name="name"
            defaultValue={uw.name}
            className="mt-1 w-full rounded-lg border border-[var(--navy)]/15 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          <span className="flex items-center justify-between gap-2">
            Email
            <EmailStatusChip check={emailCheck} onApplySuggestion={setEmail} />
          </span>
          <input
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1 w-full rounded-lg border border-[var(--navy)]/15 px-3 py-2 text-sm ${
              emailOk ? "" : "field-bad"
            }`}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Phone
          <input
            name="phone"
            defaultValue={uw.phone ?? ""}
            className="mt-1 w-full rounded-lg border border-[var(--navy)]/15 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Portal URL
          <input
            name="portal"
            defaultValue={uw.portal ?? ""}
            className="mt-1 w-full rounded-lg border border-[var(--navy)]/15 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <label className="block text-xs text-[var(--muted)]">
        Notes
        <textarea
          name="notes"
          defaultValue={uw.notes ?? ""}
          rows={2}
          className="mt-1 w-full rounded-lg border border-[var(--navy)]/15 px-3 py-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || !emailOk}
          className="rounded-lg bg-[var(--navy)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save Underwriter"}
        </button>
        {!emailOk && (
          <span className="text-[11px] font-medium text-rose-700">
            {emailGateReason(emailCheck) ?? "Email Required"}
          </span>
        )}
      </div>
    </form>
  );
}
