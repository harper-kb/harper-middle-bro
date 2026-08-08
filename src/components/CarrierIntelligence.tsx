import {
  groupKnowledgeEntries,
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_SEVERITY_LABELS,
  type CarrierKnowledgeEntry,
  type KnowledgeSeverity,
} from "@/lib/carrier-knowledge";

/**
 * Carrier Intelligence — the institutional-knowledge region of a carrier
 * desk page. Committed registry entries and operator-added entries render
 * as one set of cards, grouped by scope. Enforceable entries say so: the
 * same entry that renders here is what blocks the request or the
 * certificate, by id.
 */

const SEVERITY_CHIP: Record<KnowledgeSeverity, string> = {
  blocker: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  note: "border-slate-200 bg-slate-50 text-slate-700",
};

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center border border-[var(--rule)] bg-[var(--paper)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
      {label}
    </span>
  );
}

function KnowledgeCard({
  entry,
  accent,
}: {
  entry: CarrierKnowledgeEntry;
  accent: string;
}) {
  return (
    <article
      className="border border-[var(--rule)] bg-[var(--paper)] p-5"
      style={
        entry.severity === "blocker"
          ? { borderLeft: `3px solid ${accent}` }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${SEVERITY_CHIP[entry.severity]}`}
        >
          {KNOWLEDGE_SEVERITY_LABELS[entry.severity]}
        </span>
        <ScopeChip label={KNOWLEDGE_KIND_LABELS[entry.kind]} />
        {entry.coverageLine && <ScopeChip label={entry.coverageLine} />}
        {entry.industryVertical && <ScopeChip label={entry.industryVertical} />}
        {entry.state && <ScopeChip label={entry.state} />}
        {entry.enforceable && (
          <span className="inline-flex items-center border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-rose-900">
            Enforced In Code
          </span>
        )}
      </div>
      <h4 className="mt-3 font-display text-lg leading-snug text-[var(--ink)]">
        {entry.title}
      </h4>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
        {entry.detail}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        <span className="font-semibold text-[var(--ink)]">If Ignored: </span>
        {entry.consequence}
      </p>
      <p className="mt-3 font-mono text-[11px] text-[var(--muted)]">
        {entry.source} · Recorded {entry.recordedAt} · {entry.id}
      </p>
    </article>
  );
}

export function CarrierIntelligence({
  carrierName,
  entries,
  accent,
  addAction,
}: {
  carrierName: string;
  entries: CarrierKnowledgeEntry[];
  accent: string;
  /** Server action that files an operator entry — passed in by the page so
      this component stays pure (renderable in harness scripts). */
  addAction?: (formData: FormData) => Promise<void>;
}) {
  const groups = groupKnowledgeEntries(entries);
  const enforcedCount = entries.filter((e) => e.enforceable).length;

  return (
    <section className="mt-14 border-t border-[var(--rule)] pt-8">
      <p className="eyebrow" style={{ color: accent }}>
        Carrier Intelligence
      </p>
      <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
        What The Desk Knows About {carrierName}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Institutional knowledge recorded once, per carrier, writing company,
        coverage line, industry vertical, and state — so no nuance has to be
        re-learned by rework.{" "}
        {enforcedCount > 0
          ? `${enforcedCount} ${enforcedCount === 1 ? "entry is" : "entries are"} enforced in code: a matching request or certificate blocks with the entry cited as the reason.`
          : "No entries on this carrier are enforced in code yet."}
      </p>

      {groups.map((group) => (
        <div key={group.id} className="mt-10">
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-xl text-[var(--ink)]">
              {group.title}
            </h3>
            {group.entries.length > 0 && (
              <span className="font-mono text-xs text-[var(--muted)]">
                {group.entries.length}
              </span>
            )}
          </div>
          {group.entries.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {group.entries.map((entry) => (
                <KnowledgeCard key={entry.id} entry={entry} accent={accent} />
              ))}
            </div>
          ) : (
            <p className="mt-3 border border-dashed border-[var(--rule)] px-4 py-5 text-sm text-[var(--muted)]">
              No Verified Notes Yet — Add What The Desk Learns
            </p>
          )}
        </div>
      ))}

      <AddKnowledgeEntryForm carrierName={carrierName} addAction={addAction} />
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const INPUT_CLASS =
  "w-full border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)]";

function AddKnowledgeEntryForm({
  carrierName,
  addAction,
}: {
  carrierName: string;
  addAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <details className="disclosure desk-section mt-10">
      <summary className="flex flex-wrap items-center gap-2.5 px-4 py-3">
        <span
          className="disclosure-caret text-xs text-[var(--muted)]"
          aria-hidden
        >
          ›
        </span>
        <span className="text-sm font-semibold text-[var(--ink)]">
          Add A Knowledge Entry
        </span>
        <span className="chip">Operator</span>
      </summary>
      <div className="border-t border-[var(--rule)] px-4 py-4">
        <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          Entries added here render as cards immediately and can warn the desk.
          They never silently auto-enforce: a hard block requires moving the
          fact into the committed registry through code review — by design, so
          every enforcement rule is reviewed before it can stop work.
        </p>
        <form action={addAction} className="mt-4 max-w-2xl">
          <input type="hidden" name="carrier" value={carrierName} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind">
              <select name="kind" className={INPUT_CLASS} defaultValue="practice_note">
                <option value="restriction">Restriction</option>
                <option value="state_law">State Law</option>
                <option value="past_issue">Past Issue</option>
                <option value="practice_note">Practice Note</option>
              </select>
            </Field>
            <Field label="Severity">
              <select name="severity" className={INPUT_CLASS} defaultValue="note">
                <option value="note">Note</option>
                <option value="warning">Warning</option>
              </select>
            </Field>
            <Field label="Coverage Line (Optional)">
              <input
                name="coverageLine"
                className={INPUT_CLASS}
                placeholder="e.g. Excess Liability"
              />
            </Field>
            <Field label="Industry Vertical (Optional)">
              <input
                name="industryVertical"
                className={INPUT_CLASS}
                placeholder="e.g. Contractors — Lease"
              />
            </Field>
            <Field label="State (Optional, Two-Letter)">
              <input
                name="state"
                className={INPUT_CLASS}
                placeholder="e.g. CO"
                maxLength={2}
              />
            </Field>
            <Field label="Writing Company (Optional)">
              <input
                name="writingCompany"
                className={INPUT_CLASS}
                placeholder="e.g. Sutton National Insurance Company"
              />
            </Field>
          </div>
          <div className="mt-4 space-y-4">
            <Field label="Title (Title Case)">
              <input
                name="title"
                className={INPUT_CLASS}
                placeholder="What The Desk Learned"
                required
              />
            </Field>
            <Field label="Detail (Precise Prose — State Only What Was Verified)">
              <textarea
                name="detail"
                className={INPUT_CLASS}
                rows={3}
                required
              />
            </Field>
            <Field label="Consequence (What Goes Wrong If Ignored)">
              <textarea name="consequence" className={INPUT_CLASS} rows={2} />
            </Field>
            <Field label="Source">
              <select name="source" className={INPUT_CLASS} defaultValue="Desk Experience">
                <option value="Desk Experience">Desk Experience</option>
                <option value="Carrier Documentation">
                  Carrier Documentation
                </option>
                <option value="State Regulation">State Regulation</option>
              </select>
            </Field>
          </div>
          <button
            type="submit"
            className="mt-5 border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--paper)] hover:opacity-90"
          >
            Record Knowledge Entry
          </button>
        </form>
      </div>
    </details>
  );
}
