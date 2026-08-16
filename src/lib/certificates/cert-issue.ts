"use server";

import { revalidatePath } from "next/cache";
import type Database from "better-sqlite3";
import type { CertFormKey } from "./acord25";
import type { CertCheckResult, CheckOverrideRequest } from "./cert-checks";
import { performCertIssuance } from "./cert-issuance-core";
import {
  markCertErroneous,
  migrateCertLedger,
  requirementKeyFor,
  upsertPrepared,
} from "./cert-ledger";
import type { SheetOverrides } from "./cert-review";
import { buildFactSnapshot } from "./cert-snapshot";
import type { CoiDraft } from "./coi";
import { getPolicyFormSet, type PolicyFormSet } from "./forms";
import { getAccountDetail, getTicketDetail } from "../db";
import {
  getIntelligenceDb,
  listAdditionalInsureds,
} from "../carriers/policy-intelligence";
import { getAccountPlacementRules, placementMapOf } from "./cert-corrections";
import { getActiveRedAlertForAccount } from "../desk/red-alerts";
import { getSessionOperator } from "../session/session";
import type { Account, Policy } from "../types";

/**
 * Certificate issuance server actions — the only door out of the system.
 *
 * Every route (studio, batch run, ticket) resolves its inputs here at the
 * send moment — red-alert state, Additional Insured bind status, source
 * documents — and calls the single issuance core. No other server action
 * issues a certificate, and the core persists every attempt whether it
 * passes or blocks.
 */

let migrated = false;
function ledgerDb(): Database.Database {
  const handle = getIntelligenceDb();
  if (!migrated) {
    migrateCertLedger(handle);
    migrated = true;
  }
  return handle;
}

export interface IssueActionOutcome {
  issued: boolean;
  certId?: string;
  issuedAt?: string;
  supersedes?: string | null;
  snapshotDigest?: string;
  results: CertCheckResult[];
}

const normalizeLoose = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|lp|llp)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface ResolvedContext {
  db: Database.Database;
  operator: string;
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
  redAlertActive: boolean;
  holderAiRecords: { status: "requested" | "quoted" | "bound" | "declined"; formUsed: string | null }[];
  scheduleSources: { kind: string | null; createdAt: string | null }[];
  requirementHolderName: string | null;
}

async function resolveContext(input: {
  accountId: string;
  policyIds: string[];
  holderName: string;
  ticketId?: string | null;
}): Promise<ResolvedContext> {
  const operator = await getSessionOperator();
  if (!operator) throw new Error("Sign in to issue a certificate.");
  const account = getAccountDetail(input.accountId);
  if (!account) throw new Error("Unknown account.");
  const policies = account.policies.filter((p) => input.policyIds.includes(p.id));
  if (policies.length === 0) throw new Error("Select at least one policy.");
  const db = ledgerDb();

  const holderKey = normalizeLoose(input.holderName);
  const holderAiRecords = listAdditionalInsureds(db, input.accountId)
    .filter((r) => normalizeLoose(r.name) === holderKey)
    .map((r) => ({ status: r.status, formUsed: r.formUsed }));

  // Source documents backing the selected policies' schedules — both direct
  // policy paper and documents cited by endorsement rows.
  const marks = policies.map(() => "?").join(", ");
  const ids = policies.map((p) => p.id);
  const scheduleSources = (
    db
      .prepare(
        `SELECT DISTINCT d.kind AS kind, d.created_at AS created_at
         FROM documents d
         WHERE d.policy_id IN (${marks})
         UNION
         SELECT DISTINCT d.kind AS kind, d.created_at AS created_at
         FROM documents d
         JOIN policy_endorsements pe ON pe.source_document_id = d.id
         WHERE pe.policy_id IN (${marks})`,
      )
      .all(...ids, ...ids) as { kind: string | null; created_at: string | null }[]
  ).map((r) => ({ kind: r.kind, createdAt: r.created_at }));

  const ticket = input.ticketId ? getTicketDetail(input.ticketId) : null;

  return {
    db,
    operator: operator.displayName,
    account,
    policies,
    formSets: Object.fromEntries(policies.map((p) => [p.id, getPolicyFormSet(p)])),
    redAlertActive: getActiveRedAlertForAccount(input.accountId) != null,
    holderAiRecords,
    scheduleSources,
    requirementHolderName: ticket?.holderName ?? null,
  };
}

function serializeOutcome(
  outcome: ReturnType<typeof performCertIssuance>,
): IssueActionOutcome {
  if (outcome.issued) {
    return {
      issued: true,
      certId: outcome.cert.id,
      issuedAt: outcome.cert.issuedAt,
      supersedes: outcome.cert.supersedes,
      snapshotDigest: outcome.cert.snapshotDigest,
      results: outcome.results,
    };
  }
  return { issued: false, results: outcome.results };
}

/**
 * Issue a certificate off the studio sheet (single holder or batch run).
 * The exact on-screen artifact — form, placements, reviewer edits — is
 * re-resolved server-side against the schedule of record, snapshotted, and
 * gated by the canonical registry.
 */
export async function issueCertificateAction(input: {
  accountId: string;
  policyIds: string[];
  formKey: CertFormKey;
  holderName: string;
  holderAddress: string;
  overrides: SheetOverrides;
  checkOverrides?: CheckOverrideRequest[];
  ticketId?: string | null;
  path?: "studio" | "run";
}): Promise<IssueActionOutcome> {
  const ctx = await resolveContext(input);
  const placements = placementMapOf(getAccountPlacementRules(input.accountId));
  const outcome = performCertIssuance({
    db: ctx.db,
    operator: ctx.operator,
    path: input.path ?? "studio",
    account: ctx.account,
    policies: ctx.policies,
    formSets: ctx.formSets,
    holderName: input.holderName,
    holderAddress: input.holderAddress,
    artifact: {
      kind: "sheet",
      formKey: input.formKey,
      placements,
      overrides: input.overrides,
    },
    ticketId: input.ticketId ?? null,
    requirementHolderName: ctx.requirementHolderName,
    redAlertActive: ctx.redAlertActive,
    holderAiRecords: ctx.holderAiRecords,
    scheduleSources: ctx.scheduleSources,
    checkOverrides: input.checkOverrides,
  });
  revalidatePath(`/accounts/${input.accountId}`);
  return serializeOutcome(outcome);
}

/**
 * Issue a single-policy certificate off a ticket's COI draft (the no-premium
 * verifier rail). Same registry, same ledger — the ticket path appends
 * nothing today but can only ever add checks, never skip one.
 */
export async function issueTicketCertificateAction(input: {
  accountId: string;
  policyId: string;
  ticketId: string | null;
  draft: CoiDraft;
  checkOverrides?: CheckOverrideRequest[];
}): Promise<IssueActionOutcome> {
  const ctx = await resolveContext({
    accountId: input.accountId,
    policyIds: [input.policyId],
    holderName: input.draft.holderName,
    ticketId: input.ticketId,
  });
  const outcome = performCertIssuance({
    db: ctx.db,
    operator: ctx.operator,
    path: "ticket",
    account: ctx.account,
    policies: ctx.policies,
    formSets: ctx.formSets,
    holderName: input.draft.holderName,
    holderAddress: input.draft.holderAddress,
    artifact: { kind: "draft", draft: input.draft },
    ticketId: input.ticketId,
    requirementHolderName: ctx.requirementHolderName,
    redAlertActive: ctx.redAlertActive,
    holderAiRecords: ctx.holderAiRecords,
    scheduleSources: ctx.scheduleSources,
    checkOverrides: input.checkOverrides,
  });
  revalidatePath(`/accounts/${input.accountId}`);
  return serializeOutcome(outcome);
}

/**
 * Prepare (not issue) a certificate: freeze the snapshot now, hold it under
 * a TTL, and let any upstream fact change kill it before send. Used on
 * pre-bind accounts where the desk preps paper ahead of payment.
 */
export async function prepareCertificateAction(input: {
  accountId: string;
  policyIds: string[];
  formKey: CertFormKey;
  holderName: string;
  holderAddress: string;
  overrides: SheetOverrides;
  ticketId?: string | null;
}): Promise<{ preparedId: string; digest: string; expiresAt: string }> {
  const ctx = await resolveContext(input);
  const placements = placementMapOf(getAccountPlacementRules(input.accountId));
  const { snapshot } = buildFactSnapshot({
    account: ctx.account,
    policies: ctx.policies,
    formSets: ctx.formSets,
    formKey: input.formKey,
    placements,
    holderName: input.holderName,
    holderAddress: input.holderAddress,
    overrides: input.overrides,
  });
  const prepared = upsertPrepared(ctx.db, {
    accountId: input.accountId,
    requirementKey: requirementKeyFor({
      ticketId: input.ticketId,
      holderName: input.holderName,
    }),
    holderName: input.holderName,
    snapshot,
    preparedBy: ctx.operator,
  });
  revalidatePath(`/accounts/${input.accountId}`);
  return {
    preparedId: prepared.id,
    digest: prepared.snapshotDigest,
    expiresAt: prepared.expiresAt,
  };
}

/**
 * Mark an issued certificate erroneous: it is revoked on record, the holder
 * re-notification entry is generated, and the next issuance for the same
 * requirement links itself to the revoked paper (chain of custody).
 */
export async function markCertErroneousAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const certId = String(formData.get("certId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!accountId || !certId) throw new Error("Missing account or certificate.");
  if (!reason) throw new Error("Revocation requires a written reason.");
  const operator = await getSessionOperator();
  if (!operator) throw new Error("Sign in to revoke a certificate.");
  markCertErroneous(ledgerDb(), {
    certId,
    revokedBy: operator.displayName,
    reason,
  });
  revalidatePath(`/accounts/${accountId}`);
}