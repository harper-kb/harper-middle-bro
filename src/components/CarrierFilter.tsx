"use client";

import { useRouter } from "next/navigation";

/** Carrier dropdown for the accounts list — keeps the status filter intact. */
export function CarrierFilter({
  carriers,
  carrier,
  status,
}: {
  carriers: string[];
  carrier: string;
  status: string;
}) {
  const router = useRouter();

  function href(nextCarrier: string): string {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (nextCarrier !== "all") params.set("carrier", nextCarrier);
    const qs = params.toString();
    return qs ? `/accounts?${qs}` : "/accounts";
  }

  return (
    <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
      <span className="font-semibold uppercase tracking-[0.1em] text-[10px]">
        Carrier
      </span>
      <select
        value={carrier}
        onChange={(e) => router.push(href(e.target.value))}
        className="field w-auto max-w-[16rem] px-3 py-1.5 text-xs"
      >
        <option value="all">All Carriers</option>
        {carriers.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
