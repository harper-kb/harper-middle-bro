"use client";

import { useId, useState } from "react";
import { CompanySummaryCard } from "./CompanySummaryCard";
import { CopyButton } from "@/components/CopyButton";
import type { CompanyContact } from "@/lib/company-detail-types";

const PREVIEW_COUNT = 2;

function safeEmailHref(email: string | null): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return `mailto:${email}`;
}

function safePhoneHref(phone: string | null): string | null {
  if (!phone) return null;
  const normalized = phone.replace(/[^\d+]/g, "");
  return /^\+?\d{7,15}$/.test(normalized) ? `tel:${normalized}` : null;
}

export function ContactsCard({ contacts }: { contacts: CompanyContact[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? contacts : contacts.slice(0, PREVIEW_COUNT);

  return (
    <CompanySummaryCard
      tone="contacts"
      label="Contacts"
      action={
        contacts.length > 0 ? (
          <span className="text-xs tabular-nums text-[var(--muted)]">
            {contacts.length}
          </span>
        ) : undefined
      }
    >
      {contacts.length === 0 ? (
        <p className="company-card-empty">No contacts on file.</p>
      ) : (
        <>
          <ul id={listId} className="company-contact-list">
            {visible.map((contact) => {
              const emailHref = safeEmailHref(contact.email);
              const phoneHref = safePhoneHref(contact.phone);
              const possessive = contact.name.endsWith("s")
                ? `${contact.name}'`
                : `${contact.name}'s`;
              return (
                <li key={contact.id} className="company-contact-item">
                  <div className="flex min-w-0 items-center gap-1">
                    <p
                      className="truncate text-sm font-semibold text-[var(--ink)]"
                      title={contact.name}
                    >
                      {contact.name}
                    </p>
                    <CopyButton
                      value={contact.name}
                      label={`Copy ${contact.name}'s name`}
                      successMessage="Name copied"
                    />
                    {contact.isPrimary ? (
                      <span className="rounded-full border border-[var(--rule)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                        Primary
                      </span>
                    ) : null}
                  </div>
                  {contact.role ? (
                    <p className="text-xs text-[var(--muted)]">{contact.role}</p>
                  ) : null}
                  <div className="mt-1 space-y-0.5 text-xs">
                    {contact.email ? (
                      <div className="flex min-w-0 items-center gap-1">
                        {emailHref ? (
                          <a
                            href={emailHref}
                            className="min-w-0 truncate text-[var(--accent)] hover:underline"
                            aria-label={`Email ${contact.name}`}
                            title={contact.email}
                          >
                            {contact.email}
                          </a>
                        ) : (
                          <span
                            className="min-w-0 truncate text-[var(--muted)]"
                            title={contact.email}
                          >
                            {contact.email}
                          </span>
                        )}
                        <CopyButton
                          value={contact.email}
                          label={`Copy ${possessive} email`}
                          successMessage="Email copied"
                        />
                      </div>
                    ) : null}
                    {contact.phone ? (
                      <div className="flex min-w-0 items-center gap-1">
                        {phoneHref ? (
                          <a
                            href={phoneHref}
                            className="min-w-0 truncate text-[var(--ink)] hover:underline"
                            aria-label={`Call ${contact.name}`}
                            title={contact.phone}
                          >
                            {contact.phone}
                          </a>
                        ) : (
                          <span
                            className="min-w-0 truncate text-[var(--muted)]"
                            title={contact.phone}
                          >
                            {contact.phone}
                          </span>
                        )}
                        <CopyButton
                          value={contact.phone}
                          label={`Copy ${possessive} phone`}
                          successMessage="Phone copied"
                        />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {contacts.length > PREVIEW_COUNT ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((value) => !value)}
              className="company-card-action mt-3"
            >
              {expanded
                ? "Show fewer contacts"
                : `View all contacts (${contacts.length})`}
            </button>
          ) : null}
        </>
      )}
    </CompanySummaryCard>
  );
}
