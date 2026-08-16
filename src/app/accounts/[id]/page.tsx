import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountWorkspace } from "./AccountWorkspace";
import { Nav } from "@/components/Nav";
import { UwCard } from "@/components/UwCard";
import { coverageLabels, getRequestType } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import {
  getAccountAdditionalInsureds,
  getAccountDetail,
  listQuoteSamples,
  listTickets,
} from "@/lib/db";
import { CertificateStudioLazy } from "./CertificateStudioLazy";
import { CertificateLedgerPanel } from "./CertificateLedgerPanel";
import { CertVerifyPanel } from "./CertVerifyPanel";
import { getAccountCertLedger } from "@/lib/cert-ledger-reads";
import { CoverageFloat } from "./CoverageFloat";
import { RedAlertPanel } from "./RedAlertPanel";
import { buildCoverageSummary } from "@/lib/coverage-summary";
import { listRedAlertsForAccount } from "@/lib/red-alerts";
import {
  getAccountCertHolders,
  getAccountPlacementRules,
  placementMapOf,
} from "@/lib/cert-corrections";
import { DeskBrain } from "@/components/DeskBrain";
import { IscIntakePanel } from "./IscIntakePanel";
import { PolicyPaperPanel } from "./PolicyPaperPanel";
import { buildDeskBrainBundle } from "@/lib/desk-brain";
import { getPolicyFormSet, type PolicyFormSet } from "@/lib/forms";
import { summarizeQuotes } from "@/lib/price-guidance";
import { TicketAdditionalInsureds } from "@/components/TicketAdditionalInsureds";
import { getSessionOperator } from "@/lib/session";
import { markAccountPaymentReceivedAction } from "@/lib/actions";
import { ACCOUNT_STATUS_LABELS } from "@/lib/types";
import {
  isOpenTicket,
  TICKET_STATUS_STYLES,
  ticketSourceLabel,
  ticketStatusLabel,
} from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, operator] = await Promise.all([
    params,
    getSessionOperator(),
  ]);
  const account = getAccountDetail(id);
  if (!account) notFound();
  const tickets = listTickets().filter((t) => t.accountId === account.id);
  const aiRows = getAccountAdditionalInsureds(account.id);

  // Schedule of record per policy, resolved here so the studio can't drift
  const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
    account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
  );
  const quoteSamples = listQuoteSamples();
  const guidance = summarizeQuotes(quoteSamples);

  // Desk placement corrections — the resolver honors them on every render.
  const placementRules = getAccountPlacementRules(account.id);
  const placements = placementMapOf(placementRules);

  // Holder rail sources, in order of trust: holders named on this account's
  // tickets, recorded additional insureds, then desk-typed saved holders.
  const ticketHolders = tickets
    .filter((t) => t.holderName?.trim())
    .map((t) => ({
      name: t.holderName!.trim(),
      address: t.holderAddress?.trim() ?? "",
      requesterEmail: t.requestedByEmail,
      detail: t.subject,
    }));
  const registryHolders = aiRows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      address: r.address?.trim() ?? "",
      detail: r.formUsed ? `On file — ${r.formUsed}` : "On file",
    }));
  const savedHolders = getAccountCertHolders(account.id).map((h) => ({
    id: h.id,
    name: h.name,
    address: h.address,
  }));

  // Coverage cells in the studio stay locked to the schedule of record; only
  // an open ticket that actually changes conditions (an endorsement or an
  // exposure change) can unlock editing.
  const endorsementTickets = tickets
    .filter((t) => {
      if (!isOpenTicket(t.status)) return false;
      const category = getRequestType(t.requestType).category;
      return category === "endorsement" || category === "exposure";
    })
    .map((t) => ({
      id: t.id,
      label: getRequestType(t.requestType).label,
      status: ticketStatusLabel(t.status),
      subject: t.subject,
    }));

  // Desk Brain context — plain serializable data; the client panel answers
  // deterministically from this bundle, never from the db.
  const brainBundle = buildDeskBrainBundle({
    account,
    formSets,
    quoteSamples,
  });

  // Floating coverage rail — the schedule of record, resolved once here and
  // pinned to the viewport so it follows the operator down the page.
  const coverageSummary = buildCoverageSummary(
    account,
    account.policies,
    formSets,
  );

  // Red alerts — active stand-down first, resolved history behind it.
  const redAlerts = listRedAlertsForAccount(account.id);

  // Certificate ledger — issued paper, supersede chain, blocked attempts.
  const certLedger = getAccountCertLedger(account.id);

  const openTickets = tickets.filter((t) => isOpenTicket(t.status));
  const preBind = account.status === "pre_bind";

  return (
    <>
      <Nav active="/accounts" operator={operator} />
      <CoverageFloat policies={coverageSummary} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <AccountWorkspace
          initialTab="overview"
          header={
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Account Workspace
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="page-title text-2xl text-[var(--ink)]">
                      {account.name}
                    </h1>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        account.status === "active"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : account.status === "pre_bind"
                            ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                            : "bg-stone-100 text-stone-500 ring-stone-400/20"
                      }`}
                    >
                      {ACCOUNT_STATUS_LABELS[account.status]}
                    </span>
                  </div>
                  {preBind && (
                    <form action={markAccountPaymentReceivedAction} className="mt-2">
                      <input type="hidden" name="accountId" value={account.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        Mark Payment Received — Activate Service
                      </button>
                    </form>
                  )}
                  {account.dba && (
                    <p className="text-sm text-[var(--muted)]">DBA {account.dba}</p>
                  )}
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {account.industry} · {account.state}
                  </p>
                  {account.notes && (
                    <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
                      {account.notes}
                    </p>
                  )}
                </div>
                <Link
                  href="/tickets/new"
                  className="rounded-lg bg-[var(--coral)] px-4 py-2 text-sm font-semibold text-white"
                >
                  New Ticket
                </Link>
              </div>
              <RedAlertPanel
                accountId={account.id}
                alerts={redAlerts}
                operator={operator}
              />
            </div>
          }
          rail={
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                Open Work
              </p>
              {openTickets.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No open tickets.</p>
              ) : (
                <ul className="space-y-1.5">
                  {openTickets.slice(0, 8).map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/tickets/${t.id}`}
                        className="block rounded-md px-2 py-1.5 text-xs hover:bg-[var(--sand)]"
                      >
                        <span className="font-semibold text-[var(--ink)]">
                          {getRequestType(t.requestType).label}
                        </span>
                        <span className="mt-0.5 block text-[var(--muted)]">
                          {ticketStatusLabel(t.status)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/all-accounts" className="btn-ghost mt-2 block text-center text-xs">
                Back To All Accounts
              </Link>
            </div>
          }
          panels={{
            overview: (
              <div className="space-y-8">
                <div className="grid gap-4 lg:grid-cols-2">
                  <UwCard uw={account.primaryUw} role="Primary" />
                  {account.backupUw ? (
                    <UwCard uw={account.backupUw} role="Backup" />
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--rule)] p-4 text-sm text-[var(--muted)]">
                      No backup underwriter on file.
                    </div>
                  )}
                </div>
                <section>
                  <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
                    Policies
                  </h2>
                  <div className="overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] shadow-sm">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-[var(--rule)] bg-[var(--sand)]/50 text-xs uppercase tracking-wide text-[var(--muted)]">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Policy #</th>
                          <th className="px-4 py-3 font-semibold">Carrier</th>
                          <th className="px-4 py-3 font-semibold">Coverages</th>
                          <th className="px-4 py-3 font-semibold">Premium</th>
                          <th className="px-4 py-3 font-semibold">Term</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.policies.map((p) => (
                          <tr key={p.id} className="border-b border-[var(--rule)]">
                            <td className="px-4 py-3 font-medium">
                              {p.policyNumber.trim() || (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">{p.carrier}</td>
                            <td className="px-4 py-3 text-[var(--muted)]">
                              {coverageLabels(p.coverages)}
                            </td>
                            <td className="px-4 py-3">
                              {formatMoney(p.premiumCents)}
                            </td>
                            <td className="px-4 py-3 text-[var(--muted)]">
                              {p.effectiveDate} → {p.expirationDate}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {account.policies.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                        No policies on file for this account.
                      </p>
                    ) : null}
                  </div>
                </section>
                <PolicyPaperPanel
                  account={account}
                  policies={account.policies}
                  formSets={formSets}
                />
                <DeskBrain bundle={brainBundle} />
              </div>
            ),
            checkout: (
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted)]">
                  Order-grain G1–G6 checkout / bind progression for pre-bind
                  accounts. Deep Pending Orders wiring lands in the lane PR.
                </p>
                {preBind ? (
                  <div className="surface-card p-4 text-sm text-[var(--ink)]">
                    Status: Pre-Bind
                    {account.paymentReceivedAt
                      ? ` · Payment ${account.paymentReceivedAt}`
                      : " · Payment not recorded"}
                    {account.policies.some(
                      (p) => p.carrier.trim().toLowerCase() === "isc",
                    ) ? (
                      <div className="mt-4">
                        <IscIntakePanel
                          accountId={account.id}
                          policies={account.policies.filter(
                            (p) => p.carrier.trim().toLowerCase() === "isc",
                          )}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    Account is not in pre-bind — checkout journey is complete.
                  </p>
                )}
              </div>
            ),
            tickets: (
              <div>
                {tickets.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">
                    Nothing open or closed for this account yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tickets.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/tickets/${t.id}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] px-4 py-3 shadow-sm hover:border-[var(--accent)]/40"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-[var(--ink)]">
                              {getRequestType(t.requestType).label}
                            </p>
                            <p className="truncate text-xs text-[var(--muted)]">
                              {t.subject} · {ticketSourceLabel(t.source)} ·{" "}
                              {t.requestedBy}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TICKET_STATUS_STYLES[t.status]}`}
                          >
                            {ticketStatusLabel(t.status)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
            communications: (
              <div className="space-y-3">
                <p className="text-sm text-[var(--muted)]">
                  Account-centric thread desk (email, calls/texts, ticket
                  linkage) deepens in the Communications lane PR. Threads on
                  file:
                </p>
                {account.threads.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No threads yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {account.threads.map((th) => (
                      <li key={th.id}>
                        <Link
                          href={`/threads/${th.id}`}
                          className="block rounded-xl border border-[var(--rule)] bg-white px-4 py-3 text-sm hover:border-[var(--coral)]/40"
                        >
                          <span className="font-semibold text-[var(--ink)]">
                            {th.subject}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--muted)]">
                            {th.status} · {th.requestType}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
            documents: (
              <div className="space-y-3">
                <p className="text-sm text-[var(--muted)]">
                  Policy paper and schedule-of-record documents. Import pipeline
                  deepens later.
                </p>
                <PolicyPaperPanel
                  account={account}
                  policies={account.policies}
                  formSets={formSets}
                />
              </div>
            ),
            certificates: (
              <div id="certificates" className="space-y-4 scroll-mt-6">
                <CertificateStudioLazy
                  account={account}
                  policies={account.policies}
                  formSets={formSets}
                  guidance={guidance}
                  placements={placements}
                  placementRules={placementRules.map((r) => ({
                    id: r.id,
                    policyId: r.policyId,
                    sectionKey: r.sectionKey,
                    movedFrom: r.movedFrom,
                    correctedBy: r.correctedBy,
                    createdAt: r.createdAt,
                  }))}
                  ticketHolders={ticketHolders}
                  registryHolders={registryHolders}
                  savedHolders={savedHolders}
                  endorsementTickets={endorsementTickets}
                />
                <CertificateLedgerPanel
                  accountId={account.id}
                  certs={certLedger.certs}
                  attempts={certLedger.attempts}
                  notices={certLedger.notices}
                  prepared={certLedger.prepared}
                />
                <CertVerifyPanel
                  account={account}
                  policies={account.policies}
                  formSets={formSets}
                />
                <div>
                  <h3 className="mb-2 font-display text-xl text-[var(--ink)]">
                    Additional Insureds
                  </h3>
                  <TicketAdditionalInsureds rows={aiRows} accountId={account.id} />
                </div>
              </div>
            ),
            portal: (
              <div className="surface-card p-5 text-sm text-[var(--muted)]">
                Customer Portal activity for this account will surface here
                (status, COI self-serve, deal tracker). Read-only until portal
                analytics adapters land.
              </div>
            ),
            actions: (
              <div className="space-y-3">
                <p className="text-sm text-[var(--muted)]">
                  Guarded actions (send, bind, COI, DocuSign, payment) appear
                  here with capability gates — never dead controls.
                </p>
                <ul className="space-y-2 text-sm">
                  <li>
                    <Link href="/queue" className="btn-primary inline-flex">
                      View Ticket Queue
                    </Link>
                  </li>
                  <li>
                    <Link href="/tickets/new" className="btn-ghost inline-flex">
                      New Ticket
                    </Link>
                  </li>
                  {preBind ? (
                    <li className="text-[var(--muted)]">
                      Pre-bind: payment activation available in the header.
                    </li>
                  ) : null}
                </ul>
              </div>
            ),
          }}
        />
      </main>
    </>
  );
}
