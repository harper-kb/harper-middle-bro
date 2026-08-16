/**
 * Producer identity used to prefill newly generated certificates.
 *
 * These are defaults, not locks: a saved operator value (including an empty
 * string) is authoritative in the editor and in the rendered PDF.
 */
export const COI_PRODUCER_DEFAULTS: Readonly<Record<string, string>> = {
  producerName: "Harper Global Enterprises Inc dba Harper Global Insurance Agency",
  producerContactName: "Dakotah Rice",
  producerPhone: "470-839-4314",
  producerEmail: "service@harperinsure.com",
  "producerAddress.street1": "425 Market Street",
  "producerAddress.street2": "Suite 1300",
  "producerAddress.city": "San Francisco",
  "producerAddress.state": "CA",
  "producerAddress.zip": "94105",
};

export function withCoiProducerDefaults(
  values: Record<string, string>,
): Record<string, string> {
  return { ...COI_PRODUCER_DEFAULTS, ...values };
}
