import {
  findEndorsement,
  findEndorsementByTitle,
  getPolicyFormSet,
  limitMode,
  limitSlotLabel,
  type EndorsementKind,
  type LimitSlot,
  type PolicyFormSet,
} from "./forms";
import { issuingCompaniesFor } from "./naic";
import type { Account, Policy } from "./types";

/**
 * Certificate check — structured, not summarized.
 *
 * A certificate is a standardized form, so every box on it maps to something
 * we already know: a limit on the coverage tab or an endorsement form on the
 * schedule. Anything the cert claims that the policy can't back is a reject,
 * including free text in Description Of Operations, which is where coverage
 * gets promised by accident.
 */

export type CoiField =
  | "holder"
  | "insured"
  | "policy"
  | "term"
  | "limits"
  | "flags"
  | "description";

export type CoiSeverity = "reject" | "warn";

export interface CoiFinding {
  id: string;
  severity: CoiSeverity;
  field: CoiField;
  title: string;
  detail: string;
  /** What would make this pass */
  fix?: string;
  /** Endorsement that would have to be on the policy */
  requiresForm?: string;
  /** Offending span in Description Of Operations, for inline highlighting */
  match?: { text: string; start: number; end: number };
}

export interface CoiFlags {
  additionalInsured: boolean;
  subrogationWaived: boolean;
  primaryNonContributory: boolean;
  completedOperations: boolean;
  noticeOfCancellation: boolean;
  perProjectAggregate: boolean;
}

export interface CoiDraft {
  holderName: string;
  holderAddress: string;
  insuredName: string;
  policyNumber: string;
  carrier: string;
  effectiveDate: string;
  expirationDate: string;
  /** Cents, keyed by ACORD box */
  limits: Partial<Record<LimitSlot, number>>;
  flags: CoiFlags;
  description: string;
}

export interface CoiVerdict {
  findings: CoiFinding[];
  rejects: CoiFinding[];
  warns: CoiFinding[];
  okToIssue: boolean;
}

export const FLAG_LABELS: Record<keyof CoiFlags, string> = {
  additionalInsured: "Additional Insured",
  subrogationWaived: "Waiver Of Subrogation",
  primaryNonContributory: "Primary & Noncontributory",
  completedOperations: "Completed Operations",
  noticeOfCancellation: "30-Day Notice Of Cancellation",
  perProjectAggregate: "Per Project Aggregate",
};

/** Each checkbox has to be earned by a form on the schedule. */
const FLAG_BACKING: Record<
  keyof CoiFlags,
  { kind?: EndorsementKind; title?: RegExp; need: string }
> = {
  additionalInsured: { kind: "ai", need: "an Additional Insured endorsement" },
  subrogationWaived: { kind: "wos", need: "a Waiver Of Subrogation endorsement" },
  primaryNonContributory: { kind: "pnc", need: "a Primary & Noncontributory endorsement" },
  completedOperations: {
    title: /completed operations/i,
    need: "a Completed Operations AI form (e.g. CG 20 37)",
  },
  noticeOfCancellation: {
    title: /notice of cancellation/i,
    need: "a Notice Of Cancellation endorsement",
  },
  perProjectAggregate: {
    title: /per project/i,
    need: "a Designated Construction Project Aggregate form (e.g. CG 25 03)",
  },
};

interface GrantRule {
  id: string;
  re: RegExp;
  label: string;
  kind?: EndorsementKind;
  title?: RegExp;
  need: string;
}

/** Description language that silently grants coverage. */
const GRANT_RULES: GrantRule[] = [
  {
    id: "pnc",
    re: /primary\s+(and|&|\/)\s*non-?\s?contributory/gi,
    label: "Primary & Noncontributory",
    kind: "pnc",
    need: "a Primary & Noncontributory endorsement",
  },
  {
    id: "wos",
    re: /waiv\w*\s+of\s+subrogation/gi,
    label: "Waiver Of Subrogation",
    kind: "wos",
    need: "a Waiver Of Subrogation endorsement",
  },
  {
    id: "ai",
    re: /additional\s+insured/gi,
    label: "Additional Insured",
    kind: "ai",
    need: "an Additional Insured endorsement",
  },
  {
    id: "completed-ops",
    re: /completed\s+operations/gi,
    label: "Completed Operations",
    title: /completed operations/i,
    need: "a Completed Operations AI form (e.g. CG 20 37)",
  },
  {
    id: "notice",
    re: /\b(30|thirty)[- ]?days?\b[^.]{0,40}?\bnotice\b/gi,
    label: "Notice Of Cancellation",
    title: /notice of cancellation/i,
    need: "a Notice Of Cancellation endorsement",
  },
  {
    id: "per-project",
    re: /per[- ]project\s+aggregate/gi,
    label: "Per Project Aggregate",
    title: /per project/i,
    need: "a Designated Construction Project Aggregate form",
  },
  {
    id: "if-required",
    re: /as\s+required\s+by\s+(written\s+)?contract|if\s+required\s+by\s+(written\s+)?contract/gi,
    label: "Open-Ended Contract Wording",
    title: /blanket/i,
    need: "a blanket endorsement — otherwise this promises whatever the contract says",
  },
];

/** Operations the policy explicitly excludes — describing them on a cert misrepresents cover. */
const EXCLUSION_TRAPS: {
  id: string;
  re: RegExp;
  exclusion: RegExp;
  label: string;
}[] = [
  {
    id: "hot-work",
    re: /(torch[- ]?(down|applied|on)?|hot\s*work|open\s*flame|tar\s*kettle)/gi,
    exclusion: /open flame|hot work|torch/i,
    label: "Open Flame / Torch Work",
  },
  {
    id: "assault",
    re: /(assault|battery|security\s+services)/gi,
    exclusion: /assault\s*&?\s*battery/i,
    label: "Assault & Battery",
  },
];

const SUFFIX = /\b(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|lp|llp)\b/gi;

function normalizeLoose(name: string): string {
  return name
    .toLowerCase()
    .replace(SUFFIX, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTight(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function hasBacking(
  set: PolicyFormSet,
  spec: { kind?: EndorsementKind; title?: RegExp },
) {
  if (spec.kind) {
    const byKind = findEndorsement(set, spec.kind);
    if (byKind) return byKind;
  }
  if (spec.title) return findEndorsementByTitle(set, spec.title);
  return null;
}

export function verifyCoi(
  draft: CoiDraft,
  ctx: { account: Account; policy: Policy; set?: PolicyFormSet },
): CoiVerdict {
  const set = ctx.set ?? getPolicyFormSet(ctx.policy);
  const findings: CoiFinding[] = [];

  const reject = (f: Omit<CoiFinding, "severity">) =>
    findings.push({ ...f, severity: "reject" });
  const warn = (f: Omit<CoiFinding, "severity">) =>
    findings.push({ ...f, severity: "warn" });

  // ——— Holder ———
  if (!draft.holderName.trim()) {
    reject({
      id: "holder-missing",
      field: "holder",
      title: "No Certificate Holder",
      detail: "A certificate has to name who it's issued to.",
      fix: "Enter the holder exactly as the contract spells it.",
    });
  }

  // ——— Named insured ———
  const onFile = ctx.policy.quoteInsuredName ?? ctx.account.name;
  if (!draft.insuredName.trim()) {
    reject({
      id: "insured-missing",
      field: "insured",
      title: "No Named Insured",
      detail: "The cert must carry the named insured from the policy.",
    });
  } else if (normalizeTight(draft.insuredName) !== normalizeTight(onFile)) {
    const loose = normalizeLoose(draft.insuredName) === normalizeLoose(onFile);
    if (loose) {
      warn({
        id: "insured-punctuation",
        field: "insured",
        title: "Named Insured Spelled Differently",
        detail: `Cert says "${draft.insuredName}"; the policy says "${onFile}".`,
        fix: "Match the policy exactly — holders reject certs over a comma.",
      });
    } else {
      reject({
        id: "insured-mismatch",
        field: "insured",
        title: "Named Insured Doesn't Match The Policy",
        detail: `Cert says "${draft.insuredName}"; the policy is issued to "${onFile}".`,
        fix: "Use the policy's named insured, or add the entity first.",
      });
    }
  }

  // ——— Policy identity ———
  if (normalizeTight(draft.policyNumber) !== normalizeTight(ctx.policy.policyNumber)) {
    reject({
      id: "policy-mismatch",
      field: "policy",
      title: "Policy Number Isn't On File",
      detail: `Cert cites ${draft.policyNumber || "[blank]"}; this account carries ${ctx.policy.policyNumber}.`,
    });
  }
  // The INSURER line may carry the brand on the policy record or the
  // verified issuing company's legal name (the NAIC registry mapping —
  // e.g. AmTrust paper issues as Technology Insurance Company).
  const carrierNames = [
    ctx.policy.carrier,
    ...issuingCompaniesFor(ctx.policy.carrier),
  ];
  if (
    !carrierNames.some(
      (n) => normalizeLoose(draft.carrier) === normalizeLoose(n),
    )
  ) {
    reject({
      id: "carrier-mismatch",
      field: "policy",
      title: "Carrier Doesn't Match The Policy",
      detail: `Cert says ${draft.carrier || "[blank]"}; the policy is with ${ctx.policy.carrier}.`,
    });
  }

  // ——— Term ———
  if (draft.effectiveDate < ctx.policy.effectiveDate) {
    reject({
      id: "term-early",
      field: "term",
      title: "Effective Date Precedes The Policy",
      detail: `Cert starts ${draft.effectiveDate}; coverage starts ${ctx.policy.effectiveDate}.`,
      fix: "Backdating a cert is a misrepresentation — use the policy inception.",
    });
  }
  if (draft.expirationDate > ctx.policy.expirationDate) {
    reject({
      id: "term-late",
      field: "term",
      title: "Expiration Runs Past The Policy",
      detail: `Cert runs to ${draft.expirationDate}; the policy expires ${ctx.policy.expirationDate}.`,
      fix: "Issue to the current expiration and reissue at renewal.",
    });
  }
  if (draft.effectiveDate > draft.expirationDate) {
    reject({
      id: "term-inverted",
      field: "term",
      title: "Effective Date Falls After Expiration",
      detail: `Cert starts ${draft.effectiveDate} but ends ${draft.expirationDate} — the term is inverted.`,
      fix: `The policy term on file is ${ctx.policy.effectiveDate} to ${ctx.policy.expirationDate}.`,
    });
  }

  // ——— Limits ———
  for (const [slot, claimed] of Object.entries(draft.limits) as [
    LimitSlot,
    number,
  ][]) {
    if (claimed == null) continue;
    const carried = set.limits.find((l) => l.slot === slot);
    if (!carried) {
      reject({
        id: `limit-absent-${slot}`,
        field: "limits",
        title: `${limitSlotLabel(slot)} Isn't On This Policy`,
        detail: `The cert shows ${money(claimed)} for a line this policy doesn't carry.`,
        fix: "Remove the line, or issue from the policy that actually has it.",
      });
      continue;
    }
    const mode = limitMode(carried);
    if (mode !== "amount") {
      // The dec states the line as Included / Excluded — there is no dollar
      // amount on the schedule for a cert to claim.
      const word = mode === "included" ? "Included" : "Excluded";
      reject({
        id: `limit-mode-${slot}`,
        field: "limits",
        title: `${limitSlotLabel(slot)} Has No Dollar Amount On The Schedule`,
        detail: `Cert claims ${money(claimed)}, but the dec states this line as "${word}" — no dollar backs it.`,
        fix: `Print "${word}", or fix the schedule first.`,
      });
      continue;
    }
    const carriedCents = carried.amountCents ?? 0;
    if (claimed > carriedCents) {
      reject({
        id: `limit-over-${slot}`,
        field: "limits",
        title: `${limitSlotLabel(slot)} Exceeds The Policy`,
        detail: `Cert claims ${money(claimed)}; the policy carries ${money(carriedCents)}.`,
        fix: "Show the policy limit, or ask the underwriter to increase it.",
      });
    } else if (claimed < carriedCents) {
      warn({
        id: `limit-under-${slot}`,
        field: "limits",
        title: `${limitSlotLabel(slot)} Understated`,
        detail: `Cert shows ${money(claimed)}; the policy carries ${money(carriedCents)}.`,
        fix: "Allowed, but usually a typo.",
      });
    }
  }

  // ——— Checkboxes ———
  for (const [key, on] of Object.entries(draft.flags) as [
    keyof CoiFlags,
    boolean,
  ][]) {
    if (!on) continue;
    const spec = FLAG_BACKING[key];
    const form = hasBacking(set, spec);
    if (!form) {
      reject({
        id: `flag-${key}`,
        field: "flags",
        title: `${FLAG_LABELS[key]} Isn't On The Policy`,
        detail: `The cert checks ${FLAG_LABELS[key]}, but the schedule has no backing form.`,
        fix: `Request ${spec.need} from the underwriter before issuing.`,
      });
    } else if (
      (key === "additionalInsured" || key === "subrogationWaived") &&
      (!form.form.trim() || !form.edition.trim())
    ) {
      // Mirror of the one-door Endorsement Backing Verified check: a claim
      // whose backing row lacks its full form identity (form number AND
      // edition date) cannot issue — the review rail must show the same
      // wall, never an all-green rail over a shut door.
      reject({
        id: `flag-${key}`,
        field: "flags",
        title: `${FLAG_LABELS[key]} Endorsement Lacks Its Form Identity`,
        detail: `The cert checks ${FLAG_LABELS[key]}, but the backing endorsement "${form.title}" carries no form number and edition date on the schedule of record — form identity without the edition certifies the wrong paper.`,
        fix: "Record the endorsement's form number and edition date on the schedule, or leave the box unchecked.",
      });
    } else if (key === "additionalInsured" && /scheduled/i.test(form.note ?? "")) {
      const named =
        draft.holderName.trim().length > 0 &&
        normalizeLoose(draft.description).includes(normalizeLoose(draft.holderName));
      if (!named) {
        warn({
          id: "ai-scheduled-unnamed",
          field: "flags",
          title: "Scheduled AI — Name The Holder",
          detail: `${form.form} ${form.edition} is scheduled, so the holder has to appear in the description.`,
          requiresForm: `${form.form} ${form.edition}`,
        });
      }
    }
  }

  // ——— Description Of Operations ———
  const desc = draft.description;
  for (const rule of GRANT_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(desc)) !== null) {
      const form = hasBacking(set, { kind: rule.kind, title: rule.title });
      if (!form) {
        reject({
          id: `desc-${rule.id}-${m.index}`,
          field: "description",
          title: `Description Grants ${rule.label}`,
          detail: `"${m[0]}" promises coverage the policy doesn't carry.`,
          fix: `Delete the wording, or get ${rule.need} added first.`,
          match: { text: m[0], start: m.index, end: m.index + m[0].length },
        });
      }
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  for (const trap of EXCLUSION_TRAPS) {
    const excluded = set.endorsements.find(
      (e) => e.kind === "exclusion" && trap.exclusion.test(e.title),
    );
    if (!excluded) continue;
    const re = new RegExp(trap.re.source, trap.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(desc)) !== null) {
      reject({
        id: `desc-excluded-${trap.id}-${m.index}`,
        field: "description",
        title: `Description Contradicts An Exclusion`,
        detail: `"${m[0]}" is excluded by ${excluded.form} ${excluded.edition} — ${excluded.title}.`,
        fix: "Describe only operations the policy covers.",
        requiresForm: `${excluded.form} ${excluded.edition}`,
        match: { text: m[0], start: m.index, end: m.index + m[0].length },
      });
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  const rejects = findings.filter((f) => f.severity === "reject");
  const warns = findings.filter((f) => f.severity === "warn");

  return { findings, rejects, warns, okToIssue: rejects.length === 0 };
}

function emptyFlags(): CoiFlags {
  return {
    additionalInsured: false,
    subrogationWaived: false,
    primaryNonContributory: false,
    completedOperations: false,
    noticeOfCancellation: false,
    perProjectAggregate: false,
  };
}

/**
 * "blanket " / "scheduled " / "" — the scope matters when reporting what a
 * policy carries. A blanket form reaches a holder the policy never names; a
 * scheduled one reaches only the parties on its schedule, and reporting the
 * two the same way would let an insured assume cover they have to ask for.
 */
function scopeWord(e: { scope?: string | null }): string {
  if (e.scope === "blanket") return "blanket ";
  if (e.scope === "scheduled") return "scheduled ";
  return "";
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * The structured fill: every box comes from the coverage tab, so it's correct
 * by construction. This is the certificate we'd actually issue.
 */
export function buildDraftFromPolicy(input: {
  account: Account;
  policy: Policy;
  holderName: string;
  holderAddress: string;
  projectWording?: string;
  /** Schedule of record, when the caller already resolved it server-side */
  set?: PolicyFormSet;
}): CoiDraft {
  const set = input.set ?? getPolicyFormSet(input.policy);
  const limits: Partial<Record<LimitSlot, number>> = {};
  // Included / Excluded lines carry no dollar claim — only amounts fill in.
  for (const l of set.limits) {
    if (limitMode(l) === "amount" && l.amountCents != null) {
      limits[l.slot] = l.amountCents;
    }
  }

  // Auto-fill only claims an endorsement that carries its full form
  // identity (form number + edition) — the same bar the issuance check
  // holds every claim to. A dec-imported row with a blank form number
  // stays an honest blank box (and never prints "per  ." wording);
  // underreporting beats overstating.
  const identified = (e: ReturnType<typeof findEndorsement>) =>
    e && e.form.trim() && e.edition.trim() ? e : null;
  const ai = identified(findEndorsement(set, "ai"));
  const wos = identified(findEndorsement(set, "wos"));
  const pnc = identified(findEndorsement(set, "pnc"));
  const completedOps = identified(
    findEndorsementByTitle(set, /completed operations/i),
  );

  const insuredName = input.policy.quoteInsuredName ?? input.account.name;
  // A certificate issued to the insured itself is evidence of its own
  // coverage. There is no third party to be an additional insured, to have
  // subrogation waived in its favor, or to be certified as primary — so the
  // grant wording stays off the description and the ADDL INSD / SUBR WVD
  // columns stay blank. The endorsements are still on the policy; this
  // certificate simply grants nothing to nobody.
  const holderIsInsured = [insuredName, input.account.name, input.account.dba]
    .filter((n): n is string => Boolean(n?.trim()))
    .some((n) => normalizeLoose(n) === normalizeLoose(input.holderName));

  const parts: string[] = [];
  if (input.projectWording?.trim()) parts.push(input.projectWording.trim());
  if (holderIsInsured) {
    // The insured asking for their own certificate wants to know what they
    // bought. Saying so is not the same as granting it: these read as
    // statements about the policy, in the passive, naming no beneficiary —
    // where the third-party version names the holder and confers something.
    // The ADDL INSD / SUBR WVD columns stay blank either way, because those
    // describe the certificate holder and nobody is an additional insured
    // of their own policy.
    const carried: string[] = [];
    if (ai) carried.push(`${scopeWord(ai)}additional insured per ${ai.form} ${ai.edition}`);
    if (wos) {
      carried.push(`${scopeWord(wos)}waiver of subrogation per ${wos.form} ${wos.edition}`);
    }
    if (pnc) {
      carried.push(`primary and non-contributory coverage per ${pnc.form} ${pnc.edition}`);
    }
    if (carried.length > 0) {
      parts.push(
        `Issued to the named insured. The policy carries ${joinList(carried)}. ` +
          `A certificate naming a third party is required to extend it to them.`,
      );
    }
  } else {
    if (ai) {
      parts.push(
        `${input.holderName} is included as additional insured per ${ai.form} ${ai.edition}.`,
      );
    }
    if (wos) parts.push(`Waiver of subrogation applies per ${wos.form} ${wos.edition}.`);
    if (pnc) {
      parts.push(`Coverage is primary and non-contributory per ${pnc.form} ${pnc.edition}.`);
    }
  }

  return {
    holderName: input.holderName,
    holderAddress: input.holderAddress,
    insuredName,
    policyNumber: input.policy.policyNumber,
    carrier: input.policy.carrier,
    effectiveDate: input.policy.effectiveDate,
    expirationDate: input.policy.expirationDate,
    limits,
    flags: {
      ...emptyFlags(),
      additionalInsured: Boolean(ai) && !holderIsInsured,
      subrogationWaived: Boolean(wos) && !holderIsInsured,
      primaryNonContributory: Boolean(pnc) && !holderIsInsured,
      completedOperations: Boolean(completedOps),
    },
    description: parts.join(" "),
  };
}

/**
 * The cert as the vendor sent it: their boilerplate, their limits, their asks.
 * Deterministic so the same upload always parses the same way.
 */
export function buildDraftFromUpload(input: {
  account: Account;
  policy: Policy;
  holderName: string;
  holderAddress: string;
  projectWording?: string;
}): CoiDraft {
  const base = buildDraftFromPolicy(input);
  const set = getPolicyFormSet(input.policy);
  const limits = { ...base.limits };

  // Vendor compliance portals routinely demand doubled limits.
  for (const l of set.limits) {
    if (limitMode(l) !== "amount" || l.amountCents == null) continue;
    if (l.slot === "gl_each_occurrence" || l.slot === "auto_combined_single" || l.slot === "prof_each_claim") {
      limits[l.slot] = l.amountCents * 2;
    }
    if (l.slot === "gl_general_aggregate" || l.slot === "prof_aggregate") {
      limits[l.slot] = l.amountCents * 2;
    }
  }
  // ...and a line this policy doesn't even carry.
  if (!set.limits.some((l) => l.slot === "umb_each_occurrence")) {
    limits.umb_each_occurrence = 5_000_000_00;
  }

  const holder = input.holderName || "the certificate holder";
  const trap = EXCLUSION_TRAPS.find((t) =>
    set.endorsements.some((e) => e.kind === "exclusion" && t.exclusion.test(e.title)),
  );
  const trapClause =
    trap?.id === "hot-work"
      ? " Work includes torch-down roofing at the project site."
      : trap?.id === "assault"
        ? " Coverage includes security services and assault & battery."
        : "";

  const description =
    `${holder}, its officers, agents and employees are named as additional insured ` +
    `on a primary and non-contributory basis, including completed operations, with a ` +
    `waiver of subrogation in favor of the holder, as required by written contract. ` +
    `30 days written notice of cancellation will be provided to the holder.${trapClause}`;

  return {
    ...base,
    limits,
    flags: {
      additionalInsured: true,
      subrogationWaived: true,
      primaryNonContributory: true,
      completedOperations: true,
      noticeOfCancellation: true,
      perProjectAggregate: false,
    },
    description,
  };
}

/** Plain-text certificate summary for the thread record. */
export function renderCoiSummary(draft: CoiDraft, verdict: CoiVerdict): string {
  const lines = [
    `Certificate Holder: ${draft.holderName}`,
    draft.holderAddress ? `Holder Address: ${draft.holderAddress}` : null,
    `Named Insured: ${draft.insuredName}`,
    `Policy: ${draft.policyNumber} (${draft.carrier})`,
    `Term: ${draft.effectiveDate} to ${draft.expirationDate}`,
    "",
    "Limits Shown:",
    ...Object.entries(draft.limits).map(
      ([slot, cents]) => `  • ${limitSlotLabel(slot as LimitSlot)}: ${money(cents as number)}`,
    ),
    "",
    "Endorsements Claimed:",
    ...(Object.entries(draft.flags) as [keyof CoiFlags, boolean][])
      .filter(([, on]) => on)
      .map(([k]) => `  • ${FLAG_LABELS[k]}`),
    "",
    "Description Of Operations:",
    draft.description || "  [none]",
  ].filter((l) => l !== null);

  if (verdict.findings.length) {
    lines.push("", "Check Results:");
    for (const f of verdict.findings) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.title} — ${f.detail}`);
    }
  } else {
    lines.push("", "Check Results: Clean — every box is backed by the policy.");
  }

  return lines.join("\n");
}
