export type BulkRecipient = {
  accountId: string;
  workItemId: string | null;
  to: string;
  excluded?: boolean;
  excludeReason?: string;
};

export type BulkChannel = "email" | "text";

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && !value.includes("@");
}

export function filterBulkRecipients(
  recipients: BulkRecipient[],
  channel: BulkChannel = "email",
): {
  included: BulkRecipient[];
  excluded: BulkRecipient[];
} {
  const eligible = (r: BulkRecipient) =>
    channel === "email" ? looksLikeEmail(r.to) : looksLikePhone(r.to);
  const included = recipients.filter((r) => !r.excluded && eligible(r));
  const excluded = recipients.filter((r) => r.excluded || !eligible(r));
  return { included, excluded };
}
