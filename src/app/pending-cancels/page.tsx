import { renderSectionPage } from "@/lib/sections/render-section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return renderSectionPage("pending_cancels");
}
