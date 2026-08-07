"use client";

import { useState } from "react";
import Link from "next/link";
import { CarrierLogo } from "@/components/CarrierLogo";
import { getCarrierTheme } from "@/lib/carrier-theme";
import { carrierSlug } from "@/lib/carriers";
import type { VerifiedContact } from "@/lib/verified-contacts";

export function VerifiedContactCard({
  contact,
}: {
  contact: VerifiedContact;
}) {
  const [copied, setCopied] = useState(false);
  const theme = getCarrierTheme(contact.carrier);
  const slug = carrierSlug(contact.carrier);

  async function copyEmail() {
    await navigator.clipboard.writeText(contact.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="overflow-hidden rounded-2xl shadow-[0_10px_30px_rgba(26,44,54,0.05)] ring-1 ring-black/[0.06]"
      style={{ background: theme.bg }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: theme.header }}
      >
        <CarrierLogo name={contact.carrier} size={36} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
              Verified
            </span>
          </div>
          <p className="truncate font-display text-lg text-white">
            {contact.name}
          </p>
          <p className="truncate text-xs text-white/70">{contact.carrier}</p>
        </div>
      </div>

      <div className="p-4">
        <p className="break-all text-sm">
          <span className="text-[var(--muted)]">Email · </span>
          {contact.email}
        </p>
        {contact.notes && (
          <p
            className="mt-3 border-l-2 pl-3 text-xs leading-relaxed text-[var(--muted)]"
            style={{ borderColor: theme.accent }}
          >
            {contact.notes}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={copyEmail} className="btn-primary">
            {copied ? "Copied" : "Copy Email"}
          </button>
          <Link href={`/carriers/${slug}`} className="btn-ghost">
            Carrier Desk
          </Link>
        </div>
      </div>
    </div>
  );
}
