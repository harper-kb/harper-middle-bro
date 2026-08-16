import { folderLabel, type DeskDocument } from "@/lib/documents";

export function TicketFiles({ documents }: { documents: DeskDocument[] }) {
  const service = documents.filter((d) => d.folder === "service_request");
  const policy = documents.filter(
    (d) => d.folder === "policy" || d.folder === "endorsement",
  );
  const other = documents.filter(
    (d) => d.folder !== "service_request" && d.folder !== "policy" && d.folder !== "endorsement",
  );

  return (
    <div className="space-y-10">
      <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Every file is renamed on ingest to the desk convention. Service-request
        material stays separate from policy paper and endorsements.
      </p>

      <Folder
        title="Service Request"
        hint="Contracts, COI asks, customer uploads"
        docs={service}
      />
      <Folder
        title="Policy & Endorsements"
        hint="Declarations, binders, endorsement pages"
        docs={policy}
      />
      {other.length > 0 && (
        <Folder title="Correspondence" hint="Other filed items" docs={other} />
      )}
    </div>
  );
}

function Folder({
  title,
  hint,
  docs,
}: {
  title: string;
  hint: string;
  docs: DeskDocument[];
}) {
  return (
    <section className="border-t border-[var(--rule)] pt-6">
      <p className="eyebrow">{title}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
      {docs.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Empty</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {docs.map((d) => (
            <li key={d.id} className="py-3.5">
              <p className="text-sm font-medium text-[var(--ink)]">
                {d.canonicalName}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                {folderLabel(d.folder)}
                {d.originalName !== d.canonicalName
                  ? ` · was ${d.originalName}`
                  : ""}
                {d.sizeLabel ? ` · ${d.sizeLabel}` : ""}
                {d.trusted ? " · trusted schedule source" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
