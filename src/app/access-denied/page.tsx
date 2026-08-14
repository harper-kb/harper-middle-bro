import { SignOutButton } from "@clerk/nextjs";
import { PRODUCT_NAME, SERVICE_MAILBOX } from "@/lib/brand";

export const metadata = { title: `Access Denied — ${PRODUCT_NAME}` };

/**
 * Where an authenticated-but-unlisted account lands.
 *
 * This page must never call getSessionOperator(): that is what redirects here,
 * and the pair would loop.
 */
export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="surface-card max-w-md px-8 py-10 text-center">
        <p className="eyebrow">{PRODUCT_NAME}</p>
        <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">Access Denied</h1>
        <p className="mt-4 text-sm text-[var(--muted)]">
          This desk is limited to invited Harper staff. Your account signed in
          successfully but is not on the access list, so the book stays closed.
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          If you should have access, ask an administrator to add your work email,
          then sign in again. Questions go to{" "}
          <span className="whitespace-nowrap">{SERVICE_MAILBOX}</span>.
        </p>
        <div className="mt-6">
          <SignOutButton>
            <button type="button" className="btn-primary">
              Sign Out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
