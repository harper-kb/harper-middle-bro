import { AccountOrdersPage } from "../all-accounts/AccountOrdersPage";

export const dynamic = "force-dynamic";

export default function BoundOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <AccountOrdersPage mode="bound" searchParams={searchParams} />;
}
