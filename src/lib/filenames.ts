/**
 * One naming convention for every attachment that leaves this desk.
 *
 * Operators should never have to think about what a file is called:
 * drop `scan_0012(1).pdf` and it becomes `Oak Street Builders LLC - COI.pdf`.
 * Entity first (that's what people search by), then what the document is.
 */

export type DocConventionKind =
  | "coi"
  | "quote"
  | "policy"
  | "endorsement"
  | "contract"
  | "invoice"
  | "other";

const KIND_SUFFIX: Record<DocConventionKind, string> = {
  coi: "COI",
  quote: "Quote",
  policy: "Policy",
  endorsement: "Endorsement",
  contract: "Contract",
  invoice: "Invoice",
  other: "Document",
};

export function conventionKindLabel(kind: DocConventionKind): string {
  return KIND_SUFFIX[kind];
}

const ILLEGAL = /[\\/:*?"<>|]+/g;
const MAX_ENTITY = 60;

/** Entity name safe for a filesystem, without mangling how a business is actually spelled. */
export function cleanEntityName(raw: string): string {
  const cleaned = raw
    .replace(ILLEGAL, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .trim();
  if (cleaned.length <= MAX_ENTITY) return cleaned;
  return cleaned.slice(0, MAX_ENTITY).trim();
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "pdf";
  return name.slice(dot + 1).toLowerCase().replace(ILLEGAL, "");
}

/** Guess what a dropped file is so the convention can name it without asking. */
export function guessKind(originalName: string): DocConventionKind {
  const n = originalName.toLowerCase();
  if (/\b(coi|cert|certificate|acord\s*25)\b/.test(n)) return "coi";
  if (/\bquote|quotation\b/.test(n)) return "quote";
  if (/\bpolicy|binder|dec\b/.test(n)) return "policy";
  if (/\bendorse|endt\b/.test(n)) return "endorsement";
  if (/\bcontract|agreement|agmt|msa|lease|subcontract\b/.test(n)) return "contract";
  if (/\binvoice|bill|receipt\b/.test(n)) return "invoice";
  return "other";
}

export interface ConventionInput {
  /** Certificate holder for a COI; otherwise the account or carrier the doc belongs to */
  entity: string;
  kind: DocConventionKind;
  /** Original filename — used for the extension and as a fallback entity */
  originalName: string;
  /** Names already attached, so we never collide */
  taken?: string[];
}

/** `{Entity} - {KIND}.{ext}`, de-duplicated as `… (2)`. */
export function conventionName({
  entity,
  kind,
  originalName,
  taken = [],
}: ConventionInput): string {
  const ext = fileExtension(originalName);
  const base = cleanEntityName(entity) || cleanEntityName(stripExtension(originalName)) || "Document";
  const stem = `${base} - ${KIND_SUFFIX[kind]}`;

  let candidate = `${stem}.${ext}`;
  let n = 2;
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  while (lower.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n}).${ext}`;
    n += 1;
  }
  return candidate;
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Null when the convention left the name alone — nothing to tell the operator. */
export function describeRename(original: string, next: string): string | null {
  return original === next ? null : `Renamed from ${original}`;
}
