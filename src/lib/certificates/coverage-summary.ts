import { resolveCertSheet } from "./acord25";
import { displayLimit } from "./cert-review";
import { buildCertificatePacket } from "./certificate";
import type { PolicyFormSet } from "./forms";
import type { Account, Policy } from "../types";

/**
 * Compact, serializable coverage summary for the floating on-page rail.
 * Runs the same resolver the certificate sheet uses — one source of truth —
 * then regroups the resolved boxes per policy so the rail can never
 * disagree with the sheet or with What The Paper Says.
 */

export interface CoverageSummaryLine {
  label: string;
  /** displayLimit output — dollars, "Included", or "Excluded" */
  value: string;
}

export interface CoverageSummaryBlock {
  name: string;
  lines: CoverageSummaryLine[];
  /** True when this coverage prints as a Description Of Operations line */
  overflow?: boolean;
}

export interface CoverageSummaryPolicy {
  policyId: string;
  policyNumber: string;
  carrier: string;
  /** Insurer letter this policy prints under, when it feeds the sheet */
  letter: string | null;
  effectiveDate: string;
  expirationDate: string;
  blocks: CoverageSummaryBlock[];
}

export function buildCoverageSummary(
  account: Account,
  policies: Policy[],
  formSets: Record<string, PolicyFormSet>,
): CoverageSummaryPolicy[] {
  if (policies.length === 0) return [];

  const packet = buildCertificatePacket({
    account,
    policies,
    formSets,
    holderName: "",
    holderAddress: "",
  });
  const hasGarage = policies.some(
    (p) =>
      p.coverages.some((c) => /garage|^GK$/i.test(c)) ||
      (formSets[p.id]?.coverages ?? []).some((c) => /garage/i.test(c.label)),
  );
  const sheet = resolveCertSheet(
    hasGarage ? "acord30" : "acord25",
    packet.sections,
  );

  return policies.map((policy) => {
    const letter =
      packet.sections.find((s) => s.policy.id === policy.id)?.insurerLetter ??
      null;

    const blocks: CoverageSummaryBlock[] = [];
    for (const rs of sheet.sections) {
      if (rs.feeder?.policy.id !== policy.id) continue;
      blocks.push({
        name: rs.def.name,
        lines: rs.def.limitBoxes
          .filter((b) => b.slot != null)
          .map((b) => ({
            label: rs.locs[b.key] ? `${b.label} (${rs.locs[b.key]})` : b.label,
            value: displayLimit(rs.limits[b.key]),
          })),
      });
    }
    for (const row of sheet.others) {
      if (row.feeder?.policy.id !== policy.id || !row.label) continue;
      blocks.push({
        name: row.label,
        lines: row.lines.map((l) => ({
          label: l.label,
          value: displayLimit(l.value),
        })),
      });
    }
    for (const line of sheet.overflow) {
      if (line.row.feeder?.policy.id !== policy.id || !line.coverage) continue;
      blocks.push({
        name: line.coverage,
        lines: line.row.lines.map((l) => ({
          label: l.label,
          value: displayLimit(l.value),
        })),
        overflow: true,
      });
    }

    return {
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      carrier: policy.carrier,
      letter,
      effectiveDate: policy.effectiveDate,
      expirationDate: policy.expirationDate,
      blocks,
    };
  });
}
