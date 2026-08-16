import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { ACORD25_TEMPLATE_B64 } from "@/lib/coi-engine/acord25-template";
import acord25Schema from "@/lib/coi-engine/acord25-schema.json";
import { ACORD30_TEMPLATE_B64 } from "@/lib/coi-engine/acord30-template";
import acord30Schema from "@/lib/coi-engine/acord30-schema.json";
import { fillCoiPdfFormWithReport, type CoiPdfFormSchema } from "@/lib/coi-engine/coi-pdf";

const templates = [
  {
    form: "acord25",
    bytes: () => Uint8Array.from(Buffer.from(ACORD25_TEMPLATE_B64, "base64")),
    schema: acord25Schema as CoiPdfFormSchema,
  },
  {
    form: "acord30",
    bytes: () => Uint8Array.from(Buffer.from(ACORD30_TEMPLATE_B64, "base64")),
    schema: acord30Schema as CoiPdfFormSchema,
  },
] as const;

const holderLayouts = {
  acord25: [
    ["certificateHolderNameLine1", 72, 92, 230, 10],
    ["certificateHolderNameLine2", 72, 82, 230, 10],
    ["certificateHolderAddressLine1.street1", 72, 72, 230, 10],
    ["certificateHolderAddressLine1.street2", 72, 62, 230, 10],
    ["certificateHolderAddressLine1.city", 72, 52, 120, 10],
    ["certificateHolderAddressLine1.state", 192, 52, 64, 10],
    ["certificateHolderAddressLine1.zip", 256, 52, 46, 10],
  ],
  acord30: [
    ["certificateHolderName", 72, 98, 209, 10],
    ["certificateHolderNameLine2", 72, 88, 209, 10],
    ["certificateHolderAddressLine1.street1", 72, 78, 209, 10],
    ["certificateHolderAddressLine1.street2", 72, 68, 209, 10],
    ["certificateHolderAddressLine1.city", 72, 58, 144, 10],
    ["certificateHolderAddressLine1.state", 216, 58, 18, 10],
    ["certificateHolderAddressLine1.zip", 234, 58, 47, 10],
  ],
} as const;

const templateWidgetFingerprints = {
  acord25: {
    fieldCount: 130,
    digest: "f0b3b9425b1079a628547c99b9b793472068708b7c06cf25a441b07ccc096de4",
  },
  acord30: {
    fieldCount: 137,
    digest: "51cc26c7a18c159b3d9b41be2f29df603e657814303d60e8dd7c62289859d4c7",
  },
} as const;

function widgetFingerprint(document: PDFDocument, schema: CoiPdfFormSchema): string {
  const form = document.getForm();
  const fields = schema.fields.map((field) => {
    const pdfField = form.getField(field.field_name);
    return {
      fieldId: field.field_id,
      fieldName: field.field_name,
      fieldType: pdfField.constructor.name,
      widgets: pdfField.acroField.getWidgets().map((widget) => ({
        rectangle: widget.getRectangle(),
        appearanceCharacteristics: widget.dict.get(PDFName.of("MK"))?.toString() ?? null,
        borderStyle: widget.dict.get(PDFName.of("BS"))?.toString() ?? null,
        border: widget.dict.get(PDFName.of("Border"))?.toString() ?? null,
      })),
    };
  });

  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

describe("vendored COI template/schema parity", () => {
  it.each(templates)("$form embeds the exact committed PDF asset", ({ form, bytes }) => {
    // This repo commits the raw templates under public/ (HTA used src/assets).
    const asset = readFileSync(join(process.cwd(), "public", `${form}.pdf`));
    expect(Buffer.from(bytes()).equals(asset)).toBe(true);
  });

  it.each(templates)("$form exposes every widget declared by its schema", async ({ bytes, schema }) => {
    const document = await PDFDocument.load(bytes());
    const widgetNames = new Set(document.getForm().getFields().map((field) => field.getName()));
    const missing = schema.fields
      .map((field) => field.field_name)
      .filter((fieldName) => !widgetNames.has(fieldName));

    expect(missing).toEqual([]);
  });

  // The ACORD artwork already draws the holder section. Its widgets are text
  // overlays, so borders/backgrounds on any holder field are always accidental.
  it.each(templates)("$form keeps the certificate-holder block borderless", async ({ bytes, schema }) => {
    const document = await PDFDocument.load(bytes());
    const holderFieldNames = schema.fields
      .filter((field) => field.field_id.startsWith("certificateHolder"))
      .map((field) => field.field_name);

    expect(holderFieldNames.length).toBeGreaterThan(0);
    for (const fieldName of holderFieldNames) {
      const widgets = document.getForm().getTextField(fieldName).acroField.getWidgets();
      expect(widgets.length).toBeGreaterThan(0);
      for (const widget of widgets) {
        const appearance = widget.dict.lookupMaybe(PDFName.of("MK"), PDFDict);
        expect(appearance?.has(PDFName.of("BG")) ?? false).toBe(false);
        expect(appearance?.has(PDFName.of("BC")) ?? false).toBe(false);
        expect(widget.dict.has(PDFName.of("BS"))).toBe(false);
        expect(widget.dict.has(PDFName.of("Border"))).toBe(false);
      }
    }
  });

  it.each(templates)("$form keeps the certificate-holder geometry unchanged", async ({ form, bytes, schema }) => {
    const document = await PDFDocument.load(bytes());
    const actualLayout = schema.fields
      .filter((field) => field.field_id.startsWith("certificateHolder"))
      .flatMap((field) => document.getForm().getTextField(field.field_name).acroField.getWidgets().map((widget) => {
        const { x, y, width, height } = widget.getRectangle();
        return [field.field_id, x, y, width, height];
      }));

    expect(actualLayout).toEqual(holderLayouts[form]);
  });

  it.each(templates)("$form keeps every schema widget geometry and decoration stable", async ({ form, bytes, schema }) => {
    const document = await PDFDocument.load(bytes());
    const expected = templateWidgetFingerprints[form];

    expect(schema.fields).toHaveLength(expected.fieldCount);
    expect(document.getForm().getFields()).toHaveLength(expected.fieldCount);
    expect(widgetFingerprint(document, schema)).toBe(expected.digest);
  });

  it.each(templates)("$form writes certificate-holder line 2 without moving the address", async ({ bytes, schema }) => {
    const result = await fillCoiPdfFormWithReport(bytes(), {
      certificateHolderNameLine1: "Building Owner LLC",
      certificateHolderName: "Building Owner LLC",
      certificateHolderNameLine2: "Attn: Risk Management",
      "certificateHolderAddressLine1.street1": "425 Market Street",
      "certificateHolderAddressLine1.street2": "Suite 1300",
    }, schema, { flatten: false });

    expect(result.unmappedFields).toEqual([]);
    const document = await PDFDocument.load(result.pdfBytes);
    const form = document.getForm();
    const fieldName = (fieldId: string) => schema.fields.find((field) => field.field_id === fieldId)!.field_name;
    expect(form.getTextField(fieldName("certificateHolderNameLine2")).getText()).toBe("Attn: Risk Management");
    expect(form.getTextField(fieldName("certificateHolderAddressLine1.street1")).getText()).toBe("425 Market Street");
    expect(form.getTextField(fieldName("certificateHolderAddressLine1.street2")).getText()).toBe("Suite 1300");
  });
});
