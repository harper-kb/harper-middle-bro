import {
  certDescription,
  type Acord25Sheet,
  type ResolvedLimit,
  type ResolvedSection,
  type SectionDef,
} from "./acord25";
import { evaluateKnowledgeForCertSection } from "./carrier-knowledge";
import type { CertificatePacket, CertSection } from "./certificate";
import {
  FLAG_LABELS,
  verifyCoi,
  type CoiDraft,
  type CoiFinding,
  type CoiFlags,
} from "./coi";
import { limitMode, type LimitSlot, type PolicyFormSet } from "./forms";
import { NAIC_SOURCE } from "./naic";
import type { Account } from "./types";

/**
 * Extraction review + edited-sheet verification — the layer between "the
 * system filled the form from the schedule" and "a human may issue it".
 *
 * Field model: every fillable box on the sheet has a flat string id
 * (`gl.limit.eachOccurrence`, `insurer.A`, `desc`, …). Auto-extracted values
 * become `FieldSuggestion`s the operator must confirm or reject; user edits
 * live in a flat `SheetOverrides` map. Both feed `verifyEditedSheet`, which
 * re-runs the same deterministic `verifyCoi` that gates ticket certs —
 * freedom to edit any box, zero freedom to issue an untrue certificate.
 */

/** User edits by field id. Absent id = the extracted default stands. */
export type SheetOverrides = Record<string, string | boolean>;

export interface FieldSuggestion {
  id: string;
  /** Review-panel grouping, e.g. "Commercial General Liability" */
  group: string;
  label: string;
  /** Human-readable believed value shown on the chip */
  display: string;
  /** Where the belief comes from — a form on the schedule or the policy record */
  source: string;
}

export interface SheetFinding {
  policyNumber: string;
  carrier: string;
  finding: CoiFinding;
  /** Sheet field the finding points at, when derivable */
  fieldId?: string;
}

// ——— Effective-value helpers (component + verifier share these) ———

export function effStr(
  overrides: SheetOverrides,
  id: string,
  fallback: string,
): string {
  const v = overrides[id];
  return typeof v === "string" ? v : fallback;
}

export function effBool(
  overrides: SheetOverrides,
  id: string,
  fallback: boolean,
): boolean {
  const v = overrides[id];
  return typeof v === "boolean" ? v : fallback;
}

// ——— Formatting / parsing ———

export function fmtCents(cents: number | null): string {
  if (cents == null) return "";
  return new Intl.NumberFormat("en-US").format(Math.round(cents / 100));
}

/** What a resolved limit box prints: "1,000,000", "Included", "Excluded", "". */
export function displayLimit(v: ResolvedLimit | null | undefined): string {
  if (!v) return "";
  if (v.kind === "amount") return fmtCents(v.cents);
  return v.kind === "included" ? "Included" : "Excluded";
}

/** ISO "YYYY-MM-DD" → form "MM/DD/YYYY". */
export function mdy(iso: string | undefined | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** Form "MM/DD/YYYY" → ISO, or null when the text isn't a real date. */
export function isoFromMdy(text: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Dollar text → cents. `invalid` when there's text but no readable number. */
export function parseMoney(raw: string): { cents: number | null; invalid: boolean } {
  const text = raw.trim();
  if (!text) return { cents: null, invalid: false };
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return { cents: null, invalid: true };
  return { cents: Number(digits) * 100, invalid: false };
}

// ——— Extraction suggestions ———

/** The coverage part that feeds a section — its form number is the source cite. */
function partSource(def: SectionDef, feeder: CertSection): string {
  const part =
    feeder.set.coverages.find((c) => def.match.test(c.label)) ??
    feeder.set.coverages[0];
  return part ? `${part.form} ${part.edition}`.trim() : "policy record";
}

function endorsementSource(
  feeder: CertSection,
  kind: "ai" | "wos",
): string {
  const e = feeder.set.endorsements.find((x) => x.kind === kind);
  return e ? `${e.form} ${e.edition}`.trim() : "policy record";
}

function checkItemsOf(def: SectionDef) {
  const items = def.typeCell.flatMap((line) =>
    line.kind === "checks" ? line.items : [],
  );
  // Perils checkboxes that live inside limit rows (ACORD 30 garagekeepers).
  const boxChecks = def.limitBoxes.flatMap((b) => (b.check ? [b.check] : []));
  return [...items, ...(def.limitsHead ?? []), ...boxChecks];
}

/**
 * Every field the system extracted from the policy file, as reviewable
 * suggestions. Only populated values appear — blank boxes carry no claim,
 * so there is nothing to confirm.
 */
export function buildSuggestions(
  sheet: Acord25Sheet,
  packet: CertificatePacket,
): FieldSuggestion[] {
  const out: FieldSuggestion[] = [];

  const insured =
    packet.sections[0]?.draft.insuredName ?? packet.account.name;
  if (insured) {
    out.push({
      id: "insured.name",
      group: "Insured",
      label: "Named Insured",
      display: insured,
      source: "policy record",
    });
  }

  // Insured mailing address — pulled off the account record. Only shown
  // when the record carries a street line; a bare city/state claims nothing.
  const a = packet.account;
  if (a.addressLine1) {
    out.push({
      id: "insured.addr1",
      group: "Insured",
      label: "Insured Address",
      display: [a.addressLine1, a.city, `${a.state} ${a.zip ?? ""}`.trim()]
        .filter(Boolean)
        .join(", "),
      source: "account record",
    });
  }

  for (const ins of packet.insurers) {
    // Verified brands print the issuing company's legal name off the NAIC
    // registry; unverified ones print the policy-record brand, NAIC blank.
    out.push({
      id: `insurer.${ins.letter}`,
      group: "Insurers",
      label: `Insurer ${ins.letter}`,
      display: ins.issuingCompany ?? ins.carrier,
      source: ins.issuingCompany ? NAIC_SOURCE : "policy record",
    });
    if (ins.naic) {
      out.push({
        id: `naic.${ins.letter}`,
        group: "Insurers",
        label: `Insurer ${ins.letter} NAIC #`,
        display: ins.naic,
        source: NAIC_SOURCE,
      });
    }
  }

  const pushSectionFields = (
    sec: string,
    group: string,
    feeder: CertSection,
    ref: { policyNumber: string; effectiveDate: string; expirationDate: string; additionalInsured: boolean; subrogationWaived: boolean },
  ) => {
    out.push({
      id: `${sec}.policyNumber`,
      group,
      label: "Policy Number",
      display: ref.policyNumber,
      source: "policy record",
    });
    out.push({
      id: `${sec}.eff`,
      group,
      label: "Policy Eff",
      display: mdy(ref.effectiveDate),
      source: "policy record",
    });
    out.push({
      id: `${sec}.exp`,
      group,
      label: "Policy Exp",
      display: mdy(ref.expirationDate),
      source: "policy record",
    });
    if (ref.additionalInsured) {
      out.push({
        id: `${sec}.addl`,
        group,
        label: "Addl Insd",
        display: "Y",
        source: `${endorsementSource(feeder, "ai")} schedule`,
      });
    }
    if (ref.subrogationWaived) {
      out.push({
        id: `${sec}.subr`,
        group,
        label: "Subr Wvd",
        display: "Y",
        source: `${endorsementSource(feeder, "wos")} schedule`,
      });
    }
  };

  for (const rs of sheet.sections) {
    if (!rs.feeder || !rs.ref) continue;
    const sec = rs.def.key;
    const group = rs.def.name;
    const src = partSource(rs.def, rs.feeder);
    pushSectionFields(sec, group, rs.feeder, rs.ref);
    for (const item of checkItemsOf(rs.def)) {
      if (rs.checks[item.key]) {
        out.push({
          id: `${sec}.check.${item.key}`,
          group,
          label: item.label || "Checkbox",
          display: "✓ Checked",
          source: `${src} coverage part`,
        });
      }
    }
    for (const box of rs.def.limitBoxes) {
      const v = rs.limits[box.key];
      if (v != null) {
        // Stated lines cite the schedule; the Excluded default cites the
        // fill rule (the dec doesn't state the line, so nothing is claimed).
        const stated =
          box.slot != null &&
          rs.feeder.set.limits.some((l) => l.slot === box.slot);
        out.push({
          id: `${sec}.limit.${box.key}`,
          group,
          label: box.label,
          display: v.kind === "amount" ? `$ ${fmtCents(v.cents)}` : displayLimit(v),
          source: stated ? `${src} schedule` : "fill rule — line not on the dec",
        });
      }
      // Per-location write-in beside the $ box (garagekeepers rows).
      const loc = rs.locs[box.key];
      if (loc) {
        out.push({
          id: `${sec}.loc.${box.key}`,
          group,
          label: `${box.label} — LOC`,
          display: loc,
          source: `${src} schedule`,
        });
      }
    }
  }

  sheet.others.forEach((row, i) => {
    if (!row.feeder || !row.ref) return;
    const sec = `other${i}`;
    const group = row.label || "Additional Coverage";
    const part =
      row.feeder.set.coverages.find((c) => c.label === row.label) ??
      row.feeder.set.coverages[0];
    const src = part ? `${part.form} ${part.edition}`.trim() : "policy record";
    out.push({
      id: `${sec}.label`,
      group,
      label: "Type Of Insurance",
      display: row.label,
      source: `${src} coverage part`,
    });
    pushSectionFields(sec, group, row.feeder, row.ref);
    for (const line of row.lines) {
      out.push({
        id: `${sec}.limit.${line.slot}`,
        group,
        label: line.label,
        display:
          line.value.kind === "amount"
            ? `$ ${fmtCents(line.value.cents)}`
            : displayLimit(line.value),
        source: `${src} schedule`,
      });
    }
  });

  if (packet.description) {
    const forms = Array.from(
      new Set(
        packet.sections.flatMap((s) =>
          s.set.endorsements
            .filter((e) => e.kind === "ai" || e.kind === "wos" || e.kind === "pnc")
            .map((e) => `${e.form} ${e.edition}`.trim()),
        ),
      ),
    );
    out.push({
      id: "desc",
      group: "Description Of Operations",
      label: "Description",
      display: packet.description,
      source: forms.length ? `${forms.join(" · ")} schedule` : "policy record",
    });
  }

  // Coverages beyond the printed rows — one reviewable line each, backed by
  // the same schedule of record the grid prints from.
  sheet.overflow.forEach((line, i) => {
    out.push({
      id: `desc.overflow.${i}`,
      group: "Description Of Operations",
      label: `Overflow — ${line.coverage}`,
      display: line.text,
      source: `${line.policyNumber} schedule of record`,
    });
  });

  return out;
}

// ——— Edited-sheet verification ———

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

/** verifyCoi finding ids → the sheet field the finding points at. */
function fieldIdForFinding(
  f: CoiFinding,
  sec: string,
  rs: { def: SectionDef } | null,
  insurerLetter: string,
): string | undefined {
  if (f.id === "holder-missing") return "holder.name";
  if (f.field === "insured") return "insured.name";
  if (f.id === "policy-mismatch") return `${sec}.policyNumber`;
  if (f.id === "carrier-mismatch") return `insurer.${insurerLetter}`;
  if (f.id === "term-early") return `${sec}.eff`;
  if (f.id === "term-late") return `${sec}.exp`;
  if (f.field === "description") return "desc";
  const limitMatch = /^limit-(?:absent|over|under|mode)-(.+)$/.exec(f.id);
  if (limitMatch) {
    const slot = limitMatch[1] as LimitSlot;
    const box = rs?.def.limitBoxes.find((b) => b.slot === slot);
    return box ? `${sec}.limit.${box.key}` : `${sec}.limit.${slot}`;
  }
  const flagMatch = /^flag-(.+)$/.exec(f.id);
  if (flagMatch) {
    const key = flagMatch[1] as keyof CoiFlags;
    if (key === "additionalInsured") return `${sec}.addl`;
    if (key === "subrogationWaived") return `${sec}.subr`;
    if (rs) {
      const checkKey = Object.entries(rs.def.flagChecks ?? {}).find(
        ([, flag]) => flag === key,
      )?.[0];
      if (checkKey) return `${sec}.check.${checkKey}`;
    }
  }
  return undefined;
}

/**
 * Re-verify the whole sheet with the operator's edits applied. Every edited
 * value flows into a patched per-policy draft and back through `verifyCoi`;
 * anything with no data source at all (blank sections, write-ins, split
 * BI/PD boxes) rejects the moment it holds a value, because nothing on the
 * schedule of record can back it.
 */
export function verifyEditedSheet(input: {
  account: Account;
  packet: CertificatePacket;
  sheet: Acord25Sheet;
  overrides: SheetOverrides;
}): { findings: SheetFinding[]; rejects: SheetFinding[]; warns: SheetFinding[] } {
  const { account, packet, sheet, overrides } = input;
  const findings: SheetFinding[] = [];

  const holderName = packet.holderName;
  const holderAddress = packet.holderAddress;
  const insuredDefault =
    packet.sections[0]?.draft.insuredName ?? account.name;
  const insuredName = effStr(overrides, "insured.name", insuredDefault);
  const description = effStr(
    overrides,
    "desc",
    certDescription(packet, sheet),
  );

  // The sheet defaults the INSURER line to the verified issuing company's
  // legal name (NAIC registry); unverified brands default to the record name.
  const insurerName = (letter: string) => {
    const ins = packet.insurers.find((i) => i.letter === letter);
    return effStr(
      overrides,
      `insurer.${letter}`,
      ins ? (ins.issuingCompany ?? ins.carrier) : "",
    );
  };

  const push = (
    ctx: { policyNumber: string; carrier: string },
    finding: CoiFinding,
    fieldId?: string,
  ) => findings.push({ ...ctx, finding, fieldId });

  const rejectUnbacked = (
    ctx: { policyNumber: string; carrier: string },
    fieldId: string,
    what: string,
  ) =>
    push(
      ctx,
      {
        id: `unbacked-${fieldId}`,
        severity: "reject",
        field: "limits",
        title: "Nothing On The Schedule Backs This Box",
        detail: `${what} holds a value, but no policy on the schedule of record feeds it — it can't be verified, so it can't be issued.`,
        fix: "Clear the box, or add the coverage to the schedule first.",
      },
      fieldId,
    );

  const noPolicyCtx = { policyNumber: "—", carrier: "—" };

  // Any populated edit inside a section no policy feeds is unverifiable.
  const rejectPopulatedNamespace = (
    prefix: string,
    sectionName: string,
  ) => {
    for (const [id, v] of Object.entries(overrides)) {
      if (!id.startsWith(`${prefix}.`)) continue;
      const populated = typeof v === "boolean" ? v : v.trim().length > 0;
      if (!populated) continue;
      push(
        noPolicyCtx,
        {
          id: `unbacked-${id}`,
          severity: "reject",
          field: "limits",
          title: "No Policy Backs This Section",
          detail: `The ${sectionName} section has no backing policy on the schedule — an entry here can't be verified, so it can't be issued.`,
          fix: "Clear the entry, or put the policy that carries it on the certificate.",
        },
        id,
      );
    }
  };

  /**
   * One limit box's effective text → a dollar claim, an Included / Excluded
   * statement, or a reject. Shared by the fixed sections and additional rows.
   * "Excluded" claims nothing, so it is always safe on a slot-backed line;
   * "Included" claims the line rides inside another limit, which only the
   * schedule can say; dollars flow into the draft for verifyCoi to compare.
   */
  const applyLimitText = (opts: {
    ctx: { policyNumber: string; carrier: string };
    id: string;
    raw: string;
    label: string;
    slot: LimitSlot | null;
    set: PolicyFormSet;
    limits: Partial<Record<LimitSlot, number>>;
  }) => {
    const text = opts.raw.trim();
    if (!text) return;
    if (!opts.slot) {
      rejectUnbacked(opts.ctx, opts.id, opts.label || "A blank limit box");
      return;
    }
    if (/^excluded$/i.test(text)) return;
    if (/^included$/i.test(text)) {
      const carried = opts.set.limits.find((l) => l.slot === opts.slot);
      if (!carried || limitMode(carried) !== "included") {
        push(
          opts.ctx,
          {
            id: `included-unbacked-${opts.slot}`,
            severity: "reject",
            field: "limits",
            title: `"Included" Isn't Backed By The Schedule`,
            detail: `${opts.label || "A limit box"} prints "Included", but the dec doesn't state this line as included in another limit — that's a coverage claim nothing backs.`,
            fix: "Show the scheduled value, or fix the schedule first.",
          },
          opts.id,
        );
      }
      return;
    }
    const { cents, invalid } = parseMoney(text);
    if (invalid) {
      push(
        opts.ctx,
        {
          id: `limit-unreadable-${opts.slot}`,
          severity: "reject",
          field: "limits",
          title: "Limit Isn't A Number",
          detail: `"${text}" in ${opts.label || "a limit box"} can't be read as a dollar amount, "Included", or "Excluded".`,
        },
        opts.id,
      );
      return;
    }
    if (cents != null) opts.limits[opts.slot] = cents;
  };

  interface SectionInput {
    sec: string;
    name: string;
    feeder: CertSection;
    rs: ResolvedSection | null;
    ref: {
      insurerLetter: string;
      policyNumber: string;
      effectiveDate: string;
      expirationDate: string;
      additionalInsured: boolean;
      subrogationWaived: boolean;
    };
    limits: Partial<Record<LimitSlot, number>>;
    extraFlags: Partial<CoiFlags>;
  }

  const verifySection = (si: SectionInput) => {
    const ctx = {
      policyNumber: si.feeder.policy.policyNumber,
      carrier: si.feeder.policy.carrier,
    };

    // A referenced policy with no number on the schedule of record renders
    // an honest blank — permitted (underreporting), but the operator must
    // see it before the sheet reads all-green.
    if (!si.ref.policyNumber.trim()) {
      push(
        ctx,
        {
          id: `policy-number-missing-${si.sec}`,
          severity: "warn",
          field: "policy",
          title: "Policy Number Missing From Schedule Of Record",
          detail:
            "A certificate holder cannot act on paper citing no policy number.",
          fix: "Record the policy number on the schedule of record, or issue knowingly blank.",
        },
        `${si.sec}.policyNumber`,
      );
    }

    // Dates: blank or unreadable can't be compared to the policy term.
    const parseDate = (fieldId: string, raw: string, kind: "eff" | "exp") => {
      const fallbackIso =
        kind === "eff" ? si.feeder.policy.effectiveDate : si.feeder.policy.expirationDate;
      if (!raw.trim()) {
        push(
          ctx,
          {
            id: `date-missing-${fieldId}`,
            severity: "reject",
            field: "term",
            title: kind === "eff" ? "Effective Date Required" : "Expiration Date Required",
            detail: "A certificate can't issue with a blank policy date.",
            fix: `The policy term on file is ${mdy(fallbackIso)}.`,
          },
          fieldId,
        );
        return fallbackIso;
      }
      const iso = isoFromMdy(raw);
      if (!iso) {
        push(
          ctx,
          {
            id: `date-invalid-${fieldId}`,
            severity: "reject",
            field: "term",
            title: "Date Isn't MM/DD/YYYY",
            detail: `"${raw}" can't be read as a date, so it can't be checked against the policy term.`,
          },
          fieldId,
        );
        return fallbackIso;
      }
      return iso;
    };

    const draft: CoiDraft = {
      holderName,
      holderAddress,
      insuredName,
      policyNumber: effStr(overrides, `${si.sec}.policyNumber`, si.ref.policyNumber),
      carrier: insurerName(si.ref.insurerLetter),
      effectiveDate: parseDate(
        `${si.sec}.eff`,
        effStr(overrides, `${si.sec}.eff`, mdy(si.ref.effectiveDate)),
        "eff",
      ),
      expirationDate: parseDate(
        `${si.sec}.exp`,
        effStr(overrides, `${si.sec}.exp`, mdy(si.ref.expirationDate)),
        "exp",
      ),
      limits: si.limits,
      flags: {
        ...emptyFlags(),
        additionalInsured: effBool(overrides, `${si.sec}.addl`, si.ref.additionalInsured),
        subrogationWaived: effBool(overrides, `${si.sec}.subr`, si.ref.subrogationWaived),
        ...si.extraFlags,
      },
      description,
    };

    const verdict = verifyCoi(draft, {
      account,
      policy: si.feeder.policy,
      set: si.feeder.set,
    });
    for (const f of verdict.findings) {
      // Description wording is checked once, against every selected schedule.
      if (f.field === "description") continue;
      push(ctx, f, fieldIdForFinding(f, si.sec, si.rs, si.ref.insurerLetter));
    }

    // Carrier knowledge gate — the same registry merge certificate.ts applies
    // to the packet: a provision an enforceable knowledge entry forbids on a
    // matching policy rejects here, so the review rail shows the wall the
    // one-door issuance check enforces.
    for (const hit of evaluateKnowledgeForCertSection({
      policy: si.feeder.policy,
      flags: draft.flags,
      account: { state: account.state, industry: account.industry },
    })) {
      const finding: CoiFinding = {
        id: `carrier-knowledge-${hit.entry.id}`,
        severity: "reject",
        field: "flags",
        title: `Forbidden By Carrier Knowledge — ${hit.entry.title}`,
        detail: `${FLAG_LABELS[hit.flag]} cannot attach to ${si.feeder.policy.carrier} ${si.feeder.policy.policyNumber}. ${hit.entry.detail} [Carrier Knowledge: ${hit.entry.id}]`,
        fix: `Remove the ${FLAG_LABELS[hit.flag]} provision from this line. ${hit.entry.consequence}`,
      };
      push(
        ctx,
        finding,
        fieldIdForFinding(
          { ...finding, id: `flag-${hit.flag}` },
          si.sec,
          si.rs,
          si.ref.insurerLetter,
        ),
      );
    }
  };

  // ——— Fixed sections ———
  for (const rs of sheet.sections) {
    const sec = rs.def.key;
    if (!rs.feeder || !rs.ref) {
      rejectPopulatedNamespace(sec, rs.def.name);
      continue;
    }
    const ctx = {
      policyNumber: rs.feeder.policy.policyNumber,
      carrier: rs.feeder.policy.carrier,
    };

    // Limit boxes → dollar claims, Included/Excluded statements, or rejects.
    const limits: Partial<Record<LimitSlot, number>> = {};
    for (const box of rs.def.limitBoxes) {
      const id = `${sec}.limit.${box.key}`;
      applyLimitText({
        ctx,
        id,
        raw: effStr(overrides, id, displayLimit(rs.limits[box.key])),
        label: box.label,
        slot: box.slot,
        set: rs.feeder.set,
        limits,
      });
      // LOC write-ins claim a location — only the schedule's own LOC prints.
      if (box.withLoc) {
        const locId = `${sec}.loc.${box.key}`;
        const scheduled = rs.locs[box.key] ?? "";
        const text = effStr(overrides, locId, scheduled).trim();
        if (text) {
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
          if (!scheduled) {
            rejectUnbacked(
              ctx,
              locId,
              `The ${box.label || "spare"} LOC write-in`,
            );
          } else if (norm(text) !== norm(scheduled)) {
            push(
              ctx,
              {
                id: `loc-mismatch-${sec}-${box.key}`,
                severity: "reject",
                field: "limits",
                title: "LOC Doesn't Match The Schedule",
                detail: `The ${box.label} row cites "${text}", but the dec states this limit at "${scheduled}".`,
                fix: "Use the schedule's location reference, or fix the schedule first.",
              },
              locId,
            );
          }
        }
      }
    }

    // Checkboxes: flag-mapped ones go through verifyCoi; the rest may only
    // be checked when the schedule resolves them checked.
    const extraFlags: Partial<CoiFlags> = {};
    for (const item of checkItemsOf(rs.def)) {
      const id = `${sec}.check.${item.key}`;
      const resolved = rs.checks[item.key] ?? false;
      const on = effBool(overrides, id, resolved);
      const flagKey = rs.def.flagChecks?.[item.key];
      if (flagKey) {
        extraFlags[flagKey] = on;
      } else if (on && !resolved) {
        push(
          ctx,
          {
            id: `check-unbacked-${sec}-${item.key}`,
            severity: "reject",
            field: "flags",
            title: `"${item.label || "This Box"}" Isn't Backed By The Schedule`,
            detail:
              "The box is checked, but nothing on this policy's schedule of record resolves it checked — an unbacked mark misstates the coverage.",
            fix: "Uncheck it, or fix the schedule first.",
          },
          id,
        );
      } else if (!on && resolved) {
        push(
          ctx,
          {
            id: `check-understated-${sec}-${item.key}`,
            severity: "warn",
            field: "flags",
            title: `"${item.label}" Unchecked Against The Schedule`,
            detail:
              "The schedule resolves this box checked. Showing less than carried is allowed, but usually a slip.",
          },
          id,
        );
      }
      // Write-ins never have a data source.
      if (item.writeInKey) {
        const wid = `${sec}.writein.${item.writeInKey}`;
        if (effStr(overrides, wid, "").trim()) {
          rejectUnbacked(ctx, wid, `The "${item.label || "write-in"}" line`);
        }
      }
    }

    verifySection({
      sec,
      name: rs.def.name,
      feeder: rs.feeder,
      rs,
      ref: rs.ref,
      limits,
      extraFlags,
    });
  }

  // ——— Additional rows ———
  sheet.others.forEach((row, i) => {
    const sec = `other${i}`;
    if (!row.feeder || !row.ref) {
      rejectPopulatedNamespace(sec, "additional coverage");
      return;
    }
    const ctx = {
      policyNumber: row.feeder.policy.policyNumber,
      carrier: row.feeder.policy.carrier,
    };

    // The type label must stay what the coverage part says it is.
    const label = effStr(overrides, `${sec}.label`, row.label);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (label.trim() && norm(label) !== norm(row.label)) {
      push(
        ctx,
        {
          id: `other-label-mismatch-${i}`,
          severity: "reject",
          field: "limits",
          title: "Type Of Insurance Doesn't Match The Coverage Part",
          detail: `The row is labeled "${label}", but the schedule carries "${row.label}".`,
          fix: "Use the coverage part's own name — the label is a coverage claim.",
        },
        `${sec}.label`,
      );
    } else if (!label.trim() && row.lines.length > 0) {
      push(
        ctx,
        {
          id: `other-label-blank-${i}`,
          severity: "warn",
          field: "limits",
          title: "Coverage Row Left Unlabeled",
          detail: `Limits print for "${row.label}" but the Type Of Insurance cell is blank.`,
        },
        `${sec}.label`,
      );
    }

    // Free write-in limit lines have no slot behind them on a backed row either.
    for (const [id, v] of Object.entries(overrides)) {
      if (
        (id.startsWith(`${sec}.limitLabel.`) || id.startsWith(`${sec}.limitValue.`)) &&
        typeof v === "string" &&
        v.trim()
      ) {
        rejectUnbacked(ctx, id, "A write-in limit line");
      }
    }

    const limits: Partial<Record<LimitSlot, number>> = {};
    for (const line of row.lines) {
      const id = `${sec}.limit.${line.slot}`;
      applyLimitText({
        ctx,
        id,
        raw: effStr(overrides, id, displayLimit(line.value)),
        label: line.label,
        slot: line.slot,
        set: row.feeder.set,
        limits,
      });
    }
    verifySection({
      sec,
      name: row.label || "additional coverage",
      feeder: row.feeder,
      rs: null,
      ref: row.ref,
      limits,
      extraFlags: {},
    });
  });

  // ——— Description Of Operations, checked once against every schedule ———
  const anchor =
    sheet.sections.find((rs) => rs.feeder)?.feeder ??
    sheet.others.find((r) => r.feeder)?.feeder ??
    null;
  if (anchor && description.trim()) {
    const merged: PolicyFormSet = {
      coverages: packet.sections.flatMap((s) => s.set.coverages),
      limits: packet.sections.flatMap((s) => s.set.limits),
      endorsements: packet.sections.flatMap((s) => s.set.endorsements),
    };
    const draft: CoiDraft = {
      ...anchor.draft,
      holderName,
      holderAddress,
      limits: {},
      flags: emptyFlags(),
      description,
    };
    const verdict = verifyCoi(draft, {
      account,
      policy: anchor.policy,
      set: merged,
    });
    for (const f of verdict.findings) {
      if (f.field !== "description") continue;
      push(
        { policyNumber: anchor.policy.policyNumber, carrier: anchor.policy.carrier },
        f,
        "desc",
      );
    }
  }

  // ——— Description overflow lines — schedule-backed, never invented ———
  // Every coverage beyond the printed rows carries a deterministic
  // `Policy, Eff, Exp, Coverage, Each Occurrence, Aggregate` line. A line
  // matching the schedule of record passes; a CSV-shaped line the schedule
  // can't back rejects (edited amount, invented policy); a deleted line
  // only warns — showing less than carried is allowed.
  {
    const normWs = (s: string) => s.replace(/\s+/g, " ").trim();
    const expected = new Map(sheet.overflow.map((l) => [normWs(l.text), l]));
    const seenLines = new Set<string>();
    const OVERFLOW_SHAPE =
      /^\S.*?,\s*\d{2}\/\d{2}\/\d{4},\s*\d{2}\/\d{2}\/\d{4},/;
    for (const raw of description.split("\n")) {
      const line = normWs(raw);
      if (!line) continue;
      if (expected.has(line)) {
        seenLines.add(line);
        continue;
      }
      if (OVERFLOW_SHAPE.test(line)) {
        push(
          noPolicyCtx,
          {
            id: `overflow-unbacked-${line.slice(0, 40)}`,
            severity: "reject",
            field: "description",
            title: "Overflow Line Isn't Backed By The Schedule",
            detail: `"${line}" reads as a policy schedule line, but no policy on the schedule of record produces it — an edited or invented line misstates coverage.`,
            fix: "Restore the extracted line, or remove it.",
            match: (() => {
              const start = description.indexOf(raw.trim());
              return start >= 0
                ? { text: raw.trim(), start, end: start + raw.trim().length }
                : undefined;
            })(),
          },
          "desc",
        );
      }
    }
    for (const [key, l] of expected) {
      if (seenLines.has(key)) continue;
      push(
        { policyNumber: l.policyNumber, carrier: l.row.feeder?.policy.carrier ?? "—" },
        {
          id: `overflow-missing-${l.policyNumber}-${l.coverage}`,
          severity: "warn",
          field: "description",
          title: "Overflow Line Removed",
          detail: `${l.coverage} (${l.policyNumber}) no longer appears in the description — the schedule carries it. Showing less than carried is allowed, but the holder won't see this coverage.`,
        },
        "desc",
      );
    }
  }

  // ——— Insurer block exhaustion — six printed lines, never a phantom G ———
  for (const ins of packet.insurers) {
    if (ins.letter !== "") continue;
    const anchor = packet.sections.find((s) => s.policy.carrier === ins.carrier);
    push(
      anchor
        ? { policyNumber: anchor.policy.policyNumber, carrier: ins.carrier }
        : noPolicyCtx,
      {
        id: `insurer-overflow-${ins.carrier}`,
        severity: "reject",
        field: "policy",
        title: "More Insurers Than The Form Carries",
        detail: `${ins.carrier} has no insurer line left — the printed block holds six insurers (A–F).`,
        fix: "Split the certificate by carrier, or attach an ACORD 101 for the additional insurers.",
      },
    );
  }

  // ——— NAIC cells — registry values only, never a typed-in guess ———
  for (const ins of packet.insurers) {
    const id = `naic.${ins.letter}`;
    const text = effStr(overrides, id, ins.naic ?? "").trim();
    if (!text) continue; // blank claims nothing — the honest state when unverified
    const anchor = packet.sections.find((s) => s.insurerLetter === ins.letter);
    const ctx = anchor
      ? { policyNumber: anchor.policy.policyNumber, carrier: anchor.policy.carrier }
      : noPolicyCtx;
    if (!ins.naic) {
      push(
        ctx,
        {
          id: `naic-unverified-${ins.letter}`,
          severity: "reject",
          field: "policy",
          title: "No Verified NAIC Code For This Carrier",
          detail: `Insurer ${ins.letter} (${ins.carrier}) has no verified entry in the NAIC registry mapping — "${text}" can't be backed, so the cell must stay blank.`,
          fix: "Clear the cell, or verify the issuing company's code first.",
        },
        id,
      );
    } else if (text !== ins.naic) {
      push(
        ctx,
        {
          id: `naic-mismatch-${ins.letter}`,
          severity: "reject",
          field: "policy",
          title: "NAIC # Doesn't Match The Registry",
          detail: `Insurer ${ins.letter} shows ${text}; the verified code for ${ins.issuingCompany} is ${ins.naic}.`,
          fix: `Use ${ins.naic} — NAIC registry (verified).`,
        },
        id,
      );
    }
  }

  // A holder is required even when nothing else changed.
  if (!holderName.trim()) {
    push(
      noPolicyCtx,
      {
        id: "holder-missing",
        severity: "reject",
        field: "holder",
        title: "No Certificate Holder",
        detail: "A certificate has to name who it's issued to.",
        fix: "Enter the holder exactly as the contract spells it.",
      },
      "holder.name",
    );
  }

  // Duplicate findings (same box, same story) collapse to one.
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const key = `${f.fieldId ?? ""}|${f.finding.id}|${f.finding.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    findings: deduped,
    rejects: deduped.filter((f) => f.finding.severity === "reject"),
    warns: deduped.filter((f) => f.finding.severity === "warn"),
  };
}
