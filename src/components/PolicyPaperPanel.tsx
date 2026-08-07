import { resolveCertSheet } from "@/lib/acord25";
import { displayLimit } from "@/lib/cert-review";
import { buildCertificatePacket } from "@/lib/certificate";
import {
  endorsementKindLabel,
  type EndorsementKind,
  type PolicyFormSet,
} from "@/lib/forms";
import { naicForPolicy, NAIC_SOURCE } from "@/lib/naic";
import type { Account, Policy } from "@/lib/types";

/**
 * What The Paper Says — the schedule of record, rendered the way the
 * certificate will print it. Runs the same resolver the sheet uses (all
 * policies together, so insurer letters and section feeders match; garage
 * accounts resolve against the ACORD 30 registry), then regroups the
 * resolved boxes per policy: the issuing carrier identity off the verified
 * NAIC registry, coverage parts with form numbers, every ACORD limit box
 * with its dec-page value (dollars, "Included", or "Excluded"), and the
 * endorsement schedule. If it isn't here, the studio won't print it.
 */
export function PolicyPaperPanel({
  account,
  policies,
  formSets,
}: {
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
}) {
  if (policies.length === 0) return null;

  const packet = buildCertificatePacket({
    account,
    policies,
    formSets,
    holderName: "",
    holderAddress: "",
  });
  const hasGarage = policies.some(
    (p) =>
      p.coverages.some((c) => /garage|^GK$/i.test(c)) ||
      (formSets[p.id]?.coverages ?? []).some((c) => /garage/i.test(c.label)),
  );
  const sheet = resolveCertSheet(hasGarage ? "acord30" : "acord25", packet.sections);

  return (
    <section className="surface-card overflow-hidden">
      <header className="border-b border-[var(--rule)] px-5 py-4">
        <p className="eyebrow">Schedule Of Record</p>
        <h2 className="mt-0.5 font-display text-xl text-[var(--ink)]">
          What The Paper Says
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          Every value below comes off the policy forms — the same resolver
          fills the ACORD 25, so the sheet can never disagree with this panel.
          A limit prints as dollars, Included (covered within another limit),
          or Excluded (the dec doesn&apos;t state the line).
        </p>
      </header>

      <div className="grid gap-x-6 gap-y-5 px-5 py-4 lg:grid-cols-2">
        {policies.map((policy) => {
          const set = formSets[policy.id];
          const letter = packet.sections.find(
            (s) => s.policy.id === policy.id,
          )?.insurerLetter;

          // Sections + write-in rows this policy feeds, boxes as they print.
          const blocks: {
            name: string;
            lines: { label: string; value: string }[];
            note?: string;
          }[] = [];
          for (const rs of sheet.sections) {
            if (rs.feeder?.policy.id !== policy.id) continue;
            blocks.push({
              name: rs.def.name,
              lines: rs.def.limitBoxes
                .filter((b) => b.slot != null)
                .map((b) => ({
                  // Garagekeepers rows carry per-location limits — show the LOC.
                  label: rs.locs[b.key]
                    ? `${b.label} (${rs.locs[b.key]})`
                    : b.label,
                  value: displayLimit(rs.limits[b.key]),
                })),
            });
          }
          for (const row of sheet.others) {
            if (row.feeder?.policy.id !== policy.id || !row.label) continue;
            blocks.push({
              name: row.label,
              lines: row.lines.map((l) => ({
                label: l.label,
                value: displayLimit(l.value),
              })),
            });
          }
          // Coverages beyond the printed rows — same resolver, same values;
          // the cert carries them as Description Of Operations lines.
          for (const line of sheet.overflow) {
            if (line.row.feeder?.policy.id !== policy.id || !line.coverage) continue;
            blocks.push({
              name: line.coverage,
              lines: line.row.lines.map((l) => ({
                label: l.label,
                value: displayLimit(l.value),
              })),
              note: "Prints As A Description Of Operations Line",
            });
          }

          const identity = naicForPolicy(
            policy.carrier,
            policy.coverages,
            policy.issuingCarrier,
          );

          return (
            <article
              key={policy.id}
              className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-[var(--coral)]">
                    {policy.policyNumber}
                  </p>
                  <h3 className="font-display text-lg leading-tight text-[var(--ink)]">
                    {policy.carrier}
                  </h3>
                </div>
                {letter && (
                  <span
                    className="rounded border border-[var(--rule)] bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ink)]"
                    title="Insurer letter on the certificate"
                  >
                    Insurer {letter}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {policy.effectiveDate} → {policy.expirationDate}
              </p>

              {identity ? (
                <div className="mt-2 rounded-lg border border-[var(--rule)] bg-white px-2 py-1.5">
                  <p className="text-[11px] text-[var(--ink)]">
                    Issued By{" "}
                    <span className="font-semibold">{identity.issuingCompany}</span>{" "}
                    <span className="font-mono text-[10px]">
                      · NAIC {identity.naic}
                    </span>
                  </p>
                  <p
                    className="mt-0.5 text-[9.5px] uppercase tracking-wide text-[var(--muted)]"
                    title={NAIC_SOURCE}
                  >
                    NAIC Registry (Verified)
                  </p>
                  {identity.note && (
                    <p className="mt-0.5 text-[10px] italic leading-snug text-[var(--muted)]">
                      {identity.note}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[10px] italic text-[var(--muted)]">
                  No verified NAIC identity for this market — the cert&apos;s
                  NAIC cell prints blank.
                </p>
              )}

              <p className="eyebrow mt-3">Coverage Parts</p>
              <ul className="mt-1 space-y-0.5">
                {set.coverages.map((c) => (
                  <li
                    key={`${c.code}-${c.form}`}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="text-[var(--ink)]">{c.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">
                      {c.form} {c.edition}
                    </span>
                  </li>
                ))}
              </ul>

              {blocks.map((block) => (
                <div key={block.name}>
                  <p className="eyebrow mt-3">{block.name}</p>
                  {block.note && (
                    <p className="mt-0.5 text-[9.5px] uppercase tracking-wide text-[var(--muted)]">
                      {block.note}
                    </p>
                  )}
                  {block.lines.length === 0 ? (
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      Named on the certificate; no limit schedule prints.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {block.lines.map((line) => (
                        <li
                          key={line.label}
                          className="flex items-baseline justify-between gap-2 text-xs"
                        >
                          <span className="text-[var(--muted)]">{line.label}</span>
                          <span
                            className={`shrink-0 font-mono tabular-nums ${
                              line.value === "Excluded"
                                ? "text-[var(--muted)] opacity-70"
                                : line.value === "Included"
                                  ? "italic text-[var(--ink)]"
                                  : "font-semibold text-[var(--ink)]"
                            }`}
                          >
                            {line.value === "Included" || line.value === "Excluded"
                              ? line.value
                              : `$ ${line.value}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              <p className="eyebrow mt-3">Endorsements</p>
              {set.endorsements.length === 0 ? (
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  None on the schedule.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {set.endorsements.map((e) => (
                    <li key={`${e.form}-${e.title}`} className="text-xs">
                      <span className="font-mono text-[10px] text-[var(--ink)]">
                        {e.form} {e.edition}
                      </span>{" "}
                      <span className="rounded bg-white px-1 py-px font-mono text-[9px] uppercase tracking-wide text-[var(--muted)] ring-1 ring-[var(--rule)]">
                        {endorsementKindLabel(e.kind as EndorsementKind)}
                      </span>
                      <span className="ml-1 text-[var(--muted)]">{e.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
