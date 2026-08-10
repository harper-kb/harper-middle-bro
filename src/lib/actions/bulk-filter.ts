export type BulkRecipient = {
  accountId: string;
  workItemId: string | null;
  to: string;
  excluded?: boolean;
  excludeReason?: string;
};

export function filterBulkRecipients(recipients: BulkRecipient[]): {
  included: BulkRecipient[];
  excluded: BulkRecipient[];
} {
  const included = recipients.filter((r) => !r.excluded && r.to.includes("@"));
  const excluded = recipients.filter((r) => r.excluded || !r.to.includes("@"));
  return { included, excluded };
}
