import { COMPANY_NAME } from "./brand";

export interface SignatureFields {
  displayName: string;
  title: string;
  email: string;
  phone: string | null;
}

/**
 * The house signature block.
 *
 * One builder for the seed, the profile form, and every draft — so a seat
 * that changes hands never signs mail under the last person's name.
 */
export function buildSignature(o: SignatureFields): string {
  return [
    "Best regards,",
    o.displayName.trim(),
    o.title.trim(),
    COMPANY_NAME,
    o.email.trim(),
    o.phone?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * True when a signature came out of the builder rather than someone's hands.
 *
 * Matching the current fields is the easy case. The one that matters is a
 * block generated for *older* values — a renamed seat still signing as the
 * last person. That's stale, not authored, so it should be rebuilt rather
 * than protected.
 */
export function isGeneratedSignature(
  signature: string,
  fields: SignatureFields,
): boolean {
  const text = signature.trim();
  if (text === buildSignature(fields)) return true;

  const lines = text.split("\n").map((l) => l.trim());
  return (
    lines.length >= 4 &&
    lines.length <= 6 &&
    lines[0] === "Best regards," &&
    lines.includes(COMPANY_NAME) &&
    lines.some((l) => l.includes("@"))
  );
}
