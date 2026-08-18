import { AccountOrdersPage } from "./AccountOrdersPage";
import type { RecordsSearchParams } from "./records-filter-state";

export const dynamic = "force-dynamic";

export default async function AllAccountsPage({
  searchParams,
}: {
  searchParams: Promise<RecordsSearchParams>;
}) {
  return <AccountOrdersPage mode="all" searchParams={searchParams} />;
}
