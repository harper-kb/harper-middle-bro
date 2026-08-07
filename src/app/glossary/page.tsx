import { Nav } from "@/components/Nav";
import { GLOSSARY } from "@/lib/glossary";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Glossary",
};

/**
 * The desk's definitions of record. Every abbreviation used anywhere on the
 * platform is spelled out and defined here, in plain English, for teammates
 * who did not grow up in insurance.
 */
export default async function GlossaryPage() {
  const operator = await getSessionOperator();
  const termCount = GLOSSARY.reduce((n, s) => n + s.terms.length, 0);

  return (
    <>
      <Nav active="/glossary" operator={operator} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8">
          <p className="eyebrow">Reference</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--ink)]">
            Glossary
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Every term and abbreviation the desk uses, defined in plain
            English. {termCount} terms across {GLOSSARY.length} sections.
          </p>
        </header>

        <div className="space-y-4">
          {GLOSSARY.map((section, idx) => (
            <details
              key={section.id}
              id={section.id}
              className="disclosure rounded-2xl bg-white ring-1 ring-[var(--rule)]"
              open={idx === 0}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4">
                <span className="font-display text-lg font-semibold text-[var(--ink)]">
                  {section.title}
                </span>
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  {section.terms.length} Terms
                </span>
              </summary>
              <dl className="divide-y divide-[var(--rule)] border-t border-[var(--rule)]">
                {section.terms.map((t) => (
                  <div key={t.term} className="px-5 py-4">
                    <dt className="text-sm font-semibold text-[var(--ink)]">
                      {t.term}
                      {t.abbreviation && (
                        <span className="ml-1.5 font-normal text-[var(--muted)]">
                          ({t.abbreviation})
                        </span>
                      )}
                    </dt>
                    <dd className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                      {t.definition}
                      {t.onTheDesk && (
                        <span className="mt-1.5 block text-[13px] text-[var(--ink)]/70">
                          On the desk: {t.onTheDesk}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>

        <p className="mt-8 text-xs text-[var(--muted)]">
          House rule: no abbreviation appears anywhere on the platform before
          it has been spelled out. If a term is missing here, it should not be
          abbreviated in the interface.
        </p>
      </main>
    </>
  );
}
