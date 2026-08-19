import { ServiceSpinePage } from "./ServiceSpinePage";
import type { SpineSearchParams } from "./spine-filter-state";

export const dynamic = "force-dynamic";

export default async function ServiceSpineRoute({
  searchParams,
}: {
  searchParams: Promise<SpineSearchParams>;
}) {
  return <ServiceSpinePage searchParams={searchParams} />;
}
