import type { CertFormKey } from "./acord25";
import { evaluateKnowledgeForCertSection } from "./carrier-knowledge";
import type { CoiFlags } from "./coi";
import type { PolicyFormSet } from "./forms";
import { findEndorsement } from "./forms";
import type { Account, Policy } from "./types";

/**
 * Canonical presend check registry — the single gate set for certificate
 * issuance. Every certificate that leaves the system runs this registry;
 * path-specific logic may APPEND checks but can never remove or skip one.
 *
 * Each check is named and enumerable: when issuance blocks, the record says
 * which check blocked, when, and on whose action. Adding a check means adding
 * a registry entry — nothing else changes. Overrides are explicit records
 * (operator + reason + timestamp + check id), and the checks marked
 * `overridable: false` (red alert, cancellation, verifier rejects, unbound
 * endorsements, prior-cert sourcing) cannot be overridden by anyone.
 *
 * Pure module — no database, no server imports — so the same registry runs
 * in the issuance core and in the harness scripts.
 */

export type CertCheckSeverity = "blocking" | "advisory";

export interface CertCheckDef {
  /** Stable machine id, persisted with every attempt */
  id: string;
  /** Title Case display name */
  name: string;
  /** What the check enforces, in one or two sentences */
  description: string;
  severity: CertCheckSeverity;
  /**
   * Whether an attributed override record can clear a failure. Structural,
   * not situational: a non-overridable check fails closed for everyone.
   */
  overridable: boolean;
  evaluate: (ctx: CertCheckContext) => { ok: boolean; detail: string };
}

/** A reject carried in from the sheet/draft verifier, with its origin. */
export interface VerifierReject {
  id: string;
  title: string;
}

/** Source document backing a policy's schedule of record. */
export interface ScheduleSource {
  /** documents.kind — 'policy' | 'endorsement' | 'quote' | 'coi' | … ; null = seeded library schedule */
  kind: string | null;
  createdAt: string | null;
}

/** Additional Insured registry row matching the certificate holder. */
export interface HolderAiRecord {
  status: "requested" | "quoted" | "bound" | "declined";
  formUsed: string | null;
}

/** One policy's effective endorsement claims on the sheet being issued. */
export interface EndorsementClaim {
  policy: Policy;
  set: PolicyFormSet;
  flag: keyof CoiFlags;
}

export interface PreparedArtifactState {
  digest: string;
  expiresAt: string;
  invalidatedAt: string | null;
}

export interface CertCheckContext {
  account: Account;
  policies: Policy[];
  holderName: string;
  holderAddress: string;
  /** ISO instant of the attempt — the snapshot clock */
  now: string;
  /** Rejects from the path verifier (verifyEditedSheet / verifyCoi), computed server-side */
  verifierRejects: VerifierReject[];
  /** Active red alert on the account, resolved at the send moment */
  redAlertActive: boolean;
  /** Endorsement-backed checkbox claims (Additional Insured / Waiver Of Subrogation) */
  endorsementClaims: EndorsementClaim[];
  /** Which certificate form the artifact is being issued on */
  formKey: CertFormKey;
  /** Schedule of record per policy id */
  formSets: Record<string, PolicyFormSet>;
  /** Additional Insured registry rows whose name matches the holder */
  holderAiRecords: HolderAiRecord[];
  /** Holder name carried on the originating service request, when one exists */
  requirementHolderName: string | null;
  /** Source documents backing the selected policies' schedules */
  scheduleSources: ScheduleSource[];
  /** Prepared artifact being consumed, when issuance rides on one */
  prepared: PreparedArtifactState | null;
  /** Digest of the fresh fact snapshot built for this attempt */
  currentDigest: string;
}

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|lp|llp)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const dateOnly = (iso: string) => iso.slice(0, 10);

/**
 * Source-document trust order. Lower rank is more trustworthy. A prior
 * certificate is not on the ladder at all: it is never a source of coverage
 * facts, because a wrong AI/WoS statement on one cert would otherwise
 * propagate to every cert after it.
 */
export const SOURCE_TRUST_ORDER: Record<string, number> = {
  policy: 1,
  endorsement: 1,
  binder: 2,
  quote: 3,
};

/** Days a source document may predate the attempt before it needs re-pull. */
export const SOURCE_AGE_LIMIT_DAYS = 400;

/** Hours a prepared (pre-bind) certificate stays consumable. */
export const PREPARED_CERT_TTL_HOURS = 72;

export const CERT_CHECK_REGISTRY: CertCheckDef[] = [
  {
    id: "red-alert-stand-down",
    name: "Red Alert Stand-Down",
    description:
      "No certificate leaves an account with an active red alert. Evaluated at the send moment, not at preparation.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => ({
      ok: !ctx.redAlertActive,
      detail: ctx.redAlertActive
        ? "An active red alert stands on this account. Resolve it on record before any certificate issues."
        : "No active red alert on the account.",
    }),
  },
  {
    id: "account-in-service",
    name: "Account In Service",
    description:
      "The account must be active (payment received). Pre-bind accounts may prepare specimen certificates but cannot issue; cancelled accounts issue nothing.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      if (ctx.account.status === "active") {
        return { ok: true, detail: "Account is in active service." };
      }
      return {
        ok: false,
        detail:
          ctx.account.status === "pre_bind"
            ? "The account is pre-bind — paper has not issued. Prepare a specimen; issuance waits for payment."
            : "The account is cancelled. Nothing can be certified.",
      };
    },
  },
  {
    id: "policy-in-force",
    name: "Policy In Force At Send",
    description:
      "Every policy on the certificate must be inside its term on the day of issuance. Re-evaluated at the send moment so a mid-term cancellation or lapse blocks a previously cleared certificate.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      const today = dateOnly(ctx.now);
      const out = ctx.policies.filter(
        (p) => dateOnly(p.expirationDate) < today || dateOnly(p.effectiveDate) > today,
      );
      return out.length === 0
        ? { ok: true, detail: "All selected policies are in force today." }
        : {
            ok: false,
            detail: `Not in force today: ${out
              .map((p) => `${p.policyNumber} (${p.effectiveDate} – ${p.expirationDate})`)
              .join("; ")}.`,
          };
    },
  },
  {
    id: "verifier-clean",
    name: "Sheet Verifier Clean",
    description:
      "The schedule-of-record verifier must return zero rejects on the exact artifact being issued — every limit, checkbox, and description line backed by the schedule.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) =>
      ctx.verifierRejects.length === 0
        ? { ok: true, detail: "Verifier returned no rejects." }
        : {
            ok: false,
            detail: `Verifier rejects: ${ctx.verifierRejects
              .map((r) => r.title)
              .join("; ")}.`,
          },
  },
  {
    id: "holder-named",
    name: "Certificate Holder Named",
    description: "A certificate must name who it is issued to.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => ({
      ok: ctx.holderName.trim().length > 0,
      detail: ctx.holderName.trim()
        ? `Holder: ${ctx.holderName.trim()}.`
        : "No certificate holder named.",
    }),
  },
  {
    id: "holder-matches-requirement",
    name: "Holder Matches Requirement Source",
    description:
      "When the certificate rides on a service request, the holder must be the party the request names — a mismatch means the certificate answers a different requirement than the one on file.",
    severity: "blocking",
    overridable: true,
    evaluate: (ctx) => {
      if (!ctx.requirementHolderName) {
        return { ok: true, detail: "No requirement source carries a holder name." };
      }
      const match = normalize(ctx.requirementHolderName) === normalize(ctx.holderName);
      return match
        ? { ok: true, detail: "Holder matches the requirement source." }
        : {
            ok: false,
            detail: `The request names "${ctx.requirementHolderName}" but the certificate is addressed to "${ctx.holderName}".`,
          };
    },
  },
  {
    id: "endorsement-backing-verified",
    name: "Endorsement Backing Verified",
    description:
      "Every checked endorsement box is verified per-endorsement against the schedule of record, with edition date as part of form identity — CG 20 10 04 13 is not CG 20 10 10 01. A scheduled (non-blanket) Additional Insured claim additionally requires the holder's endorsement to be bound: Bind Requested is not bound.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      const problems: string[] = [];
      for (const claim of ctx.endorsementClaims) {
        const kind = claim.flag === "additionalInsured" ? "ai" : "wos";
        const backing = findEndorsement(claim.set, kind);
        const label =
          claim.flag === "additionalInsured"
            ? "Additional Insured"
            : "Waiver Of Subrogation";
        if (!backing) {
          problems.push(
            `${claim.policy.policyNumber}: no ${label} endorsement on the schedule of record.`,
          );
          continue;
        }
        if (!backing.form.trim() || !backing.edition.trim()) {
          problems.push(
            `${claim.policy.policyNumber}: the ${label} endorsement "${backing.title}" lacks a full form identity (form number and edition date). Form identity without the edition certifies the wrong paper.`,
          );
          continue;
        }
        if (
          claim.flag === "additionalInsured" &&
          backing.scope === "scheduled"
        ) {
          const bound = ctx.holderAiRecords.some((r) => r.status === "bound");
          if (!bound) {
            const nearest = ctx.holderAiRecords[0];
            problems.push(
              `${claim.policy.policyNumber}: ${backing.form} ${backing.edition} is a scheduled endorsement and the holder's Additional Insured request is ${
                nearest ? `"${nearest.status}"` : "not on the registry"
              } — Bind Requested is not bound.`,
            );
          }
        }
      }
      return problems.length === 0
        ? {
            ok: true,
            detail:
              ctx.endorsementClaims.length === 0
                ? "No endorsement boxes claimed."
                : "Every claimed endorsement is backed by a fully identified, in-standing form.",
          }
        : { ok: false, detail: problems.join(" ") };
    },
  },
  {
    id: "carrier-knowledge-restrictions",
    name: "Carrier Knowledge Restrictions",
    description:
      "Enforceable carrier-knowledge registry entries gate every claimed provision: a status a carrier will never grant (e.g. Additional Insured on an ISC excess line) cannot attach to the certificate. A failure cites the knowledge entry id and title and cannot be overridden — the restriction is the carrier's, not the desk's.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      const problems: string[] = [];
      for (const claim of ctx.endorsementClaims) {
        for (const hit of evaluateKnowledgeForCertSection({
          policy: claim.policy,
          flags: { [claim.flag]: true },
          account: { state: ctx.account.state, industry: ctx.account.industry },
        })) {
          problems.push(
            `${claim.policy.policyNumber}: ${hit.entry.title} — ${hit.entry.detail} [Carrier Knowledge: ${hit.entry.id}]`,
          );
        }
      }
      return problems.length === 0
        ? {
            ok: true,
            detail:
              "No claimed provision is forbidden by the carrier knowledge registry.",
          }
        : { ok: false, detail: problems.join(" ") };
    },
  },
  {
    id: "source-document-trust",
    name: "Source Document Trust Order",
    description:
      "Coverage facts come from the schedule of record in trust order: policy over binder over quote. A prior certificate is never a source — wrong language on one cert must not propagate to the next.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      const fromCert = ctx.scheduleSources.filter((s) => s.kind === "coi");
      return fromCert.length === 0
        ? { ok: true, detail: "No schedule fact traces to a prior certificate." }
        : {
            ok: false,
            detail:
              "The schedule of record carries facts sourced from a prior certificate. Re-source them from the policy, binder, or quote before issuing.",
          };
    },
  },
  {
    id: "source-document-rank",
    name: "Quote-Only Sourcing Flagged",
    description:
      "When the best source document behind a schedule is a quote (rank below policy and binder), issuance requires an attributed override acknowledging the quote-grade sourcing.",
    severity: "blocking",
    overridable: true,
    evaluate: (ctx) => {
      const ranked = ctx.scheduleSources.filter(
        (s) => s.kind != null && s.kind in SOURCE_TRUST_ORDER,
      );
      if (ranked.length === 0) {
        return {
          ok: true,
          detail: "Schedule sourced from the curated policy library.",
        };
      }
      const best = Math.min(...ranked.map((s) => SOURCE_TRUST_ORDER[s.kind!]));
      return best <= SOURCE_TRUST_ORDER.binder
        ? { ok: true, detail: "Schedule backed by policy or binder paper." }
        : {
            ok: false,
            detail:
              "The strongest source document behind this schedule is a quote. Policy or binder paper outranks it; issuing on quote paper needs an attributed override.",
          };
    },
  },
  {
    id: "source-document-age",
    name: "Source Document Age",
    description: `A source document older than ${SOURCE_AGE_LIMIT_DAYS} days needs a re-pull or an attributed override — stale paper is how lapsed endorsements get certified.`,
    severity: "blocking",
    overridable: true,
    evaluate: (ctx) => {
      const cutoff = new Date(ctx.now).getTime() - SOURCE_AGE_LIMIT_DAYS * 86_400_000;
      const stale = ctx.scheduleSources.filter(
        (s) => s.createdAt != null && new Date(s.createdAt).getTime() < cutoff,
      );
      return stale.length === 0
        ? { ok: true, detail: "No source document exceeds the age limit." }
        : {
            ok: false,
            detail: `${stale.length} source document(s) predate the ${SOURCE_AGE_LIMIT_DAYS}-day limit.`,
          };
    },
  },
  {
    id: "snapshot-current",
    name: "Fact Snapshot Current",
    description:
      "Issuance binds to a frozen fact snapshot taken at the send moment. A prepared artifact whose snapshot digest no longer matches current facts, has passed its TTL, or was invalidated by an upstream change cannot be sent — the certificate regenerates from current facts instead.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      if (!ctx.prepared) {
        return {
          ok: true,
          detail: "Fresh snapshot taken at the send moment; nothing prepared to go stale.",
        };
      }
      if (ctx.prepared.invalidatedAt) {
        return {
          ok: false,
          detail: "The prepared artifact was invalidated by an upstream fact change. Regenerate from current facts.",
        };
      }
      if (new Date(ctx.prepared.expiresAt).getTime() < new Date(ctx.now).getTime()) {
        return {
          ok: false,
          detail: "The prepared artifact passed its TTL. Regenerate from current facts.",
        };
      }
      if (ctx.prepared.digest !== ctx.currentDigest) {
        return {
          ok: false,
          detail: "Upstream facts changed since the artifact was prepared — the snapshot digest no longer matches. Regenerate from current facts.",
        };
      }
      return { ok: true, detail: "Prepared snapshot matches current facts and is inside its TTL." };
    },
  },
  {
    id: "garage-form-fit",
    name: "Garage Risk On The Garage Form",
    description:
      "Garagekeepers coverage can only be evidenced on an ACORD 30 (Certificate of Garage Insurance). An ACORD 25 has no garagekeepers block — the basis (legal liability vs direct primary/excess), the perils, and the per-location limits have nowhere to print, so the coverage would leave the desk unstated. Switch the form rather than issue a certificate that drops it.",
    severity: "blocking",
    overridable: false,
    evaluate: (ctx) => {
      if (ctx.formKey === "acord30") {
        return { ok: true, detail: "Issued on ACORD 30 — garage blocks available." };
      }
      const garage = ctx.policies.filter((p) =>
        (ctx.formSets[p.id]?.limits ?? []).some((l) => l.slot.startsWith("gk_")),
      );
      return garage.length === 0
        ? { ok: true, detail: "No garagekeepers coverage on the selected policies." }
        : {
            ok: false,
            detail: `${garage
              .map((p) => p.policyNumber)
              .join(", ")} carries garagekeepers, which an ACORD 25 cannot evidence. Issue this certificate on the ACORD 30.`,
          };
    },
  },
  {
    id: "holder-address-on-file",
    name: "Holder Address On File",
    description:
      "Advisory: the holder block should carry a mailing address. Issuance proceeds, but the certificate delivers better with one.",
    severity: "advisory",
    overridable: true,
    evaluate: (ctx) => ({
      ok: ctx.holderAddress.trim().length > 0,
      detail: ctx.holderAddress.trim()
        ? "Holder address present."
        : "No holder address on the certificate.",
    }),
  },
];

export type CertCheckStatus = "pass" | "fail" | "overridden";

export interface CertCheckResult {
  id: string;
  name: string;
  severity: CertCheckSeverity;
  overridable: boolean;
  status: CertCheckStatus;
  detail: string;
  overriddenBy?: string;
  overrideReason?: string;
}

export interface CheckOverrideRequest {
  checkId: string;
  reason: string;
}

/**
 * Run the canonical registry (plus any path-appended checks) and apply
 * override requests. Overrides only ever clear a failure on a check that is
 * structurally overridable AND carries an operator and a written reason —
 * there is no second path around a non-overridable check.
 */
export function runCertChecks(input: {
  ctx: CertCheckContext;
  appendChecks?: CertCheckDef[];
  overrides?: CheckOverrideRequest[];
  operator?: string;
}): CertCheckResult[] {
  const defs = [...CERT_CHECK_REGISTRY, ...(input.appendChecks ?? [])];
  const byId = new Map(
    (input.overrides ?? [])
      .filter((o) => o.reason.trim().length > 0)
      .map((o) => [o.checkId, o.reason.trim()]),
  );
  return defs.map((def) => {
    const { ok, detail } = def.evaluate(input.ctx);
    if (ok) {
      return {
        id: def.id,
        name: def.name,
        severity: def.severity,
        overridable: def.overridable,
        status: "pass" as const,
        detail,
      };
    }
    const reason = byId.get(def.id);
    if (def.overridable && reason && input.operator) {
      return {
        id: def.id,
        name: def.name,
        severity: def.severity,
        overridable: def.overridable,
        status: "overridden" as const,
        detail,
        overriddenBy: input.operator,
        overrideReason: reason,
      };
    }
    return {
      id: def.id,
      name: def.name,
      severity: def.severity,
      overridable: def.overridable,
      status: "fail" as const,
      detail,
    };
  });
}

/** Blocking failures — advisory checks never gate issuance. */
export function blockingFailures(results: CertCheckResult[]): CertCheckResult[] {
  return results.filter((r) => r.status === "fail" && r.severity === "blocking");
}
