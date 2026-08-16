import { getDb } from "../connection";

// ————————————————— Address Verification Cache —————————————————

/**
 * Cached verdict for one (normalized address, provider) pair. Repeat
 * certificate opens read this instead of re-hitting the geocoder. The
 * provider is part of the key so a Census verdict is never re-labeled as
 * Google when a GOOGLE_MAPS_API_KEY appears later.
 */
export interface CachedAddressVerification {
  provider: string;
  status: string;
  reason: string;
  matchedAddress: string | null;
  standardizedJson: string | null;
  checkedAt: string;
}

export function getCachedAddressVerification(
  addressKey: string,
): CachedAddressVerification | null {
  const row = getDb()
    .prepare(`SELECT * FROM address_verifications WHERE address_key = ?`)
    .get(addressKey) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    provider: row.provider as string,
    status: row.status as string,
    reason: row.reason as string,
    matchedAddress: (row.matched_address as string | null) ?? null,
    standardizedJson: (row.standardized_json as string | null) ?? null,
    checkedAt: row.checked_at as string,
  };
}

export function saveAddressVerification(
  addressKey: string,
  v: Omit<CachedAddressVerification, "checkedAt">,
): void {
  getDb()
    .prepare(
      `INSERT INTO address_verifications
         (address_key, provider, status, reason, matched_address, standardized_json, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address_key) DO UPDATE SET
         provider = excluded.provider,
         status = excluded.status,
         reason = excluded.reason,
         matched_address = excluded.matched_address,
         standardized_json = excluded.standardized_json,
         checked_at = excluded.checked_at`,
    )
    .run(
      addressKey,
      v.provider,
      v.status,
      v.reason,
      v.matchedAddress,
      v.standardizedJson,
      new Date().toISOString(),
    );
}
