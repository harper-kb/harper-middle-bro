import Link from "next/link";
import type { CarrierIntel } from "@/lib/carriers";
import { ISC_WRITERS } from "@/lib/naic";
import type { VerifiedContact } from "@/lib/verified-contacts";

/**
 * ISC-specific MGA desk panel — keeps MGA workflow distinct from
 * Coterie / NEXT direct-carrier portal paths.
 */
export function IscMarketPanel({
  carrier,
  contacts,
  accent,
}: {
  carrier: CarrierIntel;
  contacts: VerifiedContact[];
  accent: string;
}) {
  return (
    <section className="mt-12 border-t border-[var(--rule)] pt-8">
      <p className="eyebrow" style={{ color: accent }}>
        MGA Placement Path
      </p>
      <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
        How Harper Works ISC
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        ISC (Instant Specialty) is an MGA Harper works directly — same family of
        path as other MGA desks, and distinct from RT Specialty (wholesale) and
        from direct carriers like Coterie or NEXT. Do not flatten ISC tickets to
        a behind-carrier inbox.
      </p>

      <ol className="mt-8 max-w-2xl space-y-4">
        {[
          {
            t: "Portal First For Endorsements",
            d: "Additional Insured, name, and address changes file in Instant Specialty. Countersign, bind, download the documents, then validate in Big Brother.",
          },
          {
            t: "Email Exception Path",
            d: "Subjectivities and material business changes are not portal-only — email the ISC certs desk (certs@iscmga.com).",
          },
          {
            t: "The 30-Day Notice Loop",
            d: "Prepare the certificate first, then email it to certs@iscmga.com with the endorsement request. ISC replies with a charge for the endorsement — about $100 in desk history — which must be approved before the endorsement issues. Quotes at or under the $500 threshold auto-approve; anything above holds for a person.",
          },
          {
            t: "Session & State Caveats",
            d: "Portal sessions drop around 6 PM. Colorado 10-day Notice Of Cancellation is not available (30-day only).",
          },
        ].map((step, i) => (
          <li key={step.t} className="flex gap-4">
            <span
              className="font-mono text-sm tabular-nums"
              style={{ color: accent }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">{step.t}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                {step.d}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="border border-[var(--rule)] bg-[var(--paper)] p-5">
          <p className="eyebrow">Vs Direct Carriers</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
            Coterie and NEXT are direct carrier portals. Service stays on that
            carrier&apos;s desk. ISC is the MGA of record — the ultimate paper
            carrier sits behind ISC and is not Harper&apos;s first contact.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <Link
              href="/carriers/coterie"
              className="underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
            >
              Coterie Desk
            </Link>
            <Link
              href="/carriers/next-insurance"
              className="underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
            >
              NEXT Desk
            </Link>
          </div>
        </div>
        <div className="border border-[var(--rule)] bg-[var(--paper)] p-5">
          <p className="eyebrow">Vs Wholesale</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
            RT Specialty is a wholesale path: market out through the named RT
            underwriter on the account. ISC is Harper ↔ MGA, not Harper ↔
            wholesaler ↔ market.
          </p>
          <div className="mt-4">
            <Link
              href="/carriers/rt-specialty"
              className="text-xs underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
            >
              RT Specialty Desk
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <p className="eyebrow">Writing Companies</p>
        <h3 className="mt-1 font-display text-xl text-[var(--ink)]">
          The Paper Behind ISC
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          ISC holds no carrier license and no NAIC code of its own. Its
          policies issue on one of the four writers below — the dec page
          governs which one, and the desk records it per policy at intake.
          The certificate&apos;s INSURER line prints the writing company and
          its verified NAIC code, never the MGA.
        </p>
        <ul className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {ISC_WRITERS.map((w) => (
            <li
              key={w.naic}
              className="flex flex-wrap items-baseline justify-between gap-2 py-3"
            >
              <p className="text-sm font-medium text-[var(--ink)]">
                {w.issuingCompany}
              </p>
              <p className="font-mono text-xs text-[var(--muted)]">
                NAIC {w.naic}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-10">
        <p className="eyebrow">Verified ISC Underwriters</p>
        <h3 className="mt-1 font-display text-xl text-[var(--ink)]">
          {contacts.length === 0
            ? "No Named Contacts Verified"
            : `${contacts.length} Named Contacts`}
        </h3>
        {contacts.length > 0 ? (
          <ul className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {contacts.map((c) => (
              <li
                key={`${c.sourceId}-${c.email}`}
                className="flex flex-wrap items-baseline justify-between gap-2 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {c.name}
                  </p>
                  {c.notes && (
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {c.notes}
                    </p>
                  )}
                </div>
                <a
                  href={`mailto:${c.email}`}
                  className="font-mono text-xs text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4"
                >
                  {c.email}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            An empty list is preferred over inventing a certificate team
            address.
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">
          Channel default: {carrier.channel}. Portal:{" "}
          {carrier.portal ? (
            <a
              href={carrier.portal}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[var(--rule)] underline-offset-4"
            >
              Instant Specialty
            </a>
          ) : (
            "—"
          )}
          .{" "}
          <Link
            href="/contacts?path=mga&q=ISC"
            className="underline decoration-[var(--rule)] underline-offset-4"
          >
            All MGA Contacts
          </Link>
        </p>
      </div>
    </section>
  );
}
