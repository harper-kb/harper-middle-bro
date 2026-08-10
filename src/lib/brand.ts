/** Every market-facing message leaves from one mailbox, so nothing lands in a personal inbox. */
export const SERVICE_MAILBOX = "service@harperinsure.com";
export const SERVICE_NAME = "Harper Service";
/**
 * UI-facing product name (wordmark, page titles). Distinct from the legal
 * PRODUCER / COMPANY_NAME identity below — certificates never use this.
 */
export const PRODUCT_NAME = "Step Bro";
/** The non-"Harper" half of the wordmark, for compact surfaces. */
export const SHORT_NAME = "Step Bro";
/** How the agency signs itself on outbound mail. */
export const COMPANY_NAME = "Harper Insurance Services";

/**
 * The one representative name used everywhere — the producer contact line
 * AND the stamped Authorized Representative signature. Production forms
 * spell it "Dakotah"; change this single word to fix every surface at once.
 */
export const AUTHORIZED_REPRESENTATIVE = "Dakotah Rice";

/**
 * PRODUCER block for every certificate — the licensed entity of record as it
 * appears on production ACORD 25s. One constant, so a cert issued from any
 * account carries the same producer identity.
 */
export const PRODUCER = {
  name: "Harper Global Enterprises Inc dba Harper Global Insurance Agency",
  addressLine1: "425 Market Street",
  addressLine2: "Suite 1300",
  city: "San Francisco",
  state: "CA",
  zip: "94105",
  contactName: AUTHORIZED_REPRESENTATIVE,
  /** Phone (A/C, No, Ext) as printed on the form */
  phone: "470-839-4314",
  fax: "",
  email: SERVICE_MAILBOX,
} as const;
