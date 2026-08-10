"use client";

import { useState } from "react";
import { CarrierLogo } from "@/components/CarrierLogo";
import { getCarrierTheme } from "@/lib/carrier-theme";
import { channelLabel } from "@/lib/channels";
import type { Underwriter } from "@/lib/types";

export function UwCard({
  uw,
  role = "Primary",
}: {
  uw: Underwriter;
  role?: string;
}) {
  const [copied, setCopied] = useState(false);
  const emailToCopy = uw.serviceEmail || uw.email;
  const theme = getCarrierTheme(uw.carrier);

  async function copyEmail() {
    await navigator.clipboard.writeText(emailToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const primaryIsPortal =
    uw.channelPrimary === "portal" || uw.channelPrimary === "hybrid";

  return (
    <div
      className="overflow-hidden rounded-2xl shadow-[0_10px_30px_rgba(26,44,54,0.05)] ring-1 ring-black/[0.06]"
      style={{ background: theme.bg }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: theme.header }}
      >
        <CarrierLogo name={uw.carrier} size={36} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
              {role}
            </span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 ring-1 ring-white/20">
              {channelLabel(uw.channelPrimary)}
            </span>
          </div>
          <p className="truncate font-display text-lg text-white">{uw.name}</p>
          <p className="truncate text-xs text-white/70">{uw.carrier}</p>
        </div>
      </div>

      <div className="p-4">
        <div className="space-y-1.5 text-sm">
          {primaryIsPortal && uw.portal ? (
            <p>
              <span className="text-[var(--muted)]">Portal · </span>
              <a
                href={uw.portal}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-current/30 underline-offset-4"
                style={{ color: theme.accent }}
              >
                Open
              </a>
            </p>
          ) : null}
          <p className="break-all">
            <span className="text-[var(--muted)]">
              {uw.serviceEmail && uw.serviceEmail !== uw.email
                ? "Service Email · "
                : "Email · "}
            </span>
            {emailToCopy}
          </p>
          {uw.phone && (
            <p>
              <span className="text-[var(--muted)]">Phone · </span>
              {uw.phone}
            </p>
          )}
        </div>

        {(uw.channelNote || uw.notes) && (
          <p
            className="mt-3 border-l-2 pl-3 text-xs leading-relaxed text-[var(--muted)]"
            style={{ borderColor: theme.accent }}
          >
            {uw.channelNote || uw.notes}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {primaryIsPortal && uw.portal ? (
            <a
              href={uw.portal}
              target="_blank"
              rel="noreferrer"
              className="btn-primary"
            >
              Open Portal
            </a>
          ) : null}
          <button type="button" onClick={copyEmail} className="btn-ghost">
            {copied ? "Copied" : "Copy Email"}
          </button>
          {!primaryIsPortal && uw.portal ? (
            <a
              href={uw.portal}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              Portal Ref
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
