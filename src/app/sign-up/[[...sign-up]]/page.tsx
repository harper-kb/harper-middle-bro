import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <p className="eyebrow">Step Bro</p>
        <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
          Create Account
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your first sign-up creates your desk operator profile and signature.
        </p>
      </div>
      <SignUp
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-none ring-1 ring-[var(--rule)]",
          },
        }}
      />
      <Link href="/" className="text-xs text-[var(--muted)] underline">
        ← Back To Sandbox
      </Link>
    </div>
  );
}
