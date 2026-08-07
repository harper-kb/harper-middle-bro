import Link from "next/link";

/**
 * Shared wrapper for the layout-preview sample pages. Carries the honest
 * banner — these are review samples; the real pages are untouched — and the
 * trace-shell backdrop so every sample reads as the oversight instrument.
 */
export function SampleShell({
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  children,
}: {
  backHref: string;
  backLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="trace-shell relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="trace-shell-glow" aria-hidden />
      <div className="relative mx-auto max-w-[1600px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <header className="mb-8 max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <span className="chip border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_16%,white)]">
              Sample — Real Pages Unchanged
            </span>
            <Link
              href={backHref}
              className="text-xs font-medium text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
            >
              {backLabel}
            </Link>
          </div>
          <p className="eyebrow mt-5 text-[var(--gold)]">{eyebrow}</p>
          <h1 className="mt-2 font-display text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] tracking-[-0.03em] text-[var(--ink)]">
            {title}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
            {description}
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}
