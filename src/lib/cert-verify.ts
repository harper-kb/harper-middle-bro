import { limitMode, type LimitSlot, type PolicyFormSet } from "./forms";
import { naicForPolicy } from "./naic";
import type { Account, Policy } from "./types";

/**
 * Client-certificate verification — a client sends over a sample certificate
 * and the desk checks every claim on it against the schedule of record.
 *
 * Pure and deterministic: `parseCertificateText` reads ACORD-ish text into
 * structured fields (tolerant of layout, honest about what it can't read),
 * and `verifyAgainstRecord` turns each field into a verdict — "Match",
 * "Mismatch" (both values shown), or "Not On File" when nothing on record
 * can confirm it. Never a guess: unreadable text is reported as
 * "Could Not Read", and an unconfirmable claim is "Not On File", not a pass.
 */

/* ————————————————— Extraction ————————————————— */

export interface ExtractedPolicy {
  policyNumber: string;
  /** Coverage block heading the row printed under, when one was in scope */
  coverage: string | null;
  effectiveDate: string | null; // ISO
  expirationDate: string | null; // ISO
}

export interface ExtractedLimit {
  /** The label text as read off the cert, e.g. "EACH OCCURRENCE" */
  label: string;
  /** Cents when the line stated a dollar amount; null for Included/Excluded */
  amountCents: number | null;
  /** "Included" | "Excluded" | "" — the non-dollar statement, when present */
  statement: string;
  /** Coverage block heading the line printed under, when one was in scope */
  coverage: string | null;
}

export interface ExtractedCert {
  insuredName: string | null;
  /** INSURER A–F lines, in letter order */
  carriers: string[];
  policies: ExtractedPolicy[];
  limits: ExtractedLimit[];
  holderName: string | null;
  /** null = the cert doesn't state it either way */
  additionalInsured: boolean | null;
  subrogationWaived: boolean | null;
  /** Lines that looked like data but couldn't be read — reported honestly */
  couldNotRead: string[];
}

/** Coverage block headings a cert prints — anchors limit/policy context. */
const COVERAGE_HEADINGS: { match: RegExp; label: string }[] = [
  { match: /general liability/i, label: "General Liability" },
  { match: /automobile liability/i, label: "Automobile Liability" },
  { match: /umbrella|excess liab/i, label: "Umbrella / Excess" },
  { match: /workers'? comp/i, label: "Workers Compensation" },
  { match: /garage/i, label: "Garage" },
  { match: /professional|errors (?:&|and) omissions/i, label: "Professional Liability" },
  { match: /cyber/i, label: "Cyber Liability" },
  { match: /liquor/i, label: "Liquor Liability" },
];

/** Policy-number token: letters/digits with at least one digit run, dashed. */
const POLICY_TOKEN = /\b([A-Z]{2,6}(?:-[A-Z0-9]{2,10}){1,3})\b/;

const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

function isoOf(m: RegExpMatchArray): string | null {
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "$1,000,000" / "1,000,000" → cents; null when unreadable. */
function centsOf(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return Number(digits) * 100;
}

/** Label text after a "FIELD:" prefix, or the next non-empty line. */
function valueAfter(lines: string[], i: number, prefix: RegExp): string | null {
  const inline = lines[i].replace(prefix, "").replace(/^[:\s]+/, "").trim();
  if (inline) return inline;
  for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
    const next = lines[j].trim();
    if (next) return next;
  }
  return null;
}

export function parseCertificateText(text: string): ExtractedCert {
  const lines = text.split(/\r?\n/);
  const out: ExtractedCert = {
    insuredName: null,
    carriers: [],
    policies: [],
    limits: [],
    holderName: null,
    additionalInsured: null,
    subrogationWaived: null,
    couldNotRead: [],
  };

  let coverage: string | null = null;
  let inHolder = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Holder block: the first non-empty line after the heading is the name.
    if (/^certificate holder\b/i.test(line)) {
      inHolder = true;
      const inline = line.replace(/^certificate holder[:\s]*/i, "").trim();
      if (inline) {
        out.holderName = inline;
        inHolder = false;
      }
      continue;
    }
    if (inHolder) {
      if (/^cancellation\b/i.test(line)) {
        inHolder = false;
      } else {
        out.holderName = line;
        inHolder = false;
      }
      continue;
    }

    // Coverage block heading in scope for following policy/limit lines.
    const heading = COVERAGE_HEADINGS.find((h) => h.match.test(line));
    if (heading) coverage = heading.label;

    // INSURED (not "INSURER", not "ADDITIONAL INSURED")
    if (/^insured\b/i.test(line) && !/^insurer/i.test(line)) {
      const name = valueAfter(lines, i, /^insured\b/i);
      if (name && !out.insuredName) out.insuredName = name;
      continue;
    }

    // INSURER A: Carrier Name (NAIC# optional)
    const insurer = /^insurer\s+([A-F])\s*[:\-]?\s*(.+)$/i.exec(line);
    if (insurer) {
      const name = insurer[2].replace(/\bnaic\s*#?\s*\d*\s*$/i, "").trim();
      if (name) out.carriers.push(name);
      continue;
    }

    // AI / WOS statements, stated either way.
    if (/additional insured/i.test(line)) {
      out.additionalInsured = !/\bnot\b|\bno\b/i.test(line);
    }
    if (/waiver of subrogation|subrogation (?:is )?waived/i.test(line)) {
      out.subrogationWaived = !/\bnot\b|\bno\b/i.test(line);
    }

    // Policy row: a policy-number token, ideally with the term dates beside it.
    const pol = POLICY_TOKEN.exec(line);
    if (pol && /\d/.test(pol[1])) {
      const dates = [...line.matchAll(new RegExp(DATE.source, "g"))];
      out.policies.push({
        policyNumber: pol[1],
        coverage,
        effectiveDate: dates[0] ? isoOf(dates[0]) : null,
        expirationDate: dates[1] ? isoOf(dates[1]) : null,
      });
      continue;
    }
    if (/^policy (?:number|no)\b/i.test(line)) {
      // A policy-number line whose token didn't parse — report it honestly.
      out.couldNotRead.push(line);
      continue;
    }

    // Limit line: "LABEL  $1,000,000" / "LABEL: Included" / "LABEL Excluded".
    const limit =
      /^([A-Za-z][A-Za-z .&/()''\-]*?)\s*[:\s]\s*(\$\s*[\d,]+|included|excluded)\s*$/i.exec(
        line,
      );
    if (limit) {
      const stmt = limit[2].trim();
      if (/^included$/i.test(stmt) || /^excluded$/i.test(stmt)) {
        out.limits.push({
          label: limit[1].trim(),
          amountCents: null,
          statement: /^included$/i.test(stmt) ? "Included" : "Excluded",
          coverage,
        });
      } else {
        const cents = centsOf(stmt);
        if (cents == null) {
          out.couldNotRead.push(line);
        } else {
          out.limits.push({
            label: limit[1].trim(),
            amountCents: cents,
            statement: "",
            coverage,
          });
        }
      }
      continue;
    }

    // A dollar sign on a line we couldn't shape — never silently dropped.
    if (/\$\s*[\d,]/.test(line)) out.couldNotRead.push(line);
  }

  return out;
}

/* ————————————————— Verification ————————————————— */

export type FieldVerdict = "Match" | "Mismatch" | "Not On File" | "Could Not Read";

export interface VerdictRow {
  field: string;
  onCert: string;
  onFile: string;
  verdict: FieldVerdict;
  /** A critical mismatch denies the certificate */
  critical: boolean;
  note?: string;
}

export type Recommendation = "Approve" | "Approve With Notes" | "Deny";

export interface VerifyReport {
  rows: VerdictRow[];
  recommendation: Recommendation;
  reasons: string[];
}

export interface RecordOnFile {
  account: Account;
  policies: Policy[];
  /** Schedule of record per policy id (getPolicyFormSet upstream) */
  formSets: Record<string, PolicyFormSet>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Cert limit labels → schedule slots, per coverage family. */
const LIMIT_LABEL_SLOTS: { match: RegExp; slots: LimitSlot[] }[] = [
  { match: /each occurrence/i, slots: ["gl_each_occurrence", "umb_each_occurrence"] },
  { match: /damage to rented/i, slots: ["gl_damage_premises"] },
  { match: /med(?:ical)? exp/i, slots: ["gl_med_exp"] },
  { match: /personal (?:&|and) adv/i, slots: ["gl_personal_adv"] },
  { match: /general aggregate/i, slots: ["gl_general_aggregate"] },
  { match: /products?\s*[-–—]?\s*comp/i, slots: ["gl_products_completed_ops"] },
  { match: /combined single limit/i, slots: ["auto_combined_single"] },
  { match: /aggregate/i, slots: ["umb_aggregate", "prof_aggregate", "cyber_aggregate"] },
  { match: /e\.?\s*l\.?\s*each accident/i, slots: ["wc_el_each_accident"] },
  { match: /e\.?\s*l\.?\s*disease\s*[-–—]?\s*(?:ea|each) employee/i, slots: ["wc_el_disease_employee"] },
  { match: /e\.?\s*l\.?\s*disease\s*[-–—]?\s*policy/i, slots: ["wc_el_disease_policy"] },
  { match: /each claim/i, slots: ["prof_each_claim"] },
  { match: /each common cause/i, slots: ["liquor_each_common_cause"] },
];

function fmtMoney(cents: number): string {
  return "$" + new Intl.NumberFormat("en-US").format(Math.round(cents / 100));
}

function mdyOf(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/**
 * Every claim on the cert against the record on file. `today` is injectable
 * so the check is reproducible (self-checks pass a fixed date).
 */
export function verifyAgainstRecord(
  extracted: ExtractedCert,
  record: RecordOnFile,
  today: string = new Date().toISOString().slice(0, 10),
): VerifyReport {
  const rows: VerdictRow[] = [];
  const reasons: string[] = [];

  // ——— Insured name — the cert must name our insured ———
  if (extracted.insuredName) {
    const names = [record.account.name, record.account.dba].filter(
      (n): n is string => Boolean(n),
    );
    const hit = names.some((n) => norm(n) === norm(extracted.insuredName!));
    rows.push({
      field: "Insured Name",
      onCert: extracted.insuredName,
      onFile: record.account.name,
      verdict: hit ? "Match" : "Mismatch",
      critical: true,
      note: hit ? undefined : "The cert names a different insured than the account on file.",
    });
  } else {
    rows.push({
      field: "Insured Name",
      onCert: "Could Not Read",
      onFile: record.account.name,
      verdict: "Could Not Read",
      critical: false,
      note: "No insured name could be read off the cert.",
    });
  }

  // ——— Carriers — brand on the policy record, or its verified issuing company ———
  for (const carrier of extracted.carriers) {
    const match = record.policies.find((p) => {
      if (norm(p.carrier) === norm(carrier)) return true;
      const identity = naicForPolicy(p.carrier, p.coverages, p.issuingCarrier);
      return identity ? norm(identity.issuingCompany) === norm(carrier) : false;
    });
    rows.push({
      field: "Carrier",
      onCert: carrier,
      onFile: match
        ? match.carrier
        : record.policies.map((p) => p.carrier).join(", ") || "Not On File",
      verdict: match ? "Match" : "Mismatch",
      critical: true,
      note: match
        ? undefined
        : "No policy on file rides this carrier (brand or verified issuing company).",
    });
  }
  if (extracted.carriers.length === 0) {
    rows.push({
      field: "Carrier",
      onCert: "Could Not Read",
      onFile: record.policies.map((p) => p.carrier).join(", ") || "Not On File",
      verdict: "Could Not Read",
      critical: false,
      note: "No insurer line could be read off the cert.",
    });
  }

  // ——— Policy numbers + terms ———
  if (extracted.policies.length === 0) {
    rows.push({
      field: "Policy Number",
      onCert: "Could Not Read",
      onFile: record.policies.map((p) => p.policyNumber).join(", ") || "Not On File",
      verdict: "Could Not Read",
      critical: true,
      note: "No policy number could be read — nothing to verify the cert against.",
    });
  }
  for (const ep of extracted.policies) {
    const onFile = record.policies.find(
      (p) => norm(p.policyNumber) === norm(ep.policyNumber),
    );
    rows.push({
      field: "Policy Number",
      onCert: ep.policyNumber,
      onFile: onFile
        ? onFile.policyNumber
        : record.policies.map((p) => p.policyNumber).join(", ") || "Not On File",
      verdict: onFile ? "Match" : "Mismatch",
      critical: true,
      note: onFile ? undefined : "This policy number is not on file for the account.",
    });
    if (!onFile) continue;

    // Term dates against the policy record.
    const checkDate = (
      field: string,
      onCert: string | null,
      recordIso: string,
    ) => {
      if (!onCert) {
        rows.push({
          field: `${field} — ${ep.policyNumber}`,
          onCert: "Could Not Read",
          onFile: mdyOf(recordIso),
          verdict: "Could Not Read",
          critical: false,
          note: "The cert doesn't carry a readable date here.",
        });
        return;
      }
      const hit = onCert === recordIso;
      rows.push({
        field: `${field} — ${ep.policyNumber}`,
        onCert: mdyOf(onCert),
        onFile: mdyOf(recordIso),
        verdict: hit ? "Match" : "Mismatch",
        critical: true,
        note: hit ? undefined : "The cert's date doesn't match the policy term on file.",
      });
    };
    checkDate("Effective Date", ep.effectiveDate, onFile.effectiveDate);
    checkDate("Expiration Date", ep.expirationDate, onFile.expirationDate);

    // An expired policy can't be certified as in force.
    const exp = ep.expirationDate ?? onFile.expirationDate;
    if (exp < today) {
      rows.push({
        field: `Policy In Force — ${ep.policyNumber}`,
        onCert: mdyOf(ep.expirationDate) || "(from record)",
        onFile: mdyOf(onFile.expirationDate),
        verdict: "Mismatch",
        critical: true,
        note: `The policy expired ${mdyOf(exp)} — the cert certifies coverage that has lapsed.`,
      });
    }
  }

  // ——— Limits — never above what the schedule of record states ———
  const allLimits = record.policies.flatMap(
    (p) => record.formSets[p.id]?.limits ?? [],
  );
  for (const el of extracted.limits) {
    const mapping = LIMIT_LABEL_SLOTS.find((m) => m.match.test(el.label));
    const scheduled = mapping
      ? allLimits.find((l) => mapping.slots.includes(l.slot))
      : undefined;
    const label = el.coverage ? `${el.coverage} — ${el.label}` : el.label;

    if (!scheduled) {
      rows.push({
        field: label,
        onCert:
          el.amountCents != null ? fmtMoney(el.amountCents) : el.statement,
        onFile: "Not On File",
        verdict: "Not On File",
        critical: false,
        note: "No schedule of record states this line — the desk can't confirm it.",
      });
      continue;
    }

    const mode = limitMode(scheduled);
    if (el.amountCents != null) {
      if (mode !== "amount") {
        rows.push({
          field: label,
          onCert: fmtMoney(el.amountCents),
          onFile: mode === "included" ? "Included" : "Excluded",
          verdict: "Mismatch",
          critical: true,
          note: "The dec states this line without a dollar amount — the cert claims one anyway.",
        });
      } else {
        const onFileCents = scheduled.amountCents ?? 0;
        if (el.amountCents === onFileCents) {
          rows.push({
            field: label,
            onCert: fmtMoney(el.amountCents),
            onFile: fmtMoney(onFileCents),
            verdict: "Match",
            critical: false,
          });
        } else {
          const overstated = el.amountCents > onFileCents;
          rows.push({
            field: label,
            onCert: fmtMoney(el.amountCents),
            onFile: fmtMoney(onFileCents),
            verdict: "Mismatch",
            critical: overstated,
            note: overstated
              ? "The cert states more coverage than the schedule of record carries."
              : "The cert understates the scheduled limit — allowed on a cert, but it doesn't match the record.",
          });
        }
      }
    } else {
      const stmtMode = el.statement === "Included" ? "included" : "excluded";
      const hit = mode === stmtMode;
      rows.push({
        field: label,
        onCert: el.statement,
        onFile:
          mode === "amount"
            ? fmtMoney(scheduled.amountCents ?? 0)
            : mode === "included"
              ? "Included"
              : "Excluded",
        verdict: hit ? "Match" : "Mismatch",
        critical: el.statement === "Included" && !hit,
        note: hit
          ? undefined
          : el.statement === "Included"
            ? `"Included" is a coverage claim the dec doesn't back.`
            : `The dec states this line differently.`,
      });
    }
  }

  // ——— AI / WOS claims — only an endorsement on file backs them ———
  const endorsementCheck = (
    field: string,
    claimed: boolean | null,
    kind: "ai" | "wos",
  ) => {
    if (claimed !== true) return; // not claimed / claimed absent — nothing to back
    const backing = record.policies.some((p) =>
      (record.formSets[p.id]?.endorsements ?? []).some((e) => e.kind === kind),
    );
    rows.push({
      field,
      onCert: "Claimed",
      onFile: backing ? "Endorsement On File" : "Not On File",
      verdict: backing ? "Match" : "Mismatch",
      critical: !backing,
      note: backing
        ? undefined
        : "The cert claims it, but no endorsement on the schedule of record grants it.",
    });
  };
  endorsementCheck("Additional Insured", extracted.additionalInsured, "ai");
  endorsementCheck("Waiver Of Subrogation", extracted.subrogationWaived, "wos");

  // ——— Holder — per-certificate, so the record can't confirm it ———
  if (extracted.holderName) {
    rows.push({
      field: "Certificate Holder",
      onCert: extracted.holderName,
      onFile: "Not On File",
      verdict: "Not On File",
      critical: false,
      note: "Holders are per-certificate — nothing on the account record confirms or denies one.",
    });
  } else {
    rows.push({
      field: "Certificate Holder",
      onCert: "Could Not Read",
      onFile: "Not On File",
      verdict: "Could Not Read",
      critical: false,
      note: "No certificate holder could be read — a cert has to name who it's issued to.",
    });
  }

  // ——— Unreadable lines, reported honestly ———
  for (const line of extracted.couldNotRead) {
    rows.push({
      field: "Unreadable Line",
      onCert: line,
      onFile: "—",
      verdict: "Could Not Read",
      critical: false,
      note: "This line looked like data but couldn't be read.",
    });
  }

  // ——— Recommendation ———
  const criticalMisses = rows.filter(
    (r) => r.critical && (r.verdict === "Mismatch" || r.verdict === "Could Not Read"),
  );
  for (const r of criticalMisses) {
    reasons.push(`${r.field}: ${r.note ?? `${r.onCert} vs ${r.onFile}`}`);
  }

  let recommendation: Recommendation;
  if (criticalMisses.length > 0) {
    recommendation = "Deny";
  } else {
    const notes = rows.filter(
      (r) => r.verdict !== "Match" && !(r.field === "Certificate Holder" && r.verdict === "Not On File"),
    );
    // A missing holder is a gap worth a note even though it isn't a mismatch.
    const holderMissing = rows.some(
      (r) => r.field === "Certificate Holder" && r.verdict === "Could Not Read",
    );
    if (notes.length > 0 || holderMissing) {
      recommendation = "Approve With Notes";
      for (const r of notes) {
        reasons.push(`${r.field}: ${r.note ?? `${r.onCert} vs ${r.onFile}`}`);
      }
    } else {
      recommendation = "Approve";
      reasons.push("Every readable claim on the cert matches the record on file.");
    }
  }

  return { rows, recommendation, reasons };
}
