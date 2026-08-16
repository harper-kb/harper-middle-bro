import { SignOutButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function AccessDeniedPage() {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[var(--background)] px-5 py-12">
      <div className="absolute right-5 top-5 z-20 sm:right-7 sm:top-7">
        <ThemeToggle compact />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, color-mix(in srgb, var(--foreground) 16%, transparent) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse 55% 58% at center, black, transparent 78%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -left-28 top-[12%] h-[28rem] w-[28rem] rounded-full bg-[var(--harper-orange)]/20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-32 bottom-[5%] h-[32rem] w-[32rem] rounded-full bg-[var(--success)]/15 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[58%] top-[-12rem] h-[25rem] w-[25rem] rounded-full bg-[var(--warning)]/10 blur-[100px]"
      />
      <section className="surface-card relative w-full max-w-xl overflow-hidden border-[var(--rule)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-7 py-10 text-center shadow-[0_24px_80px_var(--shadow-color)] backdrop-blur-xl sm:px-12 sm:py-12">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-[var(--harper-orange)]"
        />

        <img
          src="https://www.harperinsure.com/harper_name_logo.svg"
          alt="Harper"
          className="mx-auto h-9 w-auto"
        />

        <div className="mx-auto mt-9 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--rule)] bg-[var(--pierre)] text-[var(--ink)] shadow-sm">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="h-6 w-6"
          >
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
          </svg>
        </div>

        <p className="eyebrow mt-6">Members only</p>
        <h1 className="page-title mt-2 whitespace-nowrap text-[clamp(1.25rem,4vw,2rem)] text-[var(--ink)]">
          Ouff, you&apos;re not a Harper Bro.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[var(--muted)]">
          This section is reserved for Harper employees. Try again with your
          Harper work email.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <SignOutButton redirectUrl="/sign-in">
            <button
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-contrast)] shadow-sm transition hover:-translate-y-0.5 hover:opacity-90 sm:w-auto"
            >
              Sign out &amp; try again
            </button>
          </SignOutButton>
        </div>

        <div className="mt-9 border-t border-[var(--rule)] pt-7">
          <p className="text-sm text-[var(--muted)]">
            However, you still can join us — we&apos;re hiring.
          </p>
          <a
            href="https://jobs.ashbyhq.com/harperinsure"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--harper-orange)] underline decoration-[var(--harper-orange)]/30 underline-offset-4 transition hover:decoration-[var(--harper-orange)]"
          >
            View open roles
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
    </main>
  );
}
