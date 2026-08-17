import {
  sourceLabel,
  sourceTone,
  SOURCE_DESCRIPTIONS,
  type OrderSource,
  type SourceTone,
} from "@/lib/account-source";

/**
 * Account-source identity: one icon, one label and one tone per source, shared
 * by the filter, collapsed rows, order cards, company headers, search results
 * and the Broker Gate rail.
 *
 * Purely presentational on purpose — filter behaviour stays in the toolbar. A
 * surface that already owns its own chrome (a meta-chip, a segment button)
 * composes `SourceIcon` plus `sourceTone` instead of nesting this component.
 */

/** IQ keeps the filled bolt it has always had. */
function IqGlyph() {
  return <path d="M7 1 2.5 6.75h2.25L4.75 11 9.5 5h-2.4z" fill="currentColor" />;
}

/**
 * Two interlocked rings — the brokered relationship between two parties.
 *
 * A literal handshake was the first choice and was drawn and rejected: at the
 * 11–13px these marks actually render at, every handshake reduction collapsed
 * into an unreadable zigzag, and the ones with enough mass to survive read as a
 * second lightning bolt against IQ. Interlocked rings stay legible at 11px,
 * carry the same outline weight as the other Step Bro glyphs, and are round
 * where the IQ bolt is angular. The visible "Broker" label always does the
 * naming; the glyph only has to be distinct.
 */
function BrokerGlyph() {
  return (
    <>
      <circle cx="4.15" cy="6" r="2.85" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="8.6" cy="6" r="2.85" stroke="currentColor" strokeWidth="1.75" />
    </>
  );
}

/** Half-filled disc: this order sits in both books at once. */
function MixedGlyph() {
  return (
    <>
      <circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 1.6a4.4 4.4 0 0 0 0 8.8z" fill="currentColor" />
    </>
  );
}

/** Struck-through disc: classification is missing, not neutral-by-choice. */
function UnavailableGlyph() {
  return (
    <>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.75 6h4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  );
}

const GLYPHS: Record<SourceTone, () => React.ReactElement> = {
  iq: IqGlyph,
  broker: BrokerGlyph,
  mixed: MixedGlyph,
  unavailable: UnavailableGlyph,
};

/**
 * The glyph on its own, for surfaces that already render the word next to it.
 * Decorative by default so the label is not announced twice.
 */
export function SourceIcon({
  source,
  className,
}: {
  source: OrderSource | null;
  className?: string;
}) {
  const Glyph = GLYPHS[sourceTone(source)];
  return (
    // Intrinsic 12px fallback: CSS class sizing always wins over these
    // attributes, but an SVG with neither renders at 300×150 if a stylesheet
    // ever lags a markup change.
    <svg
      viewBox="0 0 12 12"
      width={12}
      height={12}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <Glyph />
    </svg>
  );
}

/**
 * Standalone identity for surfaces with no chrome of their own.
 *
 * There is deliberately no `interactive` variant: the only control that is
 * actually clickable by source is the Account Source filter segment, which owns
 * its hover/pressed/selected/focus/disabled states in `.seg-option--broker`.
 * Embedding those here would put filter behaviour inside a visual component.
 *
 * `showLabel={false}` is for genuinely constrained layouts only: the icon then
 * carries the accessible name and a tooltip, because purple alone never
 * communicates Broker.
 */
export function AccountSourceIdentity({
  source,
  size = "sm",
  showLabel = true,
}: {
  source: OrderSource | null;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const tone = sourceTone(source);
  const label = sourceLabel(source);
  const className = [
    "source-identity",
    `source-identity--${tone}`,
    size === "md" ? "source-identity--md" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      title={showLabel ? undefined : label}
      aria-label={showLabel ? undefined : label}
      role={showLabel ? undefined : "img"}
    >
      <SourceIcon source={source} className="source-identity-icon" />
      {showLabel ? <span className="source-identity-label">{label}</span> : null}
    </span>
  );
}

export { SOURCE_DESCRIPTIONS };
