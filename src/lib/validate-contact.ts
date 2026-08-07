/**
 * Contact validation contract — shared between the client chips and the
 * server-side validators. Client-safe: no node imports here.
 *
 * The rule of the house: a verdict is only ever what the check actually
 * proved. "deliverable_domain" means the domain accepts mail (MX / implicit
 * MX), NOT that the mailbox exists — the UI labels it "Domain Accepts Mail"
 * for exactly that reason. If the check itself cannot run, the status is
 * "unavailable" and every gate stays closed. No silent pass-through, ever.
 */

/* ————————————————————————— Address ————————————————————————— */

export type AddressStatus =
  /** Provider matched the address as entered */
  | "verified"
  /** Provider matched, but returned a standardized variant — offer it */
  | "corrected"
  /** Provider answered and found no match — a negative verdict */
  | "unverifiable"
  /** The validation service itself could not be reached — still blocks */
  | "unavailable";

export interface StandardizedAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

export interface AddressVerdict {
  status: AddressStatus;
  standardized?: StandardizedAddress;
  /** Raw matched address string straight from the provider */
  matchedAddress?: string;
  provider: string;
  reason: string;
}

/** The only two verdicts that open an address gate. */
export function addressPasses(v: AddressVerdict | null): boolean {
  return v?.status === "verified" || v?.status === "corrected";
}

export function formatStandardized(s: StandardizedAddress): string {
  return `${s.line1}, ${s.city}, ${s.state} ${s.zip}`;
}

/** Loose normalization so "Ave." ≡ "AVE" doesn't read as a correction. */
export function normalizeAddressForCompare(a: string): string {
  return a
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ————————————————————————— Email ————————————————————————— */

export type EmailStatus =
  /** Domain resolves and accepts mail (MX, or implicit-MX A fallback) */
  | "deliverable_domain"
  /** Domain does not exist or publishes no way to receive mail */
  | "no_mx"
  /** Not a plausible RFC-style address at all */
  | "bad_syntax"
  /** Known disposable-mail domain — blocked by policy */
  | "disposable"
  /** DNS itself failed (timeout / servfail) — still blocks */
  | "unavailable";

export interface EmailVerdict {
  status: EmailStatus;
  /** Full corrected address when the domain looks like a common typo */
  suggestion?: string;
  reason: string;
}

export function emailPasses(v: EmailVerdict | null): boolean {
  return v?.status === "deliverable_domain";
}

/** Pragmatic RFC 5322 subset — one @, sane local part, dotted domain. */
export function emailSyntaxOk(email: string): boolean {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
    email.trim(),
  );
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

/** Small embedded blocklist — throwaway inboxes have no place on a policy. */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "10minutemail.com",
  "yopmail.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.dev",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
  "mohmal.com",
  "throwawaymail.com",
  "fakeinbox.com",
  "spamgourmet.com",
  "mytemp.email",
  "burnermail.io",
]);

/**
 * Fat-finger variants of the domains people actually type all day.
 * A hit here is a SUGGESTION — never an auto-change.
 */
export const DOMAIN_TYPO_MAP: Readonly<Record<string, string>> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmali.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.con": "gmail.com",
  "googlemail.co": "googlemail.com",
  "hotmial.com": "hotmail.com",
  "hotmali.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outllook.com": "outlook.com",
  "outlook.co": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "iclould.com": "icloud.com",
  "icoud.com": "icloud.com",
  "icloud.co": "icloud.com",
  "aoll.com": "aol.com",
  "comcastt.net": "comcast.net",
};

/** Full corrected address when the domain is a known typo, else null. */
export function suggestEmailFix(email: string): string | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  const fix = DOMAIN_TYPO_MAP[domain];
  if (!fix) return null;
  return `${email.slice(0, email.lastIndexOf("@"))}@${fix}`;
}
