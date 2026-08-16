import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ACORD25_TEMPLATE_B64 } from "@/lib/coi-engine/acord25-template";
import acord25Schema from "@/lib/coi-engine/acord25-schema.json";
import { COI_PRODUCER_DEFAULTS } from "@/lib/coi-engine/coi-producer";
import {
  fillCoiPdfFormWithReport,
  normalizeCoiFieldValues,
  type CoiPdfFormSchema,
} from "@/lib/coi-engine/coi-pdf";

describe("COI producer defaults", () => {
  it("prefill producer fields when a certificate does not carry them", () => {
    const normalized = normalizeCoiFieldValues({ insuredName: "Synthetic Insured LLC" });

    expect(normalized).toMatchObject(COI_PRODUCER_DEFAULTS);
  });

  it("preserve operator overrides, including a deliberately blank value", () => {
    const normalized = normalizeCoiFieldValues({
      producerName: "Operator Edited Producer LLC",
      producerContactName: "Synthetic Contact",
      "producerAddress.street1": "44 Synthetic Harbor Way",
      "producerAddress.street2": "",
    });

    expect(normalized.producerName).toBe("Operator Edited Producer LLC");
    expect(normalized.producerContactName).toBe("Synthetic Contact");
    expect(normalized["producerAddress.street1"]).toBe("44 Synthetic Harbor Way");
    expect(normalized["producerAddress.street2"]).toBe("");
  });

  it("writes operator overrides at the raw PDF fill boundary", async () => {
    const schema = acord25Schema as unknown as CoiPdfFormSchema;
    const template = Uint8Array.from(Buffer.from(ACORD25_TEMPLATE_B64, "base64"));
    const overrides = Object.fromEntries(
      Object.keys(COI_PRODUCER_DEFAULTS).map((fieldId) => [fieldId, `Edited ${fieldId}`]),
    );
    const result = await fillCoiPdfFormWithReport(
      template,
      overrides,
      schema,
      { flatten: false },
    );
    const form = (await PDFDocument.load(result.pdfBytes)).getForm();

    for (const [fieldId, expected] of Object.entries(overrides)) {
      const fieldName = schema.fields.find((field) => field.field_id === fieldId)?.field_name;
      expect(fieldName, `schema field for ${fieldId}`).toBeTruthy();
      expect(form.getTextField(fieldName!).getText() ?? "").toBe(expected);
    }
  });
});
