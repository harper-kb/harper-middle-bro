import { evaluateKnowledgeForCertSection } from "./carrier-knowledge";
import {
  buildDraftFromPolicy,
  verifyCoi,
  FLAG_LABELS,
  type CoiDraft,
  type CoiFinding,
  type CoiFlags,
  type CoiVerdict,
} from "./coi";
import type { PolicyFormSet } from "./forms";
import { naicForPolicy } from "./naic";
import type { Account, Policy, RequestTypeId } from "./types";

/**
 * Certificate packet — the whole ACORD 25 sheet, composed from policy
 * schedules of record. One section per policy, correct by construction:
 * every limit and every checked box comes off the coverage tab, then the
 * same verifier that gates ticket certs re-checks the result.
 *
 * Pure module. The form sets are resolved server-side (SQLite is the
 * schedule of record) and passed in, so a client preview can't drift.
 */

export interface CertSection {
  policy: Policy;
  set: PolicyFormSet;
  draft: CoiDraft;
  verdict: CoiVerdict;
  /** ACORD insurer letter (A, B, C…) shared by policies on the same paper */
  insurerLetter: string;
}

export interface CertInsurer {
  letter: string;
  /** Brand on the policy record (Kinsale, Coterie, …) */
  carrier: string;
  /**
   * Issuing company legal name + NAIC code from the verified registry
   * (docs/acord-forms-research.md §3). The INSURER line prints the issuing
   * company, never the MGA; null → the brand prints and the NAIC cell
   * stays blank (unverified codes are never shown).
   */
  issuingCompany: string | null;
  naic: string | null;
  /** Provenance note (e.g. Coterie is the MGA; paper is Spinnaker) */
  naicNote?: string;
}

export interface CertFindingWithContext {
  policyNumber: string;
  carrier: string;
  finding: CoiFinding;
}

export interface CertificatePacket {
  account: Account;
  holderName: string;
  holderAddress: string;
  insurers: CertInsurer[];
  sections: CertSection[];
  /** Deduped combined Description Of Operations for the single ACORD box */
  description: string;
  rejects: CertFindingWithContext[];
  warns: CertFindingWithContext[];
  okToIssue: boolean;
}

/** The printed ACORD insurer block carries exactly six lines, A–F. */
const LETTERS = "ABCDEF";

export function buildCertificatePacket(input: {
  account: Account;
  policies: Policy[];
  /** Schedule of record per policy id, resolved server-side */
  formSets: Record<string, PolicyFormSet>;
  holderName: string;
  holderAddress: string;
  projectWording?: string;
}): CertificatePacket {
  const insurers: CertInsurer[] = [];
  // Letters are shared per writing paper, not per brand: two ISC (MGA)
  // policies issued on different writers are different insurers and must
  // carry different letters. The key is the resolved issuing company when
  // known, else the brand.
  const letterByPaper = new Map<string, string>();
  // Case-folded: a book keyed by hand carries the same writer in two
  // spellings, and two letters for one company certifies two insurers that
  // do not exist.
  const paperKey = (p: Policy) => {
    const identity = naicForPolicy(p.carrier, p.coverages, p.issuingCarrier);
    return (identity?.issuingCompany ?? p.carrier).trim().toLowerCase();
  };
  for (const p of input.policies) {
    const key = paperKey(p);
    if (!letterByPaper.has(key)) {
      // Beyond F there is no printed insurer line — the letter stays blank
      // (claims nothing) and issuing is refused below, never a phantom "G".
      const letter = LETTERS[insurers.length] ?? "";
      letterByPaper.set(key, letter);
      const identity = naicForPolicy(p.carrier, p.coverages, p.issuingCarrier);
      insurers.push({
        letter,
        carrier: p.carrier,
        issuingCompany: identity?.issuingCompany ?? null,
        naic: identity?.naic ?? null,
        naicNote: identity?.note,
      });
    }
  }

  const sections: CertSection[] = input.policies.map((policy, i) => {
    const set = input.formSets[policy.id] ?? {
      coverages: [],
      limits: [],
      endorsements: [],
    };
    const draft = buildDraftFromPolicy({
      account: input.account,
      policy,
      holderName: input.holderName,
      holderAddress: input.holderAddress,
      // Project wording belongs on the sheet once, not once per policy
      projectWording: i === 0 ? input.projectWording : undefined,
      set,
    });
    const verdict = verifyCoi(draft, { account: input.account, policy, set });
    return {
      policy,
      set,
      draft,
      verdict,
      insurerLetter: letterByPaper.get(paperKey(policy))!,
    };
  });

  // One description box on the sheet: keep each distinct sentence once.
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const s of sections) {
    for (const raw of s.draft.description.split(/(?<=\.)\s+/)) {
      const sentence = raw.trim();
      if (!sentence || seen.has(sentence)) continue;
      seen.add(sentence);
      sentences.push(sentence);
    }
  }

  const withContext = (severity: "reject" | "warn"): CertFindingWithContext[] =>
    sections.flatMap((s) =>
      s.verdict.findings
        .filter((f) => f.severity === severity)
        .map((finding) => ({
          policyNumber: s.policy.policyNumber,
          carrier: s.policy.carrier,
          finding,
        })),
    );

  const rejects = withContext("reject");

  // Carrier knowledge gate: a provision forbidden by an enforceable registry
  // entry (ISC excess lines take no Additional Insured) must never attach to
  // a matching section. The reject is visible and cites the entry id + title
  // — the block reason travels with the packet record.
  for (const s of sections) {
    for (const hit of evaluateKnowledgeForCertSection({
      policy: s.policy,
      flags: s.draft.flags,
      account: { state: input.account.state, industry: input.account.industry },
    })) {
      rejects.push({
        policyNumber: s.policy.policyNumber,
        carrier: s.policy.carrier,
        finding: {
          id: `carrier-knowledge-${hit.entry.id}`,
          severity: "reject",
          field: "flags",
          title: `Forbidden By Carrier Knowledge — ${hit.entry.title}`,
          detail: `${FLAG_LABELS[hit.flag]} cannot attach to ${s.policy.carrier} ${s.policy.policyNumber}. ${hit.entry.detail} [Carrier Knowledge: ${hit.entry.id}]`,
          fix: `Remove the ${FLAG_LABELS[hit.flag]} provision from this line. ${hit.entry.consequence}`,
        },
      });
    }
  }

  // More carriers than the form's six insurer lines: the extra carrier's
  // sections would cite an insurer the sheet can't print. Refuse to issue —
  // split the certificate or attach an ACORD 101.
  for (const ins of insurers) {
    if (ins.letter !== "") continue;
    const anchor = input.policies.find((p) => p.carrier === ins.carrier)!;
    rejects.push({
      policyNumber: anchor.policyNumber,
      carrier: ins.carrier,
      finding: {
        id: `insurer-overflow-${ins.carrier}`,
        severity: "reject",
        field: "policy",
        title: "More Insurers Than The Form Carries",
        detail: `${ins.carrier} has no insurer line left — the printed block holds six insurers (A–F).`,
        fix: "Split the certificate by carrier, or attach an ACORD 101 for the additional insurers.",
      },
    });
  }

  return {
    account: input.account,
    holderName: input.holderName,
    holderAddress: input.holderAddress,
    insurers,
    sections,
    description: sentences.join(" "),
    rejects,
    warns: withContext("warn"),
    okToIssue: rejects.length === 0 && input.holderName.trim().length > 0,
  };
}

/**
 * Which service request a missing cert checkbox turns into — used to look
 * up price guidance when a flag has no backing form. Only unambiguous
 * mappings; anything else stays unmapped rather than showing the wrong
 * history.
 */
export const FLAG_REQUEST_TYPE: Partial<Record<keyof CoiFlags, RequestTypeId>> = {
  additionalInsured: "additional_insured",
  subrogationWaived: "waiver_of_subrogation",
  primaryNonContributory: "primary_non_contributory",
  noticeOfCancellation: "notice_cancellation_30",
};
