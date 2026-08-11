import { redirect } from "next/navigation";

/** AI Desk merged into the unified Desk. */
export default function AiDeskRedirect() {
  redirect("/desk");
}
