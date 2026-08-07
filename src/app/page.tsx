import { Nav } from "@/components/Nav";
import { SandboxCompose } from "@/components/SandboxCompose";
import { listAccounts } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SandboxPage() {
  const accounts = listAccounts();
  const operator = await getSessionOperator();

  return (
    <>
      <Nav active="/" operator={operator} />
      <main className="mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <p className="eyebrow">Commercial Lines Sandbox</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Compose
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Look up the account, gather every request — Additional Insured
            (AI), Waiver Of Subrogation (WOS), 30-Day Notice Of Cancellation,
            business changes — and send one email. Premium cues show what is
            likely to quote; threads proceed automatically when premium is ≤
            $500.
          </p>
        </div>
        <SandboxCompose accounts={accounts} operator={operator} />
      </main>
    </>
  );
}
