"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { PriceGuidance } from "@/lib/price-guidance";
import { AUTO_APPROVE_THRESHOLD_CENTS } from "@/lib/types";
import type { Operator, TicketDetail } from "@/lib/types";
import { ClientTermsPanel } from "@/components/ClientTermsPanel";
import { CoiVerifier } from "@/components/CoiVerifier";

/**
 * The deliverable, not a separate errand. What the market answered decides
 * which door opens: no charge issues the certificate, a premium relays terms
 * to the insured first.
 */
export function TicketCertificate({
  ticket,
  operator,
  guidance,
}: {
  ticket: TicketDetail;
  operator: Operator | null;
  guidance?: Record<string, PriceGuidance>;
}) {
  const answered = [...ticket.threads]
    .reverse()
    .find((t) => t.offeredPremiumCents != null);

  // Blanket fast path: the paper already grants this — no market thread
  // exists because none was needed. The cert issues from the studio, on the
  // cited form's wording.
  if (ticket.fastPathBasis) {
    return (
      <div className="glass rounded-2xl px-6 py-12 text-center">
        <span className="inline-flex rounded-full border border-emerald-600/25 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
          {ticket.fastPathBasis}
        </span>
        <p className="mt-4 font-display text-2xl text-[var(--ink)]">
          Ready To Issue — No Market Touch
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">
          The schedule of record already carries the blanket endorsement this
          request needs, and the holder accepts wording. Issue the certificate
          from the account&apos;s Certificate Studio — the verifier holds it to
          the same paper.
        </p>
        <Link
          href={`/accounts/${ticket.accountId}`}
          className="btn-primary mt-5 inline-block"
        >
          Open Certificate Studio
        </Link>
      </div>
    );
  }

  if (!answered) {
    return (
      <div className="glass rounded-2xl px-6 py-14 text-center">
        <p className="font-display text-2xl text-[var(--ink)]">
          Waiting On The Market
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">
          This tab lights up the moment an underwriter answers. No charge and
          the certificate is ours to produce; a premium and the terms go to the
          insured first.
        </p>
        <Link
          href={`/tickets/${ticket.id}?tab=comms`}
          className="btn-ghost mt-5 inline-block"
        >
          Back To Underwriter Comms
        </Link>
      </div>
    );
  }

  const premium = answered.offeredPremiumCents ?? 0;

  if (premium > AUTO_APPROVE_THRESHOLD_CENTS) {
    return <ClientTermsPanel thread={answered} operator={operator} />;
  }

  if (premium === 0) {
    return (
      <CoiVerifier
        thread={answered}
        operator={operator}
        holder={{
          name: ticket.holderName ?? "",
          address: ticket.holderAddress ?? "",
        }}
        guidance={guidance}
      />
    );
  }

  return (
    <div className="glass rounded-2xl px-6 py-14 text-center">
      <p className="font-display text-2xl text-[var(--ink)]">
        Auto-Approved At {formatMoney(premium)}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">
        Under the {formatMoney(AUTO_APPROVE_THRESHOLD_CENTS)} line, so it went
        ahead without a human. Once the endorsement lands, issue the certificate
        from the account.
      </p>
    </div>
  );
}
