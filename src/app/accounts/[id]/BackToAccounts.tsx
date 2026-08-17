"use client";

import { useRouter } from "next/navigation";

const ACCOUNT_LIST_PATHS = [
  "/all-accounts",
  "/pending-orders",
  "/bound-orders",
  "/lost-orders",
];

export function BackToAccounts() {
  const router = useRouter();

  function goBack() {
    try {
      const previous = new URL(document.referrer);
      if (
        previous.origin === window.location.origin &&
        ACCOUNT_LIST_PATHS.some((path) => previous.pathname.startsWith(path))
      ) {
        router.back();
        return;
      }
    } catch {
      // A missing or non-URL referrer falls through to the stable list route.
    }
    router.push("/all-accounts");
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span aria-hidden="true">←</span>
      Back to Accounts
    </button>
  );
}
