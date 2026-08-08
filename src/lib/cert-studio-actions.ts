"use server";

import { revalidatePath } from "next/cache";
import { CERT_FORMS } from "./acord25";
import { assertLearnableCorrection } from "./cert-corrections";
import {
  invalidatePreparedForAccount,
  migrateCertLedger,
} from "./cert-ledger";
import {
  deleteCertHolder,
  deletePlacementRule,
  getIntelligenceDb,
  insertCertHolder,
  listCertHolders,
  listPlacementRules,
  updateCertHolder,
  upsertPlacementRule,
} from "./policy-intelligence";
import { getSessionOperator } from "./session";

/**
 * Certificate Studio server actions — the desk correction loop. Owned by the
 * cert pipeline; nothing here touches actions.ts / desk-actions.ts.
 */

const SECTION_KEYS = new Set(
  Object.values(CERT_FORMS).flatMap((f) => f.sections.map((s) => s.key)),
);

/** A placement change reshapes the sheet — pending prepared certs are dead. */
function invalidatePrepared(accountId: string, reason: string) {
  const db = getIntelligenceDb();
  migrateCertLedger(db);
  invalidatePreparedForAccount(db, accountId, reason);
}

/**
 * Operator corrected a policy's placement: persist the rule (policyId →
 * section) so this render and every future render of the account's
 * certificate honors it. One rule per policy — the latest correction wins.
 */
export async function correctPlacementAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const policyId = String(formData.get("policyId") ?? "");
  const sectionKey = String(formData.get("sectionKey") ?? "");
  const movedFrom = String(formData.get("movedFrom") ?? "").trim() || null;
  if (!accountId || !policyId) throw new Error("Missing account or policy.");
  if (!SECTION_KEYS.has(sectionKey)) {
    throw new Error(`"${sectionKey}" is not a section on any certificate form.`);
  }
  // Learning boundary: a placement correction is a routing-class rule —
  // the only endorsement-adjacent thing the desk may teach — and the gate
  // throws on anything else before a row can land.
  assertLearnableCorrection("placement");
  const operator = await getSessionOperator();
  upsertPlacementRule(getIntelligenceDb(), {
    accountId,
    policyId,
    sectionKey,
    movedFrom,
    correctedBy: operator?.displayName ?? "Desk",
  });
  invalidatePrepared(accountId, "Placement Rule Changed");
  revalidatePath(`/accounts/${accountId}`);
}

/** Rules are revocable — remove one and the coverage matcher takes back over. */
export async function removePlacementRuleAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!accountId || !ruleId) throw new Error("Missing account or rule.");
  await getSessionOperator();
  const db = getIntelligenceDb();
  // Only rules on this account can be removed through this form.
  const owned = listPlacementRules(db, accountId).some((r) => r.id === ruleId);
  if (owned) {
    deletePlacementRule(db, ruleId);
    invalidatePrepared(accountId, "Placement Rule Removed");
  }
  revalidatePath(`/accounts/${accountId}`);
}

/* ————————————————— Holder rail ————————————————— */

/**
 * Add a certificate holder to the account's rail. The desk types it (or saves
 * it off a ticket) — nothing is ever invented. Name required; address may be
 * blank when the requester didn't give one.
 */
export async function addCertHolderAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim() || null;
  if (!accountId) throw new Error("Missing account.");
  if (!name) throw new Error("A holder needs a name.");
  // Learning boundary: saved holders are formatting-class (name + address
  // carried verbatim) — the gate documents and enforces that nothing here
  // can ever pre-fill a coverage fact.
  assertLearnableCorrection("holder_rail");
  await getSessionOperator();
  insertCertHolder(getIntelligenceDb(), { accountId, ticketId, name, address });
  revalidatePath(`/accounts/${accountId}`);
}

/** Edit-in-place for a saved rail holder. */
export async function updateCertHolderAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const holderId = String(formData.get("holderId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!accountId || !holderId) throw new Error("Missing account or holder.");
  if (!name) throw new Error("A holder needs a name.");
  await getSessionOperator();
  const db = getIntelligenceDb();
  const owned = listCertHolders(db, accountId).some((h) => h.id === holderId);
  if (owned) updateCertHolder(db, { id: holderId, name, address });
  revalidatePath(`/accounts/${accountId}`);
}

/** Rail holders are removable — the rail is a desk tool, not a record of truth. */
export async function removeCertHolderAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const holderId = String(formData.get("holderId") ?? "");
  if (!accountId || !holderId) throw new Error("Missing account or holder.");
  await getSessionOperator();
  const db = getIntelligenceDb();
  const owned = listCertHolders(db, accountId).some((h) => h.id === holderId);
  if (owned) deleteCertHolder(db, holderId);
  revalidatePath(`/accounts/${accountId}`);
}
