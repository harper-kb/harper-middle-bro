/**
 * Turn `data policy-state read` rows into the desk's book.
 *
 * Shared deliberately: the offline importer and the runtime sync must
 * produce the same book from the same rows, or "refresh from Harper" would
 * quietly mean something different from "import the export I inspected".
 * Pure — no I/O, no network, no database.
 */

import type { PolicyFormSet } from "../../forms";
import { UNASSIGNED_UNDERWRITER } from "../../supabase-book.server";
import type { Account, Policy } from "../../types";
import {
  mapAccount,
  mapEndorsements,
  mapPolicy,
  type HarperExtraction,
  type HarperPolicyRow,
  type HarperPrefill,
} from "./policy-state";
import { unmatchedMarket } from "./market";
import {
  industryFromCompany,
  prefillFromCompany,
  type HarperCompany,
} from "./company";

export interface BuiltBook {
  accounts: Account[];
  policies: Policy[];
  schedules: Record<string, PolicyFormSet>;
  /** What the rows could not say, reported rather than papered over. */
  stats: {
    skipped: number;
    unscheduled: number;
    endorsements: number;
    /** Endorsements that can back an AI or waiver claim on a certificate. */
    backing: number;
    droppedLimits: string[];
    endorsementsWithoutIdentity: string[];
    /** Accounts opened on a real market desk rather than the placeholder. */
    placed: number;
    /** Numbers that look like a brand's but sit on paper it is not known to
     * write — reported, because either the brand added a fronting carrier or
     * the prefix means something else. */
    unplaced: string[];
  };
}

export function buildBookFromRows(
  rows: HarperPolicyRow[],
  opts: {
    prefills?: Record<string, HarperPrefill>;
    extractions?: Record<string, HarperExtraction>;
    /** Company records, keyed by company id — the insured's address. */
    companies?: Record<string, HarperCompany>;
  } = {},
): BuiltBook {
  const prefills = opts.prefills ?? {};
  const extractions = opts.extractions ?? {};
  const companies = opts.companies ?? {};

  const accounts = new Map<string, Account>();
  const policies: Policy[] = [];
  const schedules: Record<string, PolicyFormSet> = {};
  const droppedLimits: string[] = [];
  const endorsementsWithoutIdentity: string[] = [];
  let skipped = 0;
  let unscheduled = 0;
  let endorsements = 0;
  let backing = 0;
  let placed = 0;
  const unplaced: string[] = [];

  for (const row of rows) {
    const companyId = row.company_id?.trim();
    if (!companyId) {
      skipped++;
      continue;
    }
    const accountId = `acct-h-${companyId}`;
    const mapped = mapPolicy(row, accountId);
    if (!mapped) {
      skipped++;
      continue;
    }

    if (!accounts.has(accountId)) {
      accounts.set(
        accountId,
        mapAccount({
          companyId,
          // The mechanical prefill is the better source where it exists —
          // it is the insured as the application states them. The company
          // record is the fallback, and in practice the only one on hand.
          prefill:
            prefills[companyId] ??
            (companies[companyId] ? prefillFromCompany(companies[companyId]) : null),
          industry: companies[companyId] ? industryFromCompany(companies[companyId]) : null,
          fallbackName: row.named_insured?.trim() || `Company ${companyId}`,
          // The market its policy resolves to, so the account opens on a desk
          // that can actually be reached. Falls back to the placeholder, which
          // says plainly that no contact is on file.
          underwriterId: mapped.market?.underwriterId ?? UNASSIGNED_UNDERWRITER.id,
        }),
      );
    }

    // The endorsement schedule, when a parsed policy document is on hand.
    // Without it the Additional Insured and Waiver Of Subrogation boxes have
    // nothing backing them and the presend registry refuses to certify
    // either — correctly, but on missing evidence rather than on the paper.
    const extraction = extractions[row.policy_id ?? ""] ?? null;
    if (extraction) {
      const mappedEndts = mapEndorsements(extraction);
      mapped.set.endorsements = mappedEndts.endorsements;
      endorsements += mappedEndts.endorsements.length;
      backing += mappedEndts.endorsements.filter(
        (e) => e.kind === "ai" || e.kind === "wos",
      ).length;
      for (const w of mappedEndts.withoutIdentity) {
        endorsementsWithoutIdentity.push(`${mapped.policy.policyNumber}: ${w}`);
      }
    }

    if (mapped.market) placed++;
    else {
      const odd = unmatchedMarket(mapped.policy.policyNumber, mapped.policy.quoteCarrier);
      if (odd) unplaced.push(`${mapped.policy.policyNumber}: ${odd.brand}? on ${odd.paper}`);
    }

    policies.push(mapped.policy);
    schedules[mapped.policy.id] = mapped.set;
    if (mapped.set.unscheduled) unscheduled++;
    for (const d of mapped.droppedLimits) {
      droppedLimits.push(`${mapped.policy.policyNumber} ${d.coverage} ${d.type}: ${d.label}`);
    }
  }

  return {
    accounts: [...accounts.values()],
    policies,
    schedules,
    stats: {
      skipped,
      unscheduled,
      endorsements,
      backing,
      droppedLimits,
      endorsementsWithoutIdentity,
      placed,
      unplaced,
    },
  };
}
