"use client";

import { getCarrierTheme } from "@/lib/carrier-theme";

/**
 * Carrier brand mark. Renders the vendored official logo when we have a
 * verified asset on disk (`/public/logos`), and the designed monogram tile
 * otherwise. Deliberately never hotlinks favicons — those render as blurry
 * upscales and read cheap.
 */
export function CarrierLogo({
  name,
  size = 44,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const theme = getCarrierTheme(name);

  if (theme.logo) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5 ${className}`}
        style={{ width: size, height: size }}
        title={name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={theme.logo}
          alt={`${name} logo`}
          width={size}
          height={size}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  return <Monogram theme={theme} size={size} className={className} name={name} />;
}

function Monogram({
  theme,
  size,
  className,
  name,
}: {
  theme: ReturnType<typeof getCarrierTheme>;
  size: number;
  className: string;
  name: string;
}) {
  return (
    <span
      className={`font-display relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-xl shadow-sm ring-1 ring-black/10 ${className}`}
      style={{
        width: size,
        height: size,
        background: theme.header,
        color: theme.ink,
        fontSize: size * 0.34,
        letterSpacing: "0.05em",
      }}
      title={name}
      aria-hidden
    >
      {/* Soft top light so the tile reads engraved, not flat */}
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 45%)",
        }}
      />
      <span className="relative">{theme.initials}</span>
    </span>
  );
}
