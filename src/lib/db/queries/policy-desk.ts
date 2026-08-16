import type {
  CarrierKnowledgeEntry,
  KnowledgeKind,
  KnowledgeSeverity,
} from "../../carriers/carrier-knowledge";
import {
  insertOperatorKnowledgeEntry,
  listOperatorKnowledgeEntries,
} from "../../carriers/carrier-knowledge-store";
import type { DeskDocument } from "../../documents";
import { iscParseAttachable, parseIscDec } from "../../intake/isc-intake";
import {
  fileDocument,
  attachIscSchedule,
  getCarrierByName,
  getCarrierBySlug,
  listAdditionalInsureds,
  listCarrierForms,
  listDocuments,
  type AdditionalInsuredRecord,
  type CarrierFormRecord,
  type CarrierRecord,
} from "../../carriers/policy-intelligence";
import type { Policy } from "../../types";
import { getDb } from "../connection";
import { mapPolicy } from "../mappers";

// ————————————————— Carrier Knowledge —————————————————

/** Operator-added knowledge entries for one carrier (never enforceable). */
export function listOperatorCarrierKnowledge(
  carrier?: string,
): CarrierKnowledgeEntry[] {
  return listOperatorKnowledgeEntries(getDb(), carrier);
}

/**
 * File a knowledge entry the desk just learned. Renders as a card on the
 * carrier page immediately; it can warn but never hard-block — enforcement
 * rules move into the committed registry through code review.
 */
export function addOperatorCarrierKnowledge(input: {
  carrier: string;
  writingCompany?: string | null;
  coverageLine?: string | null;
  industryVertical?: string | null;
  state?: string | null;
  kind: KnowledgeKind;
  severity: Extract<KnowledgeSeverity, "warning" | "note">;
  title: string;
  detail: string;
  consequence?: string | null;
  source: string;
  createdBy?: string | null;
}): CarrierKnowledgeEntry {
  return insertOperatorKnowledgeEntry(getDb(), input);
}

export function getCarrierDesk(slug: string): {
  carrier: CarrierRecord;
  forms: CarrierFormRecord[];
  policies: Policy[];
  documents: DeskDocument[];
} | null {
  const db = getDb();
  const carrier = getCarrierBySlug(db, slug);
  if (!carrier) return null;
  const forms = listCarrierForms(db, carrier.id);
  const policies = (
    db
      .prepare(`SELECT * FROM policies WHERE lower(carrier) = lower(?)`)
      .all(carrier.name) as Record<string, unknown>[]
  ).map(mapPolicy);
  const documents = listDocuments(db, { carrierId: carrier.id });
  return { carrier, forms, policies, documents };
}

export function getTicketDocuments(ticketId: string): DeskDocument[] {
  return listDocuments(getDb(), { ticketId });
}

export function getAccountDocuments(accountId: string): DeskDocument[] {
  return listDocuments(getDb(), { accountId });
}

export function getAccountAdditionalInsureds(
  accountId: string,
): AdditionalInsuredRecord[] {
  return listAdditionalInsureds(getDb(), accountId);
}

export function fileAccountDocument(input: {
  accountId: string;
  accountName: string;
  policyId?: string | null;
  ticketId?: string | null;
  originalName: string;
  bytes?: Buffer | null;
  trusted?: boolean;
  kindHint?: DeskDocument["kind"];
}): DeskDocument {
  return fileDocument(getDb(), input);
}

export function getCarrierSlugForName(name: string): string | null {
  return getCarrierByName(getDb(), name)?.slug ?? null;
}

/**
 * ISC portal intake: parse pasted dec/schedule text, file it as the source
 * document, and attach the extracted schedule of record to the policy.
 * Server-side re-parse — the client preview is advisory only. Throws when
 * the parse fails the accuracy gate (no writer, nothing recognized, or a
 * policy-number mismatch).
 */
export function ingestIscScheduleFromPaste(input: {
  policyId: string;
  text: string;
}): {
  writer: string | null;
  coverages: number;
  limits: number;
  endorsements: number;
  documentId: string;
} {
  const db = getDb();
  const policy = db
    .prepare(`SELECT * FROM policies WHERE id = ?`)
    .get(input.policyId) as Record<string, unknown> | undefined;
  if (!policy) throw new Error("Policy not found.");
  const mapped = mapPolicy(policy);
  if (mapped.carrier.trim().toLowerCase() !== "isc") {
    throw new Error("ISC intake only attaches to ISC (MGA) paper.");
  }
  const account = db
    .prepare(`SELECT id, name FROM accounts WHERE id = ?`)
    .get(mapped.accountId) as { id: string; name: string } | undefined;
  if (!account) throw new Error("Account not found.");

  const parsed = parseIscDec(input.text);
  const gate = iscParseAttachable(parsed, mapped.policyNumber);
  if (!gate.ok) throw new Error(gate.reason ?? "Parse failed.");

  const doc = fileDocument(db, {
    accountId: account.id,
    accountName: account.name,
    policyId: mapped.id,
    originalName: `ISC portal schedule ${mapped.policyNumber}.txt`,
    bytes: Buffer.from(input.text, "utf-8"),
    trusted: true,
    kindHint: "policy",
  });

  attachIscSchedule(db, {
    policyId: mapped.id,
    parsed,
    sourceDocumentId: doc.id,
  });

  return {
    writer: parsed.writer,
    coverages: parsed.coverages.length,
    limits: parsed.limits.length,
    endorsements: parsed.endorsements.length,
    documentId: doc.id,
  };
}

export type {
  AdditionalInsuredRecord,
  CarrierFormRecord,
  CarrierRecord,
  DeskDocument,
};
