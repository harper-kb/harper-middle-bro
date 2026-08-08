/**
 * Carrier service inbox types — client-safe.
 *
 * Service inboxes are the functional carrier mailboxes (support, payments,
 * submissions, certificates desks) that the named-contact export deliberately
 * filters out via isUselessMailbox(). They are a separate concept from named
 * underwriters and are never mixed into the named-contact lists.
 *
 * The inbox records themselves are private business data and live in
 * `data/carrier-inboxes.local.json`, which is gitignored and loaded
 * server-side only (see carrier-inboxes.server.ts). The committed
 * `carrier-inboxes.data.json` ships empty in the public repository —
 * an empty section is preferred over publishing real mailboxes.
 */

export interface CarrierServiceInbox {
  /** Source row id in the desk's contact export */
  sourceId: number;
  email: string;
  /** Desk carrier label (matches CARRIER_INTEL names where the carrier has a desk) */
  carrier: string;
  /** Human-readable purpose derived from the mailbox name, e.g. "Payments" */
  purpose: string;
  notes: string | null;
}

export const CARRIER_INBOXES_SOURCE =
  "Desk contact export (functional mailboxes)" as const;
