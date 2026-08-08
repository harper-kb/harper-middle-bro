import { NextResponse } from "next/server";
import {
  getCachedAddressVerification,
  saveAddressVerification,
} from "@/lib/db";
import {
  normalizeAddressForCompare,
  type AddressVerdict,
  type StandardizedAddress,
} from "@/lib/validate-contact";
import {
  insuredAddressAdapterName,
  validateInsuredAddress,
} from "@/lib/validate-contact.server";

export const dynamic = "force-dynamic";

/**
 * INSURED-box address verification, cached. Provider preference is explicit:
 * Google Address Validation when GOOGLE_MAPS_API_KEY is set, the US Census
 * Bureau geocoder otherwise — the returned verdict's `provider` names which
 * one actually answered. Real verdicts (verified / corrected / unverifiable)
 * are cached in SQLite per (normalized address, provider), so reopening a
 * certificate does not re-hit the API; outages are never cached.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { address?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address : "";
  if (!address.trim()) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const provider = insuredAddressAdapterName();
  const key = `${provider}|${normalizeAddressForCompare(address)}`;

  const cached = getCachedAddressVerification(key);
  if (cached) {
    const verdict: AddressVerdict = {
      status: cached.status as AddressVerdict["status"],
      provider: cached.provider,
      reason: cached.reason,
      matchedAddress: cached.matchedAddress ?? undefined,
      standardized: cached.standardizedJson
        ? (JSON.parse(cached.standardizedJson) as StandardizedAddress)
        : undefined,
    };
    return NextResponse.json(verdict);
  }

  const verdict = await validateInsuredAddress(address);
  if (verdict.status !== "unavailable") {
    saveAddressVerification(key, {
      provider: verdict.provider,
      status: verdict.status,
      reason: verdict.reason,
      matchedAddress: verdict.matchedAddress ?? null,
      standardizedJson: verdict.standardized
        ? JSON.stringify(verdict.standardized)
        : null,
    });
  }
  return NextResponse.json(verdict);
}
