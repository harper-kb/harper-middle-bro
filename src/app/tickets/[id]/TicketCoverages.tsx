import {
  endorsementKindLabel,
  getPolicyFormSet,
  limitSlotLabel,
  limitStatement,
  type EndorsementKind,
} from "@/lib/forms";
import { formatMoney } from "@/lib/format";
import type { Policy } from "@/lib/types";

export function TicketCoverages({ policies }: { policies: Policy[] }) {
  if (policies.length === 0) {
    return (
      <p className="py-12 text-sm text-[var(--muted)]">
        No policies linked to this ticket.
      </p>
    );
  }

  return (
    <div className="space-y-12">
      <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Source of truth for certificates and endorsement requests. Limits and
        forms come from the policy schedule — never from a customer upload.
      </p>

      {policies.map((policy) => {
        const set = getPolicyFormSet(policy);
        const hasBlanketAi = set.endorsements.some(
          (e) =>
            e.kind === "ai" && /blanket/i.test(`${e.title} ${e.note ?? ""}`),
        );

        return (
          <section key={policy.id} className="border-t border-[var(--rule)] pt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-[var(--coral)]">
                  {policy.policyNumber}
                </p>
                <h3 className="mt-1 font-display text-2xl text-[var(--ink)]">
                  {policy.carrier}
                </h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {policy.effectiveDate} → {policy.expirationDate} ·{" "}
                  {formatMoney(policy.premiumCents)} annual
                </p>
              </div>
            </div>

            {hasBlanketAi && (
              <p className="mt-4 border-l-2 border-[var(--gold)] pl-3 text-xs leading-relaxed text-[var(--muted)]">
                Blanket additional insured appears on this schedule — verify
                before requesting a scheduled AI endorsement.
              </p>
            )}

            <div className="mt-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Coverage parts
              </p>
              <ul className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                {set.coverages.map((c) => (
                  <li
                    key={`${c.code}-${c.form}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                  >
                    <span className="text-sm text-[var(--ink)]">{c.label}</span>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {c.form}
                      {c.edition ? ` (${c.edition})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Limits
              </p>
              {set.limits.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  No limit schedule on file.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                  {set.limits.map((l) => (
                    <li
                      key={l.slot}
                      className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                    >
                      <span className="text-sm text-[var(--ink)]">
                        {limitSlotLabel(l.slot)}
                      </span>
                      <span className="font-mono text-sm text-[var(--ink)]">
                        {limitStatement(l)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Endorsement schedule
              </p>
              {set.endorsements.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  No endorsements listed.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                  {set.endorsements.map((e) => (
                    <li key={`${e.form}-${e.edition}-${e.title}`} className="py-4">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-sm text-[var(--ink)]">
                          {e.form}
                          {e.edition ? (
                            <span className="text-[var(--muted)]">
                              {" "}
                              ({e.edition})
                            </span>
                          ) : null}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                          {endorsementKindLabel(e.kind as EndorsementKind)}
                        </span>
                      </div>
                      <p className="mt-1 font-display text-lg leading-snug text-[var(--ink)]">
                        {e.title}
                      </p>
                      {e.note && (
                        <p className="mt-1.5 text-xs text-[var(--muted)]">
                          {e.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
