import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import {
  FACET_LABELS,
  instantBindAction,
  instantBindBucket,
  instantBindFacet,
  sortInstantBindsOldestFirst,
} from "@/lib/lanes/instant-binds";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InstantBindsPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("instant_binds");
  const items = sortInstantBindsOldestFirst(snapshot.items).map((item) => {
    const facet = instantBindFacet(item);
    const signatureNeeded = instantBindBucket(item) === "signature_needed";
    return {
      ...item,
      summary: `${item.summary} · facet ${FACET_LABELS[facet]}`,
      nextActionLabel: instantBindAction(item),
      blocker:
        // Signature-locked carriers keep their signature chase — do not
        // overwrite with a carrier-access / write.bind portal blocker.
        signatureNeeded || facet === "none"
          ? item.blocker
          : {
              code: facet,
              label: FACET_LABELS[facet],
              capabilityId:
                facet === "carrier_access"
                  ? ("write.bind" as const)
                  : item.blocker?.capabilityId ?? null,
            },
    };
  });
  const withoutSignature = items.filter(
    (item) => instantBindBucket(item) === "no_signature",
  );
  const withSignature = items.filter(
    (item) => instantBindBucket(item) === "signature_needed",
  );

  return (
    <div>
      <Nav active="/instant-binds" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">Instant Binds</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Full pending IQ account lists split by signature requirement and
            sorted oldest to youngest. Payment, subjectivity, re-rate, referral,
            and carrier-access facets remain secondary signals.
          </p>
        </div>
        <LaneModeBanner mode={snapshot.mode} reason={snapshot.modeReason} count={items.length} sourceCount={snapshot.sourceCount} />
        <div className="mt-5 space-y-8">
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Without Signature</p>
                <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                  Instant Binds without Signature
                </h2>
              </div>
              <span className="rounded-full bg-[var(--sand)] px-3 py-1 text-sm font-semibold text-[var(--ink)]">
                {withoutSignature.length}
              </span>
            </div>
            <SectionLanePage
              lane="instant_binds"
              mode={snapshot.mode}
              modeReason={snapshot.modeReason}
              items={withoutSignature}
              preserveOrder
            />
          </section>
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">With Signature</p>
                <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                  Instant Binds with Signature
                </h2>
                <p className="mt-1 max-w-3xl text-xs text-[var(--muted)]">
                  RT Connector, Blitz, Pathpoint, Thimble, and ISC workers’ comp.
                </p>
              </div>
              <span className="rounded-full bg-[var(--sand)] px-3 py-1 text-sm font-semibold text-[var(--ink)]">
                {withSignature.length}
              </span>
            </div>
            <SectionLanePage
              lane="instant_binds"
              mode={snapshot.mode}
              modeReason={snapshot.modeReason}
              items={withSignature}
              preserveOrder
            />
          </section>
        </div>
      </main>
    </div>
  );
}
