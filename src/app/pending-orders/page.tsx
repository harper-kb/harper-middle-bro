import { AccountOrdersPage } from "../all-accounts/AccountOrdersPage";

export const dynamic = "force-dynamic";

export default function PendingOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <AccountOrdersPage mode="pending" searchParams={searchParams} />;
}
