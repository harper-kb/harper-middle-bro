"use client";

import { useState } from "react";
import { updateProfileAction } from "@/lib/actions";
import {
  EmailStatusChip,
  emailGateOpen,
  emailGateReason,
  useEmailCheck,
} from "@/components/ContactValidation";
import { buildSignature, isGeneratedSignature } from "@/lib/signature";
import { EMAIL_TEMPLATES } from "@/lib/templates";
import type { Operator } from "@/lib/types";

/**
 * The signature follows the fields above as you type, so a renamed seat
 * never signs mail under the last person's name. Type in the block itself
 * and it stops following — you own it until you ask for it back.
 */
export function ProfileForm({ operator }: { operator: Operator }) {
  const [fields, setFields] = useState({
    displayName: operator.displayName,
    title: operator.title,
    email: operator.email,
    phone: formatPhone(operator.phone ?? ""),
  });

  // A signature that still matches its fields was never hand-written.
  const [custom, setCustom] = useState(
    !isGeneratedSignature(operator.signature, {
      displayName: operator.displayName,
      title: operator.title,
      email: operator.email,
      phone: operator.phone,
    }),
  );
  const [written, setWritten] = useState(operator.signature);

  // Your address signs every draft — it has to take mail. Hard gate.
  const emailCheck = useEmailCheck(fields.email);
  const emailOk = emailGateOpen(emailCheck, true);

  const generated = buildSignature({
    displayName: fields.displayName,
    title: fields.title,
    email: fields.email,
    phone: fields.phone || null,
  });
  const signature = custom ? written : generated;

  function set(key: keyof typeof fields, value: string) {
    setFields({ ...fields, [key]: value });
  }

  return (
    <form action={updateProfileAction} className="space-y-4">
      <input type="hidden" name="id" value={operator.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Display Name"
          name="displayName"
          value={fields.displayName}
          onChange={(v) => set("displayName", v)}
          required
        />
        <Field
          label="Title"
          name="title"
          value={fields.title}
          onChange={(v) => set("title", v)}
          required
        />
        <label className="block text-sm">
          <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Email
            <EmailStatusChip
              check={emailCheck}
              onApplySuggestion={(v) => set("email", v)}
            />
          </span>
          <input
            name="email"
            type="email"
            value={fields.email}
            onChange={(e) => set("email", e.target.value)}
            className={`field ${emailOk ? "" : "field-bad"}`}
            required
          />
        </label>
        <Field
          label="Phone"
          name="phone"
          value={fields.phone}
          onChange={(v) => set("phone", formatPhone(v))}
          inputMode="tel"
          autoComplete="tel"
          placeholder="415-555-0160"
          pattern="\d{3}-\d{3}-\d{4}"
          title="Use area code + number: 415-555-0160"
          maxLength={12}
        />
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Default Template
        </span>
        <select
          name="defaultTemplate"
          defaultValue={operator.defaultTemplate}
          className="field"
        >
          {EMAIL_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="text-sm">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Email Signature
          </span>
          {custom ? (
            <button
              type="button"
              onClick={() => setCustom(false)}
              className="text-[11px] font-semibold text-[var(--coral)] hover:underline"
            >
              Rebuild From Fields Above
            </button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Following Your Fields
            </span>
          )}
        </div>

        <textarea
          name="signature"
          value={signature}
          onChange={(e) => {
            setWritten(e.target.value);
            setCustom(true);
          }}
          rows={6}
          className={`field font-mono text-sm transition ${
            custom ? "" : "bg-[var(--paper)]"
          }`}
          required
        />

        <span className="mt-1 block text-xs text-[var(--muted)]">
          {custom
            ? "Hand-written — it will stay exactly as you left it. Rebuild to follow the fields again."
            : "Updates as you type above, and stamps every draft you prepare."}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!emailOk}
          className="btn-primary disabled:opacity-40"
        >
          {emailOk ? "Save Profile" : "Blocked — Email Unverified"}
        </button>
        {!emailOk && (
          <span className="text-xs font-medium text-rose-700">
            {emailGateReason(emailCheck) ?? "Email Required"}
          </span>
        )}
      </div>
    </form>
  );
}

/** Digits only → `XXX-XXX-XXXX` (area code, exchange, line). */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required,
  inputMode,
  autoComplete,
  placeholder,
  pattern,
  title,
  maxLength,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  placeholder?: string;
  pattern?: string;
  title?: string;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field"
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        pattern={pattern}
        title={title}
        maxLength={maxLength}
      />
    </label>
  );
}
