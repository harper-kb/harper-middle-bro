"use client";

import { SignOutButton, useAuth, useSignIn } from "@clerk/nextjs";
import { HandleSSOCallback } from "@clerk/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SignInPage() {
  const pathname = usePathname();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signIn, fetchStatus } = useSignIn();
  const [error, setError] = useState<string | null>(null);

  const navigate = (destination: string) => {
    if (destination.startsWith("http")) {
      window.location.href = destination;
    } else {
      router.push(destination);
    }
  };

  if (pathname.endsWith("/sso-callback")) {
    return (
      <AuthShell>
        <div className="flex min-h-48 flex-col items-center justify-center gap-4">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--rule)] border-t-[var(--harper-orange)]" />
          <p className="text-sm text-[var(--muted)]">
            Finishing your Harper sign-in…
          </p>
          <HandleSSOCallback
            navigateToApp={({ session, decorateUrl }) => {
              const destination = session.currentTask
                ? `/sign-in/tasks/${session.currentTask.key}`
                : "/";
              navigate(decorateUrl(destination));
            }}
            navigateToSignIn={() => router.replace("/sign-in")}
            navigateToSignUp={() => router.replace("/sign-in")}
          />
        </div>
      </AuthShell>
    );
  }

  if (isSignedIn) {
    return (
      <AuthShell>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--rule)] bg-[var(--pierre)] text-[var(--ink)] shadow-sm">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="h-6 w-6"
          >
            <path d="m7.5 12 3 3 6-7" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <p className="eyebrow mt-6">You&apos;re signed in</p>
        <h1 className="page-title mt-2 text-3xl text-[var(--ink)]">
          Ready for the desk.
        </h1>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-contrast)] shadow-sm transition hover:-translate-y-0.5 hover:opacity-90"
          >
            Continue to Step Bro
          </button>
          <SignOutButton redirectUrl="/sign-in">
            <button
              type="button"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] px-5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--border-strong)] hover:bg-[var(--sand)]"
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </AuthShell>
    );
  }

  const continueWithGoogle = async () => {
    setError(null);
    const result = await signIn.sso({
      strategy: "oauth_google",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-in/sso-callback",
    });
    if (result.error) {
      setError(
        result.error.longMessage ??
          result.error.message ??
          "Google sign-in could not be started. Please try again.",
      );
    }
  };

  return (
    <AuthShell>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--rule)] bg-[var(--pierre)] text-[var(--ink)] shadow-sm">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="h-6 w-6"
        >
          <path d="M12 3 4.5 6v5.4c0 4.7 3.2 8.2 7.5 9.6 4.3-1.4 7.5-4.9 7.5-9.6V6L12 3Z" />
          <path d="m9.2 12 1.8 1.8 3.9-4" />
        </svg>
      </div>

      <p className="eyebrow mt-6">Harper employees</p>
      <h1 className="page-title mt-2 text-[clamp(1.8rem,5vw,2.5rem)] text-[var(--ink)]">
        Welcome back, Bro.
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--muted)]">
        Sign in with your Harper Google account to enter the desk.
      </p>

      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={fetchStatus === "fetching"}
        className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] px-5 text-sm font-semibold text-[var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md disabled:cursor-wait disabled:opacity-60"
      >
        {fetchStatus === "fetching" ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--rule)] border-t-[var(--ink)]" />
        ) : (
          <GoogleIcon />
        )}
        Continue with Google
      </button>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <p className="mt-7 text-xs leading-5 text-[var(--muted)]">
        Access is limited to verified{" "}
        <span className="font-semibold text-[var(--ink)]">
          @harperinsure.com
        </span>{" "}
        accounts.
      </p>

      <div className="mt-7 border-t border-[var(--rule)] pt-6">
        <a
          href="https://jobs.ashbyhq.com/harperinsure"
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-3 rounded-full border border-[var(--rule)] bg-[color-mix(in_srgb,var(--surface-raised)_70%,transparent)] py-2 pl-4 pr-2 text-sm text-[var(--muted)] shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--harper-orange)]/40 hover:shadow-md"
        >
          <span>
            Not a Harper Bro?{" "}
            <strong className="font-semibold text-[var(--ink)]">
              We&apos;re hiring.
            </strong>
          </span>
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--harper-orange)] text-white transition group-hover:rotate-45"
          >
            ↗
          </span>
        </a>
      </div>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
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
      <section className="surface-card relative w-full max-w-md overflow-hidden border-[var(--rule)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-7 py-10 text-center shadow-[0_24px_80px_var(--shadow-color)] backdrop-blur-xl sm:px-12 sm:py-12">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-[var(--harper-orange)]"
        />
        <img
          src="https://www.harperinsure.com/harper_name_logo.svg"
          alt="Harper"
          className="mx-auto mb-9 h-9 w-auto"
        />
        {children}
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9.1L6.5 14Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.2 7.5l3.3 2.6a5.8 5.8 0 0 1 5.5-4Z"
      />
    </svg>
  );
}
