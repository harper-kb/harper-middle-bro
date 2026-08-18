import { redirect } from "next/navigation";
import {
  parseRecordsFilterState,
  recordsFilterHref,
  type RecordsSearchParams,
} from "@/app/all-accounts/records-filter-state";

/**
 * The old Accounts list merged into All Accounts (the full live book with
 * search + pagination). Account detail pages stay at /accounts/[id].
 */
export default async function AccountsRedirect({
  searchParams,
}: {
  searchParams: Promise<RecordsSearchParams>;
}) {
  // Old bookmarks and desk links may still carry list filters. Treat this as
  // an All Accounts alias, not a reason to throw the query string away.
  redirect(
    recordsFilterHref(
      parseRecordsFilterState("all", await searchParams),
    ),
  );
}
