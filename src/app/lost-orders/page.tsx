import { AccountOrdersPage } from "../all-accounts/AccountOrdersPage";
import type { RecordsSearchParams } from "../all-accounts/records-filter-state";

export const dynamic = "force-dynamic";

export default function LostOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RecordsSearchParams>;
}) {
  return <AccountOrdersPage mode="lost" searchParams={searchParams} />;
}
