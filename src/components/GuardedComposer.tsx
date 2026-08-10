"use client";

import { useMemo, useState } from "react";
import type { ServiceTemplate } from "@/lib/templates-registry/types";

export function GuardedComposer({
  templates,
  defaultTo = "",
  accountId,
}: {
  templates: ServiceTemplate[];
  defaultTo?: string;
  accountId?: string | null;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const tmpl = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(tmpl?.subject ?? "");
  const [body, setBody] = useState(tmpl?.body ?? "");
  const [confirmed, setConfirmed] = useState(false);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject ?? "");
    setBody(t.body);
    setConfirmed(false);
  }

  const edited = tmpl
    ? body !== tmpl.body || subject !== (tmpl.subject ?? "")
    : false;

  return (
    <div className="surface-card space-y-3 p-4">
      <p className="eyebrow">Guarded Composer</p>
      <label className="block text-xs text-[var(--muted)]">
        Template
        <select
          className="field mt-1"
          value={templateId}
          onChange={(e) => applyTemplate(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · v{t.version}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-[var(--muted)]">
        To
        <input
          className="field mt-1"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Subject
        <input
          className="field mt-1"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Body
        <textarea
          className="field mt-1 min-h-[8rem]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {edited ? (
        <p className="text-xs text-amber-700">
          Template edited — review diff before send.
        </p>
      ) : null}
      {accountId ? (
        <p className="text-[11px] text-[var(--muted)]">Account {accountId}</p>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirm this one-click send
      </label>
      <button type="button" className="btn-primary" disabled={!confirmed}>
        Send (Server Action Wires Next)
      </button>
    </div>
  );
}
