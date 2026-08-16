import "server-only";
import { getDb } from "@/lib/db/connection";
import { getAccountDetail } from "@/lib/db";
import { naicForPolicy } from "@/lib/certificates/naic";
import {
  getPolicyFormSet,
  limitStatement,
  LIMIT_SLOT_LABELS,
  type LimitSlot,
} from "@/lib/certificates/forms";
import type { Policy } from "@/lib/types";
import type { CoiContext, PolicyOption } from "./coi-context";
import type { CoverageExtractionFacts } from "./coi-generate";
import { loadStoredCoiCore } from "./coi-save";

// ── This repo's CoiContext assembly (the coi-data.ts replacement) ────────────
// HTA's loadCoiContext read Harper's prod stores through the harper-tools SQL
// gateway (insurance.policy, deals_v2, Aether artifacts, the extraction door).
// This desk's schedule of record is local SQLite: accounts + policies +
// policy_limits/policy_coverage_parts (the dec-page schedule), tickets (holder
// asks), documents, and the engine's own generated_certificates store.
//
// The mapping is honest about what this model does NOT carry: there is no
// deals_v2 (deal: null), no extraction pipeline (docExtraction: null), and no
// billing stage read (billing: null). The fallback ladder treats an absent
// tier as "skip", never "invent" — so a gap here prints as CONFIRM downstream,
// exactly the posture the port must keep.

export interface LoadCoiContextOptions {
  /** Explicit policy pick (this repo's policy id) — outranks the default. */
  policyId?: string | null;
  /** Holder from this ticket — outranks the newest-holder-ticket default. */
  ticketId?: string | null;
}

/** The certificate section a dec-page limit slot belongs to. */
function slotLine(slot: LimitSlot): string {
  if (slot.startsWith("gl_")) return "General Liability";
  if (slot.startsWith("auto_")) return "Automobile Liability";
  if (slot.startsWith("umb_")) return "Umbrella Liability";
  if (slot.startsWith("wc_")) return "Workers Compensation";
  if (slot.startsWith("gar_")) return "Garage Liability";
  if (slot.startsWith("gk_")) return "Garagekeepers";
  if (slot.startsWith("liquor_")) return "Liquor Liability";
  if (slot.startsWith("prof_")) return "Professional Liability";
  if (slot.startsWith("cyber_")) return "Cyber Liability";
  return "";
}

function policyOption(p: Policy): PolicyOption {
  return {
    policyNumber: p.policyNumber || null,
    status: "bound",
    effectiveDate: p.effectiveDate || null,
    expirationDate: p.expirationDate || null,
    coverageLines: p.coverages,
  };
}

interface HolderRow {
  holder_name: string | null;
  holder_address: string | null;
  sr_number: string | null;
}

/** The holder the request thread names: an explicit ticket first, else the
 * newest ticket on the account that carries one. Never invented. */
function holderForAccount(
  accountId: string,
  ticketId: string | null,
): { name: string | null; address: string | null; source: string | null } {
  const db = getDb();
  if (ticketId) {
    const row = db
      .prepare(
        `SELECT holder_name, holder_address, sr_number FROM tickets
         WHERE id = ? AND account_id = ?`,
      )
      .get(ticketId, accountId) as HolderRow | undefined;
    if (row?.holder_name) {
      return {
        name: row.holder_name,
        address: row.holder_address ?? null,
        source: row.sr_number ? `ticket ${row.sr_number}` : "ticket",
      };
    }
  }
  const newest = db
    .prepare(
      `SELECT holder_name, holder_address, sr_number FROM tickets
       WHERE account_id = ? AND holder_name IS NOT NULL AND trim(holder_name) != ''
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(accountId) as HolderRow | undefined;
  if (newest?.holder_name) {
    return {
      name: newest.holder_name,
      address: newest.holder_address ?? null,
      source: newest.sr_number ? `ticket ${newest.sr_number}` : "ticket",
    };
  }
  return { name: null, address: null, source: null };
}

/**
 * The local stand-in for HTA's policy-forms extraction seam: the dec-page
 * schedule of record (policy_endorsements) read into CoverageExtractionFacts.
 * blanketAi / scheduledAi / waiverSubrogation come from the endorsement forms
 * ACTUALLY on the schedule — the same fail-closed law as the seam (an AI/WOS
 * checkbox never stamps Y without this attestation). Null when the account or
 * policy has no schedule on file.
 */
export function coverageExtractionForPolicy(
  accountId: string,
  policyId?: string | null,
): CoverageExtractionFacts | null {
  const account = getAccountDetail(accountId);
  if (!account) return null;
  const picked =
    (policyId ? account.policies.find((p) => p.id === policyId) : null) ??
    [...account.policies].sort((a, b) =>
      (b.effectiveDate || "").localeCompare(a.effectiveDate || ""),
    )[0] ??
    null;
  if (!picked) return null;
  const set = getPolicyFormSet(picked);
  if (!set || set.unscheduled || !set.endorsements.length) return null;
  const has = (kind: string, scope?: string) =>
    set.endorsements.some(
      (e) => e.kind === kind && (scope === undefined || e.scope === scope),
    );
  return {
    policyNumber: picked.policyNumber || null,
    carrier: picked.carrier || null,
    // The dec-page writing company outranks the brand — the seam contract's
    // paper-verified precedence, carried by this repo's issuing_carrier.
    paperVerifiedCarrier: picked.issuingCarrier ?? null,
    effectiveDate: picked.effectiveDate || null,
    expirationDate: picked.expirationDate || null,
    blanketAi: has("ai", "blanket"),
    scheduledAi: has("ai", "scheduled"),
    waiverSubrogation: has("wos"),
    primaryNoncontributory: has("pnc"),
    endorsementForms: set.endorsements.map((e) =>
      `${e.form} ${e.edition}`.trim(),
    ),
  };
}

interface DocRow {
  id: string;
  canonical_name: string;
  kind: string;
  folder: string;
  trusted: number;
  created_at: string;
}

/**
 * Build the certificate factory's CoiContext for one account from the local
 * schedule of record. Null when the account does not exist.
 */
export function loadCoiContext(
  accountId: string,
  opts?: LoadCoiContextOptions,
): CoiContext | null {
  const account = getAccountDetail(accountId);
  if (!account) return null;

  const policies = account.policies;
  const picked =
    (opts?.policyId ? policies.find((p) => p.id === opts.policyId) : null) ??
    // The standing default mirrors HTA's prefer-bound-then-newest: every
    // policy on this book is bound, so newest term wins.
    [...policies].sort((a, b) =>
      (b.effectiveDate || "").localeCompare(a.effectiveDate || ""),
    )[0] ??
    null;

  // The dec-page schedule for the picked policy — coverage part labels are the
  // certificate's coverage lines; limits print through limitStatement (a real
  // dollar figure, "Included", or "Excluded" — the dec page's own words).
  // An UNSCHEDULED set (bare policy codes, no dec on file) claims lines but no
  // limits: a limit that is not on paper prints blank, never a guess.
  const formSet = picked ? getPolicyFormSet(picked) : null;
  const coverageLines = picked
    ? formSet && !formSet.unscheduled && formSet.coverages.length
      ? formSet.coverages.map((c) => c.label)
      : picked.coverages
    : [];
  const limits =
    picked && formSet && !formSet.unscheduled
      ? formSet.limits.map((l) => ({
          line: slotLine(l.slot),
          label: LIMIT_SLOT_LABELS[l.slot],
          amount: limitStatement(l),
        }))
      : [];

  const holder = holderForAccount(accountId, opts?.ticketId ?? null);

  const db = getDb();
  const docRows = db
    .prepare(
      `SELECT id, canonical_name, kind, folder, trusted, created_at
       FROM documents WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(accountId) as DocRow[];
  const docs = docRows.map((d) => ({
    artifactId: d.id,
    name: d.canonical_name,
    type: d.kind || null,
    createdAt: d.created_at || null,
  }));
  // The binder-or-dec-page pick: the newest policy-paper document on file.
  // Named so an absence claim can point AT it instead of asserting "no data"
  // (the no-false-absence law) — this repo has no extraction pipeline, so the
  // document is never read into facts here (docExtraction stays null).
  const binderRow = docRows.find(
    (d) => d.folder === "policy" || d.kind === "policy" || d.kind === "endorsement",
  );
  const binder = binderRow
    ? {
        artifactId: binderRow.id,
        name: binderRow.canonical_name,
        createdAt: binderRow.created_at || null,
      }
    : null;

  const stored = loadStoredCoiCore(accountId);
  const newestHasValues = Boolean(
    stored.generatedCert &&
      Object.values(stored.generatedCert.fieldValues).some((v) => v.trim()),
  );
  const generatedCert = newestHasValues && stored.generatedCert
    ? {
        fieldValues: stored.generatedCert.fieldValues,
        status: stored.generatedCert.status,
        createdAt: stored.generatedCert.createdAt,
        modelVersion: null,
        promptVersion: null,
        generationSource:
          typeof stored.generatedCert.generation?.source === "string"
            ? (stored.generatedCert.generation.source as string)
            : null,
        certificateId: stored.generatedCert.certificateId,
        updatedAt: stored.generatedCert.updatedAt,
      }
    : null;
  const priorSource = stored.priorCert;
  const priorCert = priorSource
    ? {
        fieldValues: priorSource.fieldValues,
        createdAt: priorSource.createdAt,
        certificateId: priorSource.certificateId,
      }
    : null;

  const carrierNaic = picked
    ? (naicForPolicy(picked.carrier, picked.coverages, picked.issuingCarrier)
        ?.naic ?? null)
    : null;

  return {
    companyId: accountId,
    issued: null,
    company: {
      name: account.name,
      industry: account.industry || null,
      subIndustry: null,
      city: account.city ?? null,
      state: account.state || null,
      email: null,
      street1: account.addressLine1 ?? null,
      street2: null,
      zip: account.zip ?? null,
      country: null,
    },
    policy: picked
      ? {
          namedInsured: picked.quoteInsuredName ?? null,
          policyNumber: picked.policyNumber || null,
          status: "bound",
          effectiveDate: picked.effectiveDate || null,
          expirationDate: picked.expirationDate || null,
          coverageLines,
          coverageBasis: null,
          limits,
          deductible: null,
        }
      : null,
    // This model has no deals_v2 equivalent: no deal tier, no unbound ledger.
    deal: null,
    holder,
    generatedCert,
    docs,
    binder,
    carrierFromDocs: null,
    carrierNaic,
    docExtraction: null,
    priorCert,
    billing: null,
    dealLines: [],
    requestedLines: [],
    policies: policies.map(policyOption),
  };
}
