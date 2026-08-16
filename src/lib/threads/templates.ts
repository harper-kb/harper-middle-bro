export type EmailTemplateId = "standard" | "brief" | "formal" | "bullets";

export interface EmailTemplateDef {
  id: EmailTemplateId;
  label: string;
  description: string;
}

export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  {
    id: "standard",
    label: "Standard",
    description: "Simple request with account and policy refs",
  },
  {
    id: "brief",
    label: "Brief",
    description: "Short and direct — minimal lines",
  },
  {
    id: "formal",
    label: "Formal",
    description: "Polite formal tone for picky markets",
  },
  {
    id: "bullets",
    label: "Bullets",
    description: "Checklist-style body for clear fields",
  },
];

export interface TemplateContext {
  uwName: string;
  accountName: string;
  policyNumber: string;
  carrier: string;
  coverages: string;
  /** Primary / combined label for the ask */
  requestLabel: string;
  /** Optional multi-line list of stacked endorsements */
  requestItems?: string[];
  details: string;
  /** Operator signature — always stamped on drafts */
  signature: string;
}

export function getEmailTemplate(id: EmailTemplateId): EmailTemplateDef {
  return EMAIL_TEMPLATES.find((t) => t.id === id) ?? EMAIL_TEMPLATES[0];
}

function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return body;
  return `${body.trimEnd()}\n\n${sig}`;
}

function itemsBlock(ctx: TemplateContext): string {
  const items = ctx.requestItems?.filter(Boolean) ?? [];
  if (items.length <= 1) return "";
  return `\nRequested items:\n${items.map((i) => `• ${i}`).join("\n")}\n`;
}

/** Generic body — regenerated from request type + account; signature from signed-in operator. */
export function renderEmailBody(
  templateId: EmailTemplateId,
  ctx: TemplateContext,
): string {
  const details = ctx.details.trim() || "[details]";
  const who = ctx.uwName.split(" ")[0] || ctx.uwName;
  const stack = itemsBlock(ctx);

  let body: string;
  switch (templateId) {
    case "brief":
      body = `Hi ${who} — need ${ctx.requestLabel} on ${ctx.accountName} (${ctx.policyNumber}, ${ctx.carrier}).${stack}\n${details}\n\nPlease confirm + premium if any.`;
      break;

    case "formal":
      body = `Dear ${ctx.uwName},\n\nWe respectfully request your assistance with the following for our insured ${ctx.accountName}: ${ctx.requestLabel}.\n\nPolicy: ${ctx.policyNumber}\nCarrier: ${ctx.carrier}\nCoverages: ${ctx.coverages}${stack}\nRequest details:\n${details}\n\nKindly advise of approval status and any associated premium.`;
      break;

    case "bullets":
      body = `Hi ${who},\n\nPlease process this request:\n\n• Type: ${ctx.requestLabel}\n• Insured: ${ctx.accountName}\n• Policy: ${ctx.policyNumber}\n• Carrier: ${ctx.carrier}\n• Coverages: ${ctx.coverages}${
        (ctx.requestItems?.length ?? 0) > 1
          ? `\n${ctx.requestItems!.map((i) => `• Item: ${i}`).join("\n")}`
          : ""
      }\n• Details: ${details}\n\nPlease reply with confirmation and any premium impact.`;
      break;

    case "standard":
    default:
      body = `Hi ${who},\n\nPlease process ${ctx.requestLabel} for ${ctx.accountName}.\n\nPolicy: ${ctx.policyNumber} (${ctx.carrier})${stack}\n${details}\n\nPlease confirm and advise of any premium.`;
      break;
  }

  return withSignature(body, ctx.signature);
}
