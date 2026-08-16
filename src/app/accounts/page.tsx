import { redirect } from "next/navigation";

/**
 * The old Accounts list merged into All Accounts (the full live book with
 * search + pagination). Account detail pages stay at /accounts/[id].
 */
export default function AccountsRedirect() {
  redirect("/all-accounts");
}
