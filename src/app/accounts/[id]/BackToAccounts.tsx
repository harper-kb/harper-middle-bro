"use client";

import { useRouter } from "next/navigation";
import { parseRecordsReturnState } from "@/app/all-accounts/records-navigation";
import { reportRecordsNavigation } from "@/app/all-accounts/records-telemetry";

export function BackToAccounts({ returnHref }: { returnHref?: string | null }) {
  const router = useRouter();

  function goBack() {
    const state = parseRecordsReturnState(returnHref);
    if (state) {
      reportRecordsNavigation("return-to-records", state, "back-to-accounts");
    }
    // Replace avoids creating a detail → list → detail loop in browser history.
    router.replace(returnHref ?? "/all-accounts", { scroll: false });
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
