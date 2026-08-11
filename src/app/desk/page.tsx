import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { UnifiedDesk } from "@/components/UnifiedDesk";
import { buildDeskBundle } from "@/lib/desk/queue";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const operator = await getSessionOperator();

  if (!operator) {
    return (
      <>
        <Nav active="/desk" operator={null} />
        <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
          <div>
            <p className="eyebrow">Desk</p>
            <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">Desk</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Sign in to load your next action, personal strip, and continuous
              queue.
            </p>
          </div>
          <section className="surface-card space-y-4 p-6">
            <p className="text-sm text-[var(--muted)]">
              Step Bro is its own Clerk product. Create an account or sign in.
            </p>
            <div className="flex flex-wrap gap-2">
              <SignInButton mode="modal">
                <button type="button" className="btn-primary px-5 py-2.5">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button type="button" className="btn-ghost px-5 py-2.5">
                  Create Account
                </button>
              </SignUpButton>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Or use{" "}
              <Link href="/sign-in" className="underline">
                /sign-in
              </Link>
              .
            </p>
          </section>
        </main>
      </>
    );
  }

  const bundle = await buildDeskBundle({ operatorId: operator.id });

  return (
    <>
      <Nav active="/desk" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-6">
          <p className="eyebrow">Desk</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">Desk</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            One workplace for the day — next action loaded with context,
            complete to auto-advance, park with a reason and wake time. Sections
            are for lookup; this is where work happens.
          </p>
        </div>
        <UnifiedDesk bundle={bundle} />
      </main>
    </>
  );
}
