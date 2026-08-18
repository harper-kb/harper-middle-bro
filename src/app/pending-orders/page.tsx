import { AccountOrdersPage } from "../all-accounts/AccountOrdersPage";
import type { RecordsSearchParams } from "../all-accounts/records-filter-state";

export const dynamic = "force-dynamic";

export default function PendingOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RecordsSearchParams>;
}) {
  return <AccountOrdersPage mode="pending" searchParams={searchParams} />;
}
