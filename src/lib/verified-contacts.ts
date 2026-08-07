/**
 * Verified underwriter contact types and mailbox rules — client-safe.
 *
 * The named-contact records themselves are private business data and live
 * in `data/verified-contacts.local.json`, which is gitignored and loaded
 * server-side only (see verified-contacts.server.ts). The committed
 * `verified-contacts.data.json` ships empty in the public repository —
 * an empty contact list is preferred over publishing real people.
 */

export interface VerifiedContact {
  /** Source row id in the desk's contact export */
  sourceId: number;
  name: string;
  email: string;
  /** Desk carrier label (normalized to CARRIER_INTEL names) */
  carrier: string;
  /** Specialty / desk note from source name, if any */
  notes: string | null;
}

export const VERIFIED_CONTACTS_SOURCE =
  "Desk contact export (active, filtered)" as const;

/** Mailboxes we never treat as named underwriter contacts. */
export function isUselessMailbox(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return true;
  if (e.endsWith(".example")) return true;
  return (
    /^(noreply|no-reply|donotreply|do-not-reply|no_reply|marketing|info|support|hello|team|contact|notifications|various|payments|producers|programs|processing|wholesale|wholesalewc|transportation)@/i.test(
      e,
    ) || /@(noreply|no-reply)\./i.test(e)
  );
}
