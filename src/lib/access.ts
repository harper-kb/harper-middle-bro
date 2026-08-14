/**
 * Who is allowed on the desk.
 *
 * The hosted desk is invitation-only. Two independent gates enforce that, and
 * both must be in place:
 *
 *   1. Clerk refuses to create accounts outside the allowlist
 *      (`scripts/clerk-lockdown.ts`).
 *   2. This module refuses to hand out an operator to an email outside the
 *      allowlist, so an account that predates the lockdown still cannot reach
 *      the book.
 *
 * Gate 1 alone is a dashboard setting someone can toggle back. Gate 2 travels
 * with the code.
 *
 * Configuration (either or both):
 *   DESK_ALLOWED_DOMAINS=harperinsure.com,harper.com
 *   DESK_ALLOWED_EMAILS=someone@gmail.com,contractor@example.com
 *
 * With neither set the desk is unrestricted, which is what local development
 * wants. Setting either one switches the whole desk to deny-by-default and
 * closes public sign-up — there is deliberately no way to configure an
 * allowlist and leave registration open.
 */

export interface Allowlist {
  domains: string[];
  emails: string[];
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Leading "@" is accepted on domains so `--allow @harperinsure.com` pastes cleanly. */
function normalizeDomain(entry: string): string {
  return entry.replace(/^@+/, "");
}

export function parseAllowlist(env: {
  DESK_ALLOWED_DOMAINS?: string;
  DESK_ALLOWED_EMAILS?: string;
}): Allowlist {
  return {
    domains: splitList(env.DESK_ALLOWED_DOMAINS).map(normalizeDomain).filter(Boolean),
    emails: splitList(env.DESK_ALLOWED_EMAILS),
  };
}

/** An allowlist with nothing in it does not restrict anything. */
export function isAllowlistConfigured(list: Allowlist): boolean {
  return list.domains.length > 0 || list.emails.length > 0;
}

export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Deny-by-default once an allowlist exists.
 *
 * Domain matching compares the whole domain, never a suffix: `harperinsure.com`
 * must not admit `notharperinsure.com`. Subdomains are not implied either —
 * list `mail.harperinsure.com` if you mean it.
 */
export function isEmailAllowed(email: string, list: Allowlist): boolean {
  if (!isAllowlistConfigured(list)) return true;

  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const domain = emailDomainOf(normalized);
  if (!domain) return false;

  if (list.emails.includes(normalized)) return true;
  return list.domains.includes(domain);
}

/** Reads process.env. Server-side callers only. */
export function deskAllowlist(): Allowlist {
  return parseAllowlist({
    DESK_ALLOWED_DOMAINS: process.env.DESK_ALLOWED_DOMAINS,
    DESK_ALLOWED_EMAILS: process.env.DESK_ALLOWED_EMAILS,
  });
}

/**
 * True when the desk is running invitation-only. Public sign-up is closed
 * exactly when this is true — the two are the same switch on purpose.
 */
export function isDeskRestricted(): boolean {
  return isAllowlistConfigured(deskAllowlist());
}
