import type { ServiceTemplate } from "./types";

/** Seeded registry — Notion sync replaces/extends these with provenance. */
export const SEED_SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    id: "tmpl-cure-chase-v1",
    name: "Cancellation Cure Chase",
    channel: "email",
    notionSourceId: "3330ed61f4d781aab766caa977990adc",
    notionSourceUrl:
      "https://app.notion.com/p/3330ed61f4d781aab766caa977990adc",
    version: 1,
    requestType: "cancellation_cure",
    subject: "Action needed — {{account_name}} policy",
    body: "Hi {{contact_name}},\n\nWe still need {{cure_item}} to keep {{account_name}} active through {{cancel_date}}.\n\n— Harper Service",
    placeholders: ["account_name", "contact_name", "cure_item", "cancel_date"],
    updatedAt: "2026-08-10T00:00:00.000Z",
    provenance: "seed:service-email-template-library",
  },
  {
    id: "tmpl-coi-issue-v1",
    name: "COI Issued Notice",
    channel: "email",
    notionSourceId: "3330ed61f4d781aab766caa977990adc",
    notionSourceUrl:
      "https://app.notion.com/p/3330ed61f4d781aab766caa977990adc",
    version: 1,
    requestType: "coi",
    subject: "Certificate of Insurance — {{account_name}}",
    body: "Hi {{holder_name}},\n\nAttached is the certificate for {{account_name}}.\n\n— Harper Service",
    placeholders: ["account_name", "holder_name"],
    updatedAt: "2026-08-10T00:00:00.000Z",
    provenance: "seed:service-email-template-library",
  },
];

const byId = new Map(SEED_SERVICE_TEMPLATES.map((t) => [t.id, t]));

export function listServiceTemplates(): ServiceTemplate[] {
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getServiceTemplate(id: string): ServiceTemplate | null {
  return byId.get(id) ?? null;
}

export function upsertServiceTemplate(template: ServiceTemplate): void {
  byId.set(template.id, template);
}

export function extractPlaceholders(body: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) found.add(m[1]);
  return [...found].sort();
}

export function lintPlaceholders(
  template: ServiceTemplate,
  values: Record<string, string | null | undefined>,
): { missing: string[]; unknown: string[] } {
  const missing = template.placeholders.filter((p) => !values[p]?.trim());
  const unknown = Object.keys(values).filter(
    (k) => !template.placeholders.includes(k),
  );
  return { missing, unknown };
}

/**
 * Notion sync seam — when NOTION_TOKEN + database/page are configured,
 * a server job will replace seed rows. Until then, seeds stay labeled.
 */
export function notionSyncConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN?.trim());
}
