import Link from "next/link";
import { notFound } from "next/navigation";
import { IscMarketPanel } from "@/components/IscMarketPanel";
import { Nav } from "@/components/Nav";
import { kindLabel, type CarrierIntel } from "@/lib/carriers";
import { getCarrierTheme } from "@/lib/carrier-theme";
import { getCarrierDesk, listAccounts } from "@/lib/db";
import { folderLabel } from "@/lib/documents";
import { endorsementKindLabel, type EndorsementKind } from "@/lib/forms";
import { formatMoney } from "@/lib/format";
import {
  placementPathBlurb,
  placementPathFor,
  placementPathLabel,
} from "@/lib/market-path";
import { getSessionOperator } from "@/lib/session";
import { serviceInboxesForCarrier } from "@/lib/carrier-inboxes.server";
import { isUselessMailbox } from "@/lib/verified-contacts";
import { verifiedContactsForCarrier } from "@/lib/verified-contacts.server";

export const dynamic = "force-dynamic";

export default async function CarrierDeskPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const desk = getCarrierDesk(slug);
  if (!desk) notFound();

  const operator = await getSessionOperator();
  const { carrier, forms, policies, documents } = desk;
  const theme = getCarrierTheme(carrier.name);
  const known = JSON.parse(carrier.knownJson) as string[];
  const lines = JSON.parse(carrier.linesJson) as string[];
  const accounts = listAccounts();
  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? id;

  const coverageForms = forms.filter((f) => f.kind === "coverage");
  const endtForms = forms.filter((f) => f.kind !== "coverage");
  const path = placementPathFor(carrier.kind as CarrierIntel["kind"]);
  const verified = verifiedContactsForCarrier(carrier.name);
  const serviceInboxes = serviceInboxesForCarrier(carrier.name);
  const serviceEmail =
    carrier.serviceEmail && !isUselessMailbox(carrier.serviceEmail)
      ? carrier.serviceEmail
      : null;
  const isIsc = slug === "isc";

  return (
    <>
      <Nav active="/contacts" operator={operator} />
      <main className="carrier-desk relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[42vh] opacity-90"
          style={{
            background: `radial-gradient(ellipse 60% 50% at 10% 0%, ${theme.accent}22, transparent 55%),
              radial-gradient(ellipse 40% 40% at 90% 10%, rgba(26,44,54,0.06), transparent 50%)`,
          }}
          aria-hidden
        />

        <div className="relative mx-auto max-w-5xl px-4 pb-20 pt-10 sm:px-6">
          <Link
            href="/contacts?tab=carriers"
            className="text-xs text-[var(--muted)] hover:underline"
          >
            ← Carriers
          </Link>

          <header className="mt-4 max-w-2xl">
            <p className="eyebrow" style={{ color: theme.accent }}>
              {placementPathLabel(path)} ·{" "}
              {kindLabel(carrier.kind as CarrierIntel["kind"])} ·{" "}
              {carrier.channel}
            </p>
            <h1 className="mt-2 font-display text-[clamp(2.75rem,6vw,4.25rem)] leading-[0.92] tracking-[-0.03em] text-[var(--ink)]">
              {carrier.name}
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
              {placementPathBlurb(path)}
            </p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--muted)]">
              <span>{lines.join(" · ")}</span>
              {carrier.portal && (
                <a
                  href={carrier.portal}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
                >
                  Portal
                </a>
              )}
              {serviceEmail && <span>{serviceEmail}</span>}
            </div>
          </header>

          {isIsc && (
            <IscMarketPanel
              carrier={{
                name: carrier.name,
                kind: carrier.kind as CarrierIntel["kind"],
                lines,
                portal: carrier.portal ?? undefined,
                channel: carrier.channel as CarrierIntel["channel"],
                serviceEmail: serviceEmail ?? undefined,
                known,
                whenOut: carrier.whenOut ?? undefined,
              }}
              contacts={verified}
              accent={theme.accent}
            />
          )}

          {known.length > 0 && !isIsc && (
            <section className="mt-12 border-t border-[var(--rule)] pt-8">
              <p className="eyebrow">What We Know</p>
              <ul className="mt-4 max-w-2xl space-y-3">
                {known.map((k) => (
                  <li
                    key={k}
                    className="border-l-2 pl-4 text-sm leading-relaxed text-[var(--ink)]"
                    style={{ borderColor: theme.accent }}
                  >
                    {k}
                  </li>
                ))}
              </ul>
              {carrier.whenOut && (
                <p className="mt-5 max-w-2xl text-xs text-[var(--muted)]">
                  When Out: {carrier.whenOut}
                </p>
              )}
            </section>
          )}

          {!isIsc && verified.length > 0 && (
            <section className="mt-12 border-t border-[var(--rule)] pt-8">
              <p className="eyebrow">Verified Underwriters</p>
              <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                {verified.length} Named Contact
                {verified.length === 1 ? "" : "s"}
              </h2>
              <ul className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                {verified.slice(0, 12).map((c) => (
                  <li
                    key={`${c.sourceId}-${c.email}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                  >
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {c.name}
                    </p>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {c.email}
                    </span>
                  </li>
                ))}
              </ul>
              {verified.length > 12 && (
                <Link
                  href={`/contacts?q=${encodeURIComponent(carrier.name)}`}
                  className="mt-3 inline-block text-xs underline decoration-[var(--rule)] underline-offset-4"
                >
                  View All On Contacts
                </Link>
              )}
            </section>
          )}

          {serviceInboxes.length > 0 && (
            <section className="mt-12 border-t border-[var(--rule)] pt-8">
              <p className="eyebrow">Service Inboxes</p>
              <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                {serviceInboxes.length} Functional Mailbox
                {serviceInboxes.length === 1 ? "" : "es"}
              </h2>
              <p className="mt-2 max-w-2xl text-xs text-[var(--muted)]">
                Carrier desks rather than named underwriters — support,
                payments, submissions, and similar functional mailboxes.
              </p>
              <ul className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                {serviceInboxes.map((inbox) => (
                  <li
                    key={`${inbox.sourceId}-${inbox.email}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)]">
                        {inbox.purpose}
                      </p>
                      {inbox.notes && (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {inbox.notes}
                        </p>
                      )}
                    </div>
                    <span className="break-all font-mono text-xs text-[var(--muted)]">
                      {inbox.email}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-14 border-t border-[var(--rule)] pt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="eyebrow">Form Library</p>
                <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                  {forms.length === 0
                    ? "Library Not Loaded Yet"
                    : `${forms.length} Forms On File`}
                </h2>
              </div>
              {slug === "coterie" && (
                <p className="text-xs text-[var(--muted)]">
                  Coterie Reference Set — Verbatim Titles Checked In
                </p>
              )}
              {isIsc && (
                <p className="text-xs text-[var(--muted)]">
                  ISC Form Library Rolls Out Next — Coterie Is The Reference
                </p>
              )}
            </div>

            {coverageForms.length > 0 && (
              <div className="mt-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  Coverage Parts
                </p>
                <ul className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                  {coverageForms.map((f) => (
                    <FormRow key={f.id} form={f} />
                  ))}
                </ul>
              </div>
            )}

            {endtForms.length > 0 && (
              <div className="mt-10">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  Endorsements &amp; Other
                </p>
                <ul className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                  {endtForms.map((f) => (
                    <FormRow key={f.id} form={f} />
                  ))}
                </ul>
              </div>
            )}

            {forms.length === 0 && (
              <p className="mt-6 text-sm text-[var(--muted)]">
                Full form libraries roll out carrier-by-carrier. Coterie is the
                reference implementation.
              </p>
            )}
          </section>

          <section className="mt-14 border-t border-[var(--rule)] pt-8">
            <p className="eyebrow">Policies On Book</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              {policies.length} Polic{policies.length === 1 ? "y" : "ies"}
            </h2>
            <ul className="mt-6 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {policies.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 py-4"
                >
                  <div>
                    <p className="font-mono text-sm text-[var(--ink)]">
                      {p.policyNumber}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {accountName(p.accountId)} · {p.coverages.join(", ")} ·{" "}
                      {p.effectiveDate} → {p.expirationDate}
                    </p>
                  </div>
                  <p className="text-sm text-[var(--ink)]">
                    {formatMoney(p.premiumCents)}
                  </p>
                </li>
              ))}
              {policies.length === 0 && (
                <li className="py-8 text-sm text-[var(--muted)]">
                  No policies on this market in the sandbox book.
                </li>
              )}
            </ul>
          </section>

          <section className="mt-14 border-t border-[var(--rule)] pt-8">
            <p className="eyebrow">Documents</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
              Filed Under {carrier.name}
            </h2>
            <ul className="mt-6 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {documents.map((d) => (
                <li key={d.id} className="py-3.5">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {d.canonicalName}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                    {folderLabel(d.folder)}
                    {d.sizeLabel ? ` · ${d.sizeLabel}` : ""}
                    {d.trusted ? " · trusted" : " · untrusted"}
                  </p>
                </li>
              ))}
              {documents.length === 0 && (
                <li className="py-8 text-sm text-[var(--muted)]">
                  No documents tagged to this carrier yet.
                </li>
              )}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}

function FormRow({
  form,
}: {
  form: {
    form: string;
    edition: string;
    title: string;
    kind: string;
    verbatim: string;
    notes: string | null;
  };
}) {
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm tracking-tight text-[var(--ink)]">
          {form.form}
          {form.edition ? (
            <span className="text-[var(--muted)]"> ({form.edition})</span>
          ) : null}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
          {form.kind === "coverage"
            ? "Coverage"
            : endorsementKindLabel(form.kind as EndorsementKind)}
        </span>
      </div>
      <p className="mt-1 font-display text-lg leading-snug text-[var(--ink)]">
        {form.title}
      </p>
      {form.verbatim && (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
          {form.verbatim}
        </p>
      )}
      {form.notes && (
        <p className="mt-2 text-xs text-[var(--coral)]">{form.notes}</p>
      )}
    </li>
  );
}
