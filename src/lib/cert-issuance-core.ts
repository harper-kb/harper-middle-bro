import type Database from "better-sqlite3";
import type { CertFormKey, PlacementMap } from "./acord25";
import {
  blockingFailures,
  runCertChecks,
  type CertCheckDef,
  type CertCheckResult,
  type CheckOverrideRequest,
  type EndorsementClaim,
  type HolderAiRecord,
  type ScheduleSource,
} from "./cert-checks";
import {
  getLivePrepared,
  invalidatePreparedRow,
  issueCert,
  recordIssueAttempt,
  requirementKeyFor,
  type IssueAttemptRecord,
  type IssuedCertRecord,
} from "./cert-ledger";
import { effBool, verifyEditedSheet, type SheetOverrides } from "./cert-review";
import {
  buildDraftSnapshot,
  buildFactSnapshot,
  type FactSnapshot,
} from "./cert-snapshot";
import { verifyCoi, type CoiDraft } from "./coi";
import type { PolicyFormSet } from "./forms";
import type { Account, Policy } from "./types";

/**
 * The single issuance path. Every certificate that leaves the system —
 * studio, batch run, or ticket — comes through `performCertIssuance`. There
 * is no other function that writes a row into `cert_issued`, and nothing
 * sends a certificate that has no row there.
 *
 * The core is deliberately free of server-only imports: the server actions
 * in cert-issue.ts resolve the session, database handle, red-alert state,
 * and registry rows, then hand everything here. The harness drives the same
 * function against an in-memory database — the path under test is the path
 * in production.
 *
 * Path-specific logic may only APPEND checks (`appendChecks`); the canonical
 * registry always runs in full. That is the structural guarantee that no
 * route is wider than another.
 */

export type IssuanceArtifact =
  | {
      kind: "sheet";
      formKey: CertFormKey;
      placements: PlacementMap;
      overrides: SheetOverrides;
      projectWording?: string;
    }
  | { kind: "draft"; draft: CoiDraft };

export interface IssuanceInput {
  db: Database.Database;
  now?: string;
  operator: string;
  path: "studio" | "run" | "ticket";
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
  holderName: string;
  holderAddress: string;
  artifact: IssuanceArtifact;
  ticketId?: string | null;
  /** Holder name the originating service request carries, when one exists */
  requirementHolderName?: string | null;
  /** Resolved at the send moment by the caller */
  redAlertActive: boolean;
  holderAiRecords: HolderAiRecord[];
  scheduleSources: ScheduleSource[];
  checkOverrides?: CheckOverrideRequest[];
  /** Path-specific checks — appended to the canonical registry, never replacing it */
  appendChecks?: CertCheckDef[];
}

export type IssuanceOutcome =
  | {
      issued: true;
      cert: IssuedCertRecord;
      attempt: IssueAttemptRecord;
      results: CertCheckResult[];
    }
  | {
      issued: false;
      attempt: IssueAttemptRecord;
      results: CertCheckResult[];
    };

/** Effective endorsement claims off the artifact being issued. */
function claimsOf(
  input: IssuanceInput,
  bundleSheetClaims: EndorsementClaim[] | null,
): EndorsementClaim[] {
  if (input.artifact.kind === "draft") {
    const policy = input.policies[0];
    const set = input.formSets[policy.id] ?? {
      coverages: [],
      limits: [],
      endorsements: [],
    };
    const claims: EndorsementClaim[] = [];
    if (input.artifact.draft.flags.additionalInsured) {
      claims.push({ policy, set, flag: "additionalInsured" });
    }
    if (input.artifact.draft.flags.subrogationWaived) {
      claims.push({ policy, set, flag: "subrogationWaived" });
    }
    return claims;
  }
  return bundleSheetClaims ?? [];
}

export function performCertIssuance(input: IssuanceInput): IssuanceOutcome {
  const now = input.now ?? new Date().toISOString();
  const requirementKey = requirementKeyFor({
    ticketId: input.ticketId,
    holderName: input.holderName,
  });

  // Assemble the frozen snapshot and the path verifier's verdict off the
  // exact artifact being issued.
  let snapshot: FactSnapshot;
  let verifierRejects: { id: string; title: string }[];
  let sheetClaims: EndorsementClaim[] | null = null;
  let description: string;

  if (input.artifact.kind === "sheet") {
    const bundle = buildFactSnapshot({
      account: input.account,
      policies: input.policies,
      formSets: input.formSets,
      formKey: input.artifact.formKey,
      placements: input.artifact.placements,
      holderName: input.holderName,
      holderAddress: input.holderAddress,
      overrides: input.artifact.overrides,
      projectWording: input.artifact.projectWording,
      takenAt: now,
    });
    snapshot = bundle.snapshot;
    description = bundle.snapshot.description;
    const verdict = verifyEditedSheet({
      account: input.account,
      packet: bundle.packet,
      sheet: bundle.sheet,
      overrides: input.artifact.overrides,
    });
    verifierRejects = verdict.rejects.map((r) => ({
      id: r.finding.id,
      title: r.finding.title,
    }));
    const claims: EndorsementClaim[] = [];
    const seen = new Set<string>();
    const collect = (
      sec: string,
      feeder: { policy: Policy; set: PolicyFormSet } | null,
      ref: { additionalInsured: boolean; subrogationWaived: boolean } | null,
    ) => {
      if (!feeder || !ref) return;
      const ov = input.artifact.kind === "sheet" ? input.artifact.overrides : {};
      for (const [flag, base, suffix] of [
        ["additionalInsured", ref.additionalInsured, "addl"],
        ["subrogationWaived", ref.subrogationWaived, "subr"],
      ] as const) {
        if (!effBool(ov, `${sec}.${suffix}`, base)) continue;
        const key = `${feeder.policy.id}:${flag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push({ policy: feeder.policy, set: feeder.set, flag });
      }
    };
    for (const rs of bundle.sheet.sections) collect(rs.def.key, rs.feeder, rs.ref);
    bundle.sheet.others.forEach((row, i) => collect(`other${i}`, row.feeder, row.ref));
    sheetClaims = claims;
  } else {
    const policy = input.policies[0];
    snapshot = buildDraftSnapshot({
      draft: input.artifact.draft,
      policy,
      takenAt: now,
    });
    description = input.artifact.draft.description;
    const verdict = verifyCoi(input.artifact.draft, {
      account: input.account,
      policy,
      set: input.formSets[policy.id],
    });
    verifierRejects = verdict.rejects.map((r) => ({ id: r.id, title: r.title }));
  }

  // Prepared-artifact staleness: measured against the snapshot clock at the
  // send moment. A stale one is invalidated on the spot and the attempt
  // blocks on Fact Snapshot Current — the retry regenerates from current
  // facts, which is exactly the forced-regeneration rule.
  const prepared = getLivePrepared(input.db, input.account.id, requirementKey);
  if (prepared) {
    if (new Date(prepared.expiresAt).getTime() < new Date(now).getTime()) {
      invalidatePreparedRow(input.db, prepared.id, "TTL Expired At Send");
    } else if (prepared.snapshotDigest !== snapshot.digest) {
      invalidatePreparedRow(
        input.db,
        prepared.id,
        "Upstream Facts Changed Since Preparation",
      );
    }
  }

  const results = runCertChecks({
    ctx: {
      account: input.account,
      policies: input.policies,
      holderName: input.holderName,
      holderAddress: input.holderAddress,
      now,
      verifierRejects,
      redAlertActive: input.redAlertActive,
      endorsementClaims: claimsOf(input, sheetClaims),
      holderAiRecords: input.holderAiRecords,
      requirementHolderName: input.requirementHolderName ?? null,
      scheduleSources: input.scheduleSources,
      prepared: prepared
        ? {
            digest: prepared.snapshotDigest,
            expiresAt: prepared.expiresAt,
            invalidatedAt: prepared.invalidatedAt,
          }
        : null,
      currentDigest: snapshot.digest,
    },
    appendChecks: input.appendChecks,
    overrides: input.checkOverrides,
    operator: input.operator,
  });

  const blocked = blockingFailures(results);
  const attempt = recordIssueAttempt(input.db, {
    accountId: input.account.id,
    ticketId: input.ticketId ?? null,
    requirementKey,
    holderName: input.holderName,
    path: input.path,
    outcome: blocked.length === 0 ? "issued" : "blocked",
    results,
    attemptedBy: input.operator,
    attemptedAt: now,
  });

  if (blocked.length > 0) {
    return { issued: false, attempt, results };
  }

  const cert = issueCert(input.db, {
    accountId: input.account.id,
    ticketId: input.ticketId ?? null,
    requirementKey,
    holderName: input.holderName,
    holderAddress: input.holderAddress,
    formKey: input.artifact.kind === "sheet" ? input.artifact.formKey : "acord25",
    policyNumbers: input.policies.map((p) => p.policyNumber),
    description,
    snapshot,
    attemptId: attempt.id,
    issuedBy: input.operator,
    issuedAt: now,
  });
  return { issued: true, cert, attempt, results };
}
