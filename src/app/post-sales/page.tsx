import { LaneModeBanner } from "@/components/LaneModeBanner";
import { Nav } from "@/components/Nav";
import { loadLaneSnapshot } from "@/lib/adapters/bigbrother/lane-registry";
import { POST_SALES_LABELS, classifyPostSales } from "@/lib/lanes/post-sales";
import { sortWorkItems } from "@/lib/priority";
import { SectionLanePage } from "@/lib/sections/section-shell";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PostSalesPage() {
  const operator = await getSessionOperator();
  const snapshot = await loadLaneSnapshot("post_sales");
  const items = sortWorkItems(snapshot.items).map((item) => {
    const kind = classifyPostSales(item);
    return {
      ...item,
      title: `${POST_SALES_LABELS[kind]} — ${item.title}`,
      summary: `${item.summary} · revenue-changing only`,
    };
  });

  return (
    <div>
      <Nav active="/post-sales" operator={operator} />
      <main className="px-4 py-6 lg:px-8">
        <div className="mb-4">
          <p className="eyebrow">Section</p>
          <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">Post Sales</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Revenue-changing work only — upsells, added coverage, premium
            endorsements, remarkets, and related handoffs.
          </p>
        </div>
        <LaneModeBanner mode={snapshot.mode} reason={snapshot.modeReason} count={items.length} sourceCount={snapshot.sourceCount} />
        <SectionLanePage lane="post_sales" mode={snapshot.mode} modeReason={snapshot.modeReason} items={items} />
      </main>
    </div>
  );
}
