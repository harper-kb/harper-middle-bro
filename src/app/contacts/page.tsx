import Link from "next/link";
import { CarrierCard } from "@/components/CarrierCard";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import { VerifiedContactCard } from "@/components/VerifiedContactCard";
import { CARRIER_INTEL } from "@/lib/carriers";
import {
  placementPathFor,
  placementPathLabel,
} from "@/lib/market-path";
import { getSessionOperator } from "@/lib/session";
import { VERIFIED_CONTACTS_SOURCE } from "@/lib/verified-contacts";
import { listVerifiedContacts } from "@/lib/verified-contacts.server";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
  const tab = typeof sp.tab === "string" ? sp.tab : "underwriters";
  const pathFilter =
    typeof sp.path === "string" ? sp.path : "all";
  const operator = await getSessionOperator();
  const verifiedContacts = listVerifiedContacts();

  const underwriters = verifiedContacts.filter((c) => {
    if (pathFilter !== "all") {
      const intel = CARRIER_INTEL.find(
        (x) => x.name.toLowerCase() === c.carrier.toLowerCase(),
      );
      if (!intel) return false;
      if (placementPathFor(intel.kind) !== pathFilter) return false;
    }
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.carrier.toLowerCase().includes(q) ||
      (c.notes?.toLowerCase().includes(q) ?? false)
    );
  });

  const carriers = CARRIER_INTEL.filter((c) => {
    if (pathFilter !== "all" && placementPathFor(c.kind) !== pathFilter) {
      return false;
    }
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.kind.includes(q) ||
      c.channel.includes(q) ||
      placementPathLabel(placementPathFor(c.kind)).toLowerCase().includes(q) ||
      c.lines.some((l) => l.toLowerCase().includes(q)) ||
      c.known.some((k) => k.toLowerCase().includes(q))
    );
  });

  const desksByCarrier = new Map<string, typeof verifiedContacts>();
  for (const c of verifiedContacts) {
    const list = desksByCarrier.get(c.carrier) ?? [];
    list.push(c);
    desksByCarrier.set(c.carrier, list);
  }

  const byCarrierCount = new Map<string, number>();
  for (const c of verifiedContacts) {
    byCarrierCount.set(c.carrier, (byCarrierCount.get(c.carrier) ?? 0) + 1);
  }

  const pathQs =
    pathFilter !== "all" ? `&path=${encodeURIComponent(pathFilter)}` : "";
  const qQs = q ? `&q=${encodeURIComponent(q)}` : "";

  return (
    <>
      <Nav active="/contacts" operator={operator} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <p className="eyebrow">Records</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            Contacts
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Named underwriters with verified emails. Unverified addresses are
            omitted; a sparse list is correct.
          </p>
          <p className="mt-2 font-mono text-[10px] tracking-wide text-[var(--muted)]">
            Source · {VERIFIED_CONTACTS_SOURCE} · {verifiedContacts.length}{" "}
            contacts
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["all", "All Paths"],
              ["direct", "Direct Carrier"],
              ["mga", "MGA Path"],
              ["wholesale", "Wholesale Path"],
            ] as const
          ).map(([id, label]) => (
            <Link
              key={id}
              href={`/contacts?tab=${tab === "carriers" ? "carriers" : "underwriters"}${qQs}${id === "all" ? "" : `&path=${id}`}`}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                pathFilter === id
                  ? "bg-[var(--ink)] text-white"
                  : "bg-[var(--paper)] text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link
            href={`/contacts?tab=underwriters${qQs}${pathQs}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition ${
              tab !== "carriers"
                ? "bg-[var(--ink)] text-white"
                : "bg-[var(--paper)] text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            Underwriters ({underwriters.length})
          </Link>
          <Link
            href={`/contacts?tab=carriers${qQs}${pathQs}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition ${
              tab === "carriers"
                ? "bg-[var(--ink)] text-white"
                : "bg-[var(--paper)] text-[var(--ink)] ring-1 ring-[var(--rule)] hover:ring-[var(--gold)]"
            }`}
          >
            Carriers ({carriers.length})
          </Link>
          <form className="ml-auto flex min-w-[220px] flex-1 gap-2 sm:max-w-sm">
            <input
              type="hidden"
              name="tab"
              value={tab === "carriers" ? "carriers" : "underwriters"}
            />
            {pathFilter !== "all" && (
              <input type="hidden" name="path" value={pathFilter} />
            )}
            <input
              name="q"
              defaultValue={typeof sp.q === "string" ? sp.q : ""}
              placeholder="Search…"
              className="field"
            />
            <button type="submit" className="btn-primary">
              Search
            </button>
          </form>
        </div>

        {tab !== "carriers" && (
          <div className="mb-6">
            <DeskSection
              title="Coverage By Carrier"
              summary={`${byCarrierCount.size} Carriers`}
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                {[...byCarrierCount.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, n]) => (
                    <span key={name}>
                      {name} · {n}
                    </span>
                  ))}
                <span className="text-[var(--gold)]">
                  NEXT / Hiscox / Thimble · no named underwriter verified
                </span>
              </div>
            </DeskSection>
          </div>
        )}

        {tab === "carriers" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {carriers.map((c) => (
              <CarrierCard
                key={c.name}
                carrier={c}
                desks={[]}
                verified={desksByCarrier.get(c.name) ?? []}
              />
            ))}
            {carriers.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No Matches.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {underwriters.map((c) => (
              <VerifiedContactCard
                key={`${c.sourceId}-${c.email}`}
                contact={c}
              />
            ))}
            {underwriters.length === 0 && (
              <p className="text-sm text-[var(--muted)]">
                No verified contacts match. We do not pad with fabricated
                underwriters.
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
