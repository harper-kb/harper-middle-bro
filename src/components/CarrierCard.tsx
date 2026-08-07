import Link from "next/link";
import { CarrierLogo } from "@/components/CarrierLogo";
import { getCarrierTheme } from "@/lib/carrier-theme";
import { carrierSlug, kindLabel, type CarrierIntel } from "@/lib/carriers";
import { channelLabel } from "@/lib/channels";
import {
  placementPathFor,
  placementPathLabel,
} from "@/lib/market-path";
import type { VerifiedContact } from "@/lib/verified-contacts";
import { isUselessMailbox } from "@/lib/verified-contacts";

export function CarrierCard({
  carrier,
  desks: _desks,
  verified = [],
}: {
  carrier: CarrierIntel;
  desks: unknown[];
  verified?: VerifiedContact[];
}) {
  const theme = getCarrierTheme(carrier.name);
  const slug = carrierSlug(carrier.name);
  const path = placementPathFor(carrier.kind);
  const serviceEmail =
    carrier.serviceEmail && !isUselessMailbox(carrier.serviceEmail)
      ? carrier.serviceEmail
      : null;

  return (
    <article
      className="overflow-hidden rounded-2xl ring-1 ring-black/[0.06] shadow-[0_12px_40px_rgba(26,44,54,0.06)]"
      style={{ background: theme.bg }}
    >
      <header
        className="relative flex items-center gap-3.5 px-5 py-4 text-white"
        style={{ background: theme.header }}
      >
        <CarrierLogo name={carrier.name} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl tracking-tight text-white">
            <Link href={`/carriers/${slug}`} className="hover:underline">
              {carrier.name}
            </Link>
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/95 ring-1 ring-white/20">
              {placementPathLabel(path)}
            </span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/95 ring-1 ring-white/20">
              {kindLabel(carrier.kind)}
            </span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/95 ring-1 ring-white/20">
              {channelLabel(carrier.channel)}
            </span>
          </div>
        </div>
      </header>

      <div className="p-5">
        <p className="text-xs text-[var(--muted)]">
          Lines: {carrier.lines.join(" · ")}
        </p>
        {serviceEmail && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Exception Email · {serviceEmail}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href={`/carriers/${slug}`}
            className="text-xs font-medium underline decoration-current/30 underline-offset-4"
            style={{ color: theme.accent }}
          >
            Open Desk
          </Link>
          {carrier.portal && (
            <a
              href={carrier.portal}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium underline decoration-current/30 underline-offset-4"
              style={{ color: theme.accent }}
            >
              Portal
            </a>
          )}
        </div>

        <ul className="mt-4 space-y-2">
          {carrier.known.map((k) => (
            <li
              key={k}
              className="border-l-2 pl-3 text-sm leading-relaxed text-[var(--ink)]/85"
              style={{ borderColor: theme.accent }}
            >
              {k}
            </li>
          ))}
        </ul>

        {carrier.whenOut && (
          <p
            className="mt-4 rounded-xl px-3 py-2 text-xs leading-relaxed text-[var(--ink)]"
            style={{
              background: `color-mix(in srgb, ${theme.accent} 12%, white)`,
            }}
          >
            <span className="font-semibold">If They&apos;re Out · </span>
            {carrier.whenOut}
          </p>
        )}

        <div className="mt-4 border-t border-black/5 pt-3">
          <p className="eyebrow mb-2">Verified Underwriters</p>
          {verified.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {verified.slice(0, 8).map((uw) => (
                <li key={`${uw.sourceId}-${uw.email}`}>
                  <span className="font-medium">{uw.name}</span>
                  <span className="text-[var(--muted)]"> · {uw.email}</span>
                </li>
              ))}
              {verified.length > 8 && (
                <li className="text-xs text-[var(--muted)]">
                  +{verified.length - 8} more on Contacts
                </li>
              )}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              No named underwriter email verified for this market yet.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
