import "server-only";
import { resolve4, resolveMx } from "node:dns/promises";
import {
  addressPasses,
  DISPOSABLE_DOMAINS,
  emailDomain,
  emailPasses,
  emailSyntaxOk,
  formatStandardized,
  normalizeAddressForCompare,
  suggestEmailFix,
  type AddressVerdict,
  type EmailVerdict,
  type StandardizedAddress,
} from "./validate-contact";

/**
 * Server-side contact validation.
 *
 * Address: pluggable adapters. The working default is the US Census Bureau
 * geocoder — free, no key, real USPS-style street-grid matching. Smarty and
 * Google Address Validation adapters activate via env when someone wants
 * paid-grade CASS/DPV verification:
 *   ADDRESS_VALIDATOR=census|smarty|google   (default census)
 *   SMARTY_AUTH_ID / SMARTY_AUTH_TOKEN
 *   GOOGLE_MAPS_API_KEY
 *
 * Email: deterministic layers — RFC syntax, disposable blocklist, typo
 * suggestion, then a real DNS MX lookup (implicit-MX A fallback per RFC
 * 5321). This proves the DOMAIN accepts mail; it is not SMTP mailbox
 * verification and is never labeled as such.
 *
 * Outage policy: a provider/DNS failure is "unavailable", which blocks
 * exactly like a negative verdict. There is no silent pass-through.
 */

const FETCH_TIMEOUT_MS = 8000;

/* ————————————————————————— Address adapters ————————————————————————— */

interface AddressAdapter {
  name: string;
  validate(oneline: string): Promise<AddressVerdict>;
}

function verdictFromStandardized(
  input: string,
  standardized: StandardizedAddress,
  matchedAddress: string,
  provider: string,
): AddressVerdict {
  const same =
    normalizeAddressForCompare(input) ===
    normalizeAddressForCompare(formatStandardized(standardized));
  return same
    ? {
        status: "verified",
        standardized,
        matchedAddress,
        provider,
        reason: "Matched As Entered",
      }
    : {
        status: "corrected",
        standardized,
        matchedAddress,
        provider,
        reason: "Matched — Standardized Variant Available",
      };
}

/** US Census Bureau geocoder — the free, keyless, working default. */
const censusAdapter: AddressAdapter = {
  name: "census",
  async validate(oneline) {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
      `?address=${encodeURIComponent(oneline)}` +
      "&benchmark=Public_AR_Current&format=json";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
    const data = (await res.json()) as {
      result?: {
        addressMatches?: {
          matchedAddress?: string;
          addressComponents?: {
            fromAddress?: string;
            preDirection?: string;
            preQualifier?: string;
            preType?: string;
            streetName?: string;
            suffixType?: string;
            suffixDirection?: string;
            suffixQualifier?: string;
            city?: string;
            state?: string;
            zip?: string;
          };
        }[];
      };
    };
    const match = data.result?.addressMatches?.[0];
    if (!match?.matchedAddress) {
      return {
        status: "unverifiable",
        provider: "census",
        reason: "No Match In The Census Address Ranges",
      };
    }
    const c = match.addressComponents ?? {};
    // matchedAddress reads "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500";
    // the first segment is the standardized street line.
    const line1 =
      match.matchedAddress.split(",")[0]?.trim() ??
      [c.fromAddress, c.preDirection, c.streetName, c.suffixType, c.suffixDirection]
        .filter(Boolean)
        .join(" ");
    return verdictFromStandardized(
      oneline,
      {
        line1,
        city: c.city ?? "",
        state: c.state ?? "",
        zip: c.zip ?? "",
      },
      match.matchedAddress,
      "census",
    );
  },
};

/** Smarty US Street API — activates with SMARTY_AUTH_ID / SMARTY_AUTH_TOKEN. */
const smartyAdapter: AddressAdapter = {
  name: "smarty",
  async validate(oneline) {
    const id = process.env.SMARTY_AUTH_ID;
    const token = process.env.SMARTY_AUTH_TOKEN;
    if (!id || !token) {
      throw new Error("Smarty selected but SMARTY_AUTH_ID / SMARTY_AUTH_TOKEN are not set");
    }
    const url =
      "https://us-street.api.smarty.com/street-address" +
      `?auth-id=${encodeURIComponent(id)}&auth-token=${encodeURIComponent(token)}` +
      `&street=${encodeURIComponent(oneline)}&candidates=1&match=strict`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Smarty HTTP ${res.status}`);
    const rows = (await res.json()) as {
      delivery_line_1?: string;
      last_line?: string;
      components?: { city_name?: string; state_abbreviation?: string; zipcode?: string };
    }[];
    const hit = rows[0];
    if (!hit?.delivery_line_1) {
      return {
        status: "unverifiable",
        provider: "smarty",
        reason: "No USPS Delivery Point Match",
      };
    }
    return verdictFromStandardized(
      oneline,
      {
        line1: hit.delivery_line_1,
        city: hit.components?.city_name ?? "",
        state: hit.components?.state_abbreviation ?? "",
        zip: hit.components?.zipcode ?? "",
      },
      `${hit.delivery_line_1}, ${hit.last_line ?? ""}`.trim(),
      "smarty",
    );
  },
};

/** Google Address Validation API — activates with GOOGLE_MAPS_API_KEY. */
const googleAdapter: AddressAdapter = {
  name: "google",
  async validate(oneline) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      throw new Error("Google selected but GOOGLE_MAPS_API_KEY is not set");
    }
    const res = await fetch(
      `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: { addressLines: [oneline], regionCode: "US" } }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Google Address Validation HTTP ${res.status}`);
    const data = (await res.json()) as {
      result?: {
        verdict?: { addressComplete?: boolean; hasUnconfirmedComponents?: boolean };
        address?: {
          formattedAddress?: string;
          postalAddress?: {
            addressLines?: string[];
            locality?: string;
            administrativeArea?: string;
            postalCode?: string;
          };
        };
      };
    };
    const r = data.result;
    const pa = r?.address?.postalAddress;
    if (!r?.verdict?.addressComplete || r.verdict.hasUnconfirmedComponents || !pa) {
      return {
        status: "unverifiable",
        provider: "google",
        reason: "Google Could Not Confirm Every Component",
      };
    }
    return verdictFromStandardized(
      oneline,
      {
        line1: pa.addressLines?.[0] ?? "",
        city: pa.locality ?? "",
        state: pa.administrativeArea ?? "",
        zip: (pa.postalCode ?? "").split("-")[0],
      },
      r.address?.formattedAddress ?? "",
      "google",
    );
  },
};

const ADAPTERS: Record<string, AddressAdapter> = {
  census: censusAdapter,
  smarty: smartyAdapter,
  google: googleAdapter,
};

function pickAdapter(): AddressAdapter {
  const key = (process.env.ADDRESS_VALIDATOR ?? "census").toLowerCase();
  return ADAPTERS[key] ?? censusAdapter;
}

export async function validateAddress(address: string): Promise<AddressVerdict> {
  const oneline = address.replace(/\s+/g, " ").trim();
  if (!oneline) {
    return {
      status: "unverifiable",
      provider: pickAdapter().name,
      reason: "Empty Address",
    };
  }
  const adapter = pickAdapter();
  try {
    return await adapter.validate(oneline);
  } catch (e) {
    // The service itself failed — that is NOT a verdict. Report it and
    // keep the gate closed until a retry actually answers.
    return {
      status: "unavailable",
      provider: adapter.name,
      reason: `Validation Unavailable — ${e instanceof Error ? e.message : "network error"}`,
    };
  }
}

/* ————————————————————————— Email ————————————————————————— */

/** DNS answers that are real negative verdicts, not outages. */
const DNS_NEGATIVE = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

async function domainAcceptsMail(
  domain: string,
): Promise<"mx" | "a_fallback" | "none" | "unavailable"> {
  try {
    const mx = await resolveMx(domain);
    if (mx.length > 0) return "mx";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (!DNS_NEGATIVE.has(code)) return "unavailable";
    if (code === "ENOTFOUND" || code === "NXDOMAIN") return "none";
    // ENODATA: the domain exists but has no MX — fall through to implicit MX.
  }
  try {
    const a = await resolve4(domain);
    return a.length > 0 ? "a_fallback" : "none";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    return DNS_NEGATIVE.has(code) ? "none" : "unavailable";
  }
}

export async function validateEmail(email: string): Promise<EmailVerdict> {
  const value = email.trim();
  if (!emailSyntaxOk(value)) {
    return { status: "bad_syntax", reason: "Not A Valid Email Format" };
  }
  const domain = emailDomain(value)!;
  const suggestion = suggestEmailFix(value) ?? undefined;

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      status: "disposable",
      suggestion,
      reason: "Disposable Mail Domain — Blocked By Policy",
    };
  }

  const mail = await domainAcceptsMail(domain);
  switch (mail) {
    case "mx":
      return {
        status: "deliverable_domain",
        suggestion,
        reason: "Domain Accepts Mail (MX Found)",
      };
    case "a_fallback":
      return {
        status: "deliverable_domain",
        suggestion,
        reason: "Domain Accepts Mail (Implicit MX — A Record)",
      };
    case "none":
      return {
        status: "no_mx",
        suggestion,
        reason: suggestion
          ? `No Mail Domain — Did You Mean ${suggestion}?`
          : "No Mail Domain — DNS Has No Route For Mail Here",
      };
    case "unavailable":
      return {
        status: "unavailable",
        suggestion,
        reason: "Validation Unavailable — DNS Did Not Answer",
      };
  }
}

/* ————————————————————————— Server-action gates ————————————————————————— */

/**
 * Hard stop for server actions. Negative verdict AND service outage both
 * throw — the write never happens on unverified data.
 */
export async function assertDeliverableEmail(
  email: string,
  label: string,
): Promise<void> {
  const v = await validateEmail(email);
  if (emailPasses(v)) return;
  if (v.status === "unavailable") {
    throw new Error(
      `${label}: ${v.reason}. Unverified — blocked until validation can run. Retry.`,
    );
  }
  throw new Error(`${label}: ${v.reason}`);
}

export async function assertVerifiedAddress(
  address: string,
  label: string,
): Promise<void> {
  const v = await validateAddress(address);
  if (addressPasses(v)) return;
  if (v.status === "unavailable") {
    throw new Error(
      `${label}: ${v.reason}. Unverified — blocked until validation can run. Retry.`,
    );
  }
  throw new Error(`${label}: ${v.reason} — fix the address before continuing.`);
}
