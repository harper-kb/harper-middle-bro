import { AccountOrdersPage } from "./AccountOrdersPage";

export const dynamic = "force-dynamic";

export default async function AllAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <AccountOrdersPage mode="all" searchParams={searchParams} />;
}
