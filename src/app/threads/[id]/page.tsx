import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { ThreadDesk } from "@/components/ThreadDesk";
import { getThreadDetail } from "@/lib/db";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const thread = getThreadDetail(id);
  if (!thread) notFound();
  const operator = await getSessionOperator();

  return (
    <>
      <Nav active="/threads" operator={operator} />
      <main className="mx-auto max-w-[1400px] px-4 py-8">
        <Link
          href="/threads"
          className="text-xs text-[var(--muted)] hover:underline"
        >
          ← Thread desk
        </Link>
        <div className="mb-6 mt-2">
          <p className="eyebrow">Tracked Conversation</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
            {thread.account.name}
          </h1>
        </div>
        <ThreadDesk thread={thread} />
      </main>
    </>
  );
}
