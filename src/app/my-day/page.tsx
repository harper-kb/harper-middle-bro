import { redirect } from "next/navigation";

/** My Day merged into the unified Desk. */
export default function MyDayRedirect() {
  redirect("/desk");
}
