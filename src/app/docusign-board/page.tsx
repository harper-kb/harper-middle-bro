import { Nav } from "@/components/Nav";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DocuSignBoardPage() {
  const operator = await getSessionOperator();

  return (
    <div>
      <Nav active="/docusign-board" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Service</p>
          <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">
            DocuSign Board
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Placeholder — this board will land in a later pass.
          </p>
        </div>
      </main>
    </div>
  );
}
