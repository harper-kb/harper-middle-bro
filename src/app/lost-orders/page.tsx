import { AccountOrdersPage } from "../all-accounts/AccountOrdersPage";

export const dynamic = "force-dynamic";

export default function LostOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <AccountOrdersPage mode="lost" searchParams={searchParams} />;
}
