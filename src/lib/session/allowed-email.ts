/**
 * The only email domain allowed to access the desk. Enforced in the proxy
 * (every request) and again when linking a Clerk user to an operator.
 *
 * Kept dependency-free so the proxy can import it without dragging in the DB.
 */
export const ALLOWED_EMAIL_DOMAIN = "harperinsure.com";

export function isAllowedOperatorEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return email.slice(at + 1).trim().toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}
