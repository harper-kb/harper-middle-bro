import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <p className="eyebrow">Harper Middle Bro</p>
        <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
          Sign In
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          A dedicated Clerk product, separate from Harper production
          authentication.
        </p>
      </div>
      <SignIn
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-none ring-1 ring-[var(--rule)]",
          },
        }}
      />
      <Link href="/" className="text-xs text-[var(--muted)] underline">
        ← Back to Sandbox
      </Link>
    </div>
  );
}
