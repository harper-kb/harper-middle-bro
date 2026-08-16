import type { DocPolicyFacts } from "./coi-doc-extract";
import { normalizeGateLine, splitCompoundLine } from "./lines/line-dispatch-rule.mjs";

// ── Ported from HTA's coi-data.ts (harper-coi-workbench @ 9d5f80595) ─────────
// The PURE half of that module only: the CoiContext shape the certificate
// factory consumes, the field-values → coverage fold (coverageFromFieldValues),
// and the shared coverage-line → certificate-section vocabulary
// (certificateLineSection / certificateLineKey) plus its row classifiers.
// The I/O half (loadCoiContext over Harper's prod SQL gateway) is deliberately
// NOT here — this repo's own adapter (context-adapter.ts) assembles CoiContext
// from the local schedule of record instead.

export interface CoiContext {
  companyId: string;
  issued: { artifactId: string; label: string } | null;
  company: {
    name: string | null;
    industry: string | null;
    subIndustry: string | null;
    city: string | null;
    state: string | null;
    email: string | null;
    street1?: string | null;
    street2?: string | null;
    zip?: string | null;
    country?: string | null;
  };
  policy: {
    namedInsured: string | null;
    policyNumber: string | null;
    status: string | null;
    effectiveDate: string | null;
    expirationDate: string | null;
    coverageLines: string[];
    /** Policy-level liability basis; unknown/null leaves both basis boxes blank. */
    coverageBasis?: string | null;
    limits: { line: string; label: string; amount: string }[];
    deductible: string | null;
    // When specialty OTHER content was folded from numbered sibling policies,
    // the identity that belongs on the OTHER row. Null = use the selected
    // policy's number/dates. Explicit null fields = withhold (mixed sibling
    // specialty — never stamp the selected GL number onto another policy's
    // Accident Health / PL / SAM).
    otherSection?: {
      policyNumber: string | null;
      effectiveDate: string | null;
      expirationDate: string | null;
    } | null;
  } | null;
  deal: {
    coverageType: string[];
    policyNumber: string | null;
    carrier: string | null;
    wholesaler: string | null;
    effectiveDate: string | null;
    expirationDate: string | null;
    bound: boolean;
  } | null;
  holder: { name: string | null; address: string | null; source: string | null };
  // The REAL filled cert values (Opal-extracted / BigBrother-editor), keyed by
  // Harper ACORD field_id. THIS is where a fully-filled issued cert's data lives
  // when insurance.policy / deals_v2 are empty. Primary source for both the
  // displayed policy fields and the editable ACORD 25 reconstruction.
  generatedCert: {
    fieldValues: Record<string, string>;
    dealId?: number | null;
    dealRefStatus?: Record<string, unknown> | null;
    status: string | null;
    createdAt: string | null;
    modelVersion: string | null;
    promptVersion: string | null;
    generationSource: string | null;
    extractionMetadata?: Record<string, unknown>;
    // The row's own identity + CAS token for the harper-tools correction door
    // (`service coi update`): id names the row; updatedAt is the EXACT
    // Postgres text form of updated_at (the door compares version strings
    // byte-for-byte, so a JSON-serialized ISO form would always conflict).
    certificateId: number | null;
    updatedAt: string | null;
  } | null;
  // THE DOCUMENT CORPUS (the roadside-account false-absence fix, DR 2026-07-07:
  // "This one says there's literally no carrier data, but there is literally
  // carrier data RIGHT HERE" — the IFG Companies Garage Coverage Binder was
  // sitting on the company's documents page). The bench may not claim "not in
  // the data" until it has looked HERE too: the binder / dec page / bound
  // application are the authoritative post-bind carrier + limits sources.
  // `binder` is the newest binder-or-dec-page pick; `carrierFromDocs` is the
  // carrier name read from that document's own title when the structured
  // fields are empty (a real record fact, cited to the document).
  docs: Array<{ artifactId: string; name: string; type: string | null; createdAt: string | null }>;
  binder: { artifactId: string; name: string; createdAt: string | null } | null;
  carrierFromDocs: string | null;
  // Same deterministic source Hercules uses. Null means "not on file" — the
  // mapper leaves the NAIC cell blank and the checker flags it.
  carrierNaic?: string | null;
  // THE DOCUMENT-EXTRACTION FALLBACK (the binder-on-file zero-fill,
  // 2026-07-14): when the structured stores hold no usable coverage, the
  // authoritative source document ON FILE (binder / dec page / policy PDF) is
  // read through harper-tools' own extraction door — the exact "re-extracted
  // into field values" path the read-only banner names. Loaded ONLY when the
  // higher tiers came up empty (saved cert values, or a policy row carrying
  // limits, outrank it); null when no extractable doc exists or the read
  // failed. Every fact traces to the ONE named document.
  docExtraction: DocPolicyFacts | null;
  // THE PRIOR-CERT TIER (the ladder's last rung): the newest generated
  // certificate whose field_values actually hold something, consulted only
  // when the newest row itself saved nothing (generatedCert null). Facts
  // folded from here carry "prior-cert" provenance — real evidence of what
  // Harper last certified, still confirm-before-issue.
  priorCert: {
    fieldValues: Record<string, string>;
    createdAt: string | null;
    certificateId?: number | null;
  } | null;
  // THE BILLING / COLLECTION-LEVERAGE READ (the round-2 teardown's gate-family
  // member, the CX runbook's rule: a past-due or pending-cancel account's
  // certificate is collection leverage, not a document to issue). Open rows on
  // BigBrother's own five cancellation-risk stages for this company. NULL =
  // the read failed or never ran (the honest no-data state — the checklist
  // says "check", it never claims current).
  billing: { pastDueOpenRows: number; stages: string[] } | null;
  // THE MULTI-LINE LEDGER (coi-issuance skill, multi-line reconciliation):
  // every deals_v2 row, each classified BOUND/UNBOUND, so the checklist can
  // refuse a requested-but-unbound line. Skill rule: BOUND = real policy
  // number AND deal_stage 'bound'; anything else (quote/pending/null) is
  // UNBOUND — a signed binding packet, a paid down payment, none of it binds.
  dealLines: Array<{ coverageType: string[]; policyNumber: string | null; carrier: string | null; bound: boolean; stage: string | null }>;
  // Lines the inbound request thread asks to certificate (keyword scan of the
  // same 15 newest inbound emails the holder heuristic already reads).
  requestedLines: string[];
  // THE OPERATOR-REMOVAL MEMORY (feedback plane #1089: "Coverage line removed:
  // WC. Why: they do not need workers' comp. I already gave this feedback"):
  // coverage sections THIS account's operators took off a generated certificate,
  // read back from their own recorded edit deltas. The fill ladder below is
  // record-first, so without this an operator's removal was undone on every
  // regeneration as long as the policy row still listed the line. Optional: a
  // context built without the read (or by a caller that has no delta store)
  // simply has no removals to honour.
  operatorRemovedLines?: string[];
  // THE MULTI-POLICY PANEL (Tanya's 7/9 finding #4): EVERY policy row on the
  // company — some companies carry one, some several — so the bench can
  // render a selector beside the certificate. `policy` above stays the ONE
  // the certificate reads from (the caller's selection, or the standing
  // prefer-bound-then-newest default).
  policies: PolicyOption[];
}

export interface PolicyOption {
  policyNumber: string | null;
  status: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  coverageLines: string[];
}

// Derive the display coverage (policy #, dates, carrier, insured, limits) from a
// generated_certificates field_values map — the Harper ACORD field_id contract.
// Reads ALL FOUR ACORD 25 coverage sections (GL / Auto / Umbrella / WC), each
// limit tagged with its section's line, so a prior certificate whose saved
// values are Auto- or WC-only folds back into a completion instead of reading
// as empty (Greptile's PR #544 catch) — and the line tags round-trip through
// completionToFieldValues' own per-section routing.
const FIELD_VALUE_SECTIONS: Array<{
  line: string;
  policyNumberId: string;
  effectiveId: string;
  expirationId: string;
  presenceIds: string[];
  limitIds: [string, string][];
  // The section's ACORD id prefix. The ids above are the ones that DECIDE the
  // section is present; the stem reaches the rest of its row (insurer letter,
  // ADDL INSD / SUBR WVD, the statutory and per-vehicle checkboxes) so a row
  // this table can remove is removed whole rather than left half-printed.
  idStem: string;
}> = [
  {
    line: "General Liability",
    idStem: "cgl",
    policyNumberId: "cglPolicyNumber",
    effectiveId: "cglPolicyEffectiveDate",
    expirationId: "cglPolicyExpirationDate",
    presenceIds: ["commercialGeneralLiabilityCheckbox", "cglOccurrenceCheckbox"],
    limitIds: [
      ["eachOccurrenceLimit", "Each Occurrence"],
      ["damageToRentedPremisesLimit", "Damage to Rented Premises"],
      ["medExpLimit", "Medical Expense"],
      ["personalAndAdvInjuryLimit", "Personal & Advertising Injury"],
      ["generalAggregateLimit", "General Aggregate"],
      ["productsCompOpAggLimit", "Products / Completed Ops"],
    ],
  },
  {
    line: "Automobile Liability",
    idStem: "auto",
    policyNumberId: "autoLiabilityPolicyNumber",
    effectiveId: "autoPolicyEffectiveDate",
    expirationId: "autoPolicyExpirationDate",
    presenceIds: ["autoAnyAutoCheckbox"],
    limitIds: [
      ["combinedSingleLimit", "Combined Single Limit"],
      ["bodilyInjuryPerPersonLimit", "Bodily Injury (Per person)"],
      ["bodilyInjuryPerAccidentLimit", "Bodily Injury (Per accident)"],
      ["propertyDamageLimit", "Property Damage"],
    ],
  },
  {
    line: "Umbrella Liability",
    idStem: "umbrella",
    policyNumberId: "umbrellaPolicyNumber",
    effectiveId: "umbrellaPolicyEffectiveDate",
    expirationId: "umbrellaPolicyExpirationDate",
    presenceIds: ["umbrellaLiabilityCheckbox"],
    limitIds: [
      ["umbrellaEachOccurrenceLimit", "Each Occurrence"],
      ["umbrellaAggregateLimit", "Aggregate"],
    ],
  },
  {
    line: "Workers Compensation",
    idStem: "workersComp",
    policyNumberId: "workersCompPolicyNumber",
    effectiveId: "workersCompPolicyEffectiveDate",
    expirationId: "workersCompPolicyExpirationDate",
    // EMPTY ON PURPOSE, and it is not the omission the other three sections'
    // entries would suggest. The PER STATUTE box (workersCompStatutoryCheckbox)
    // is what a statutory-only WC row prints off, but this read feeds /api/send's
    // certCoverageLines and the card's policy tier, where newly seeing a line
    // newly BLOCKS a send — a gate move with its own before/after (#2253's pin,
    // tests/coverage-line-wc-statutory-readd-ask-2253.test.ts). The removal plane
    // reads that box on its own terms instead: SECTION_EDIT_PRESENCE_IDS below.
    presenceIds: [],
    limitIds: [
      ["workersCompEachAccidentLimit", "Each Accident"],
      ["workersCompDiseaseEachEmployeeLimit", "Disease — Each Employee"],
      ["workersCompDiseasePolicyLimit", "Disease — Policy Limit"],
    ],
  },
];

export function coverageFromFieldValues(
  fv: Record<string, string>,
): { insured: string | null; policyNumber: string | null; carrier: string | null; effectiveDate: string | null; expirationDate: string | null; coverageLines: string[]; limits: { line: string; label: string; amount: string }[] } {
  const coverageLines: string[] = [];
  const limits: { line: string; label: string; amount: string }[] = [];
  let policyNumber: string | null = null;
  let effectiveDate: string | null = null;
  let expirationDate: string | null = null;
  for (const section of FIELD_VALUE_SECTIONS) {
    const sectionLimits = section.limitIds.filter(([id]) => fv[id]).map(([id, label]) => ({ line: section.line, label, amount: fv[id] }));
    const present = Boolean(fv[section.policyNumberId] || section.presenceIds.some((id) => fv[id]) || sectionLimits.length);
    if (!present) continue;
    coverageLines.push(section.line);
    limits.push(...sectionLimits);
    // The top-level policy facts keep first-present-section semantics: GL
    // first (the historical cgl* read, unchanged for GL certs), then whichever
    // section the cert actually saved — never a blank when a section holds one.
    if (!policyNumber) policyNumber = fv[section.policyNumberId] || null;
    if (!effectiveDate) effectiveDate = fv[section.effectiveId] || null;
    if (!expirationDate) expirationDate = fv[section.expirationId] || null;
  }
  // THE ACORD 25 "OTHER" ROW (operator ask #1390). Inland Marine, Liquor, EPLI
  // and every other specialty line have no section of their own, so the
  // generation names them in otherInsuranceDescription (coi-generate's OTHER
  // projection, joined with "; "). That row was write-only: /api/send reads the
  // certificate's OWN represented lines from HERE to feed the pre-send bind
  // check, so a line the paper represents but this read could not see was never
  // bind-checked, and an OTHER-only certificate read as carrying no policy
  // number at all. Read LAST, so the four sections above keep the
  // first-present-section semantics for the top-level facts.
  const otherLines = (fv.otherInsuranceDescription ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const line of otherLines) if (!coverageLines.includes(line)) coverageLines.push(line);
  if (otherLines.length) {
    if (!policyNumber) policyNumber = fv.otherInsurancePolicyNumber || null;
    if (!effectiveDate) effectiveDate = fv.otherInsurancePolicyEffectiveDate || null;
    if (!expirationDate) expirationDate = fv.otherInsurancePolicyExpirationDate || null;
  }
  return {
    insured: fv.insuredName || null,
    policyNumber,
    carrier: fv.insurerAName || null,
    effectiveDate,
    expirationDate,
    coverageLines,
    limits,
  };
}

// Does this cell name a SECOND line beside the one a rung is about to claim?
// The shared vocabulary's own split rule, asked rather than re-tabled so the
// record side and the requested side cannot disagree about one cell (#1612):
// `splitCompoundLine` parts a `/` only when both halves chart as DIFFERENT
// charted lines and the whole charts as none, which is why "Umbrella/Excess
// Liability" and "W/C" stay one line here. Exported for the removal plane, which
// has to arbitrate on the SAME read (queue-source's removalFamilyOf).
//
// A SEPARATOR IS NOT ONLY A SLASH (plane #2496's second rung). splitCompoundLine
// short-circuits on `if (!token.includes("/"))` — deliberately, because its own
// header says a LOADER that "knows only commas and plusses" hands the pair over
// already parted. This fold is not that loader: it reads the raw coverage_type
// cell, so the keystroke the operator typed decided whether one half claimed the
// whole cell ("EPLI/Workers Comp" kept its own bytes while "EPLI & Workers Comp",
// "EPLI, Workers Comp" and "Workers Comp and EPLI" charted as the whole WC row,
// and a recorded WC removal then took the sibling half's policy number, term and
// limits off a customer's certificate). Every separator is spelled as the one the
// splitter reads, so the DECISION stays the splitter's — which is what keeps the
// cells that ARE one row: "Workers Compensation & Employers' Liability" and
// "Employers Liability & Workers Comp" name a section named for BOTH its halves,
// and the splitter refuses to part them because the E.L. half carries no charted
// code. `,`/`;`/`+` are already the estate's line separators (lane-queue-source
// parts on /[,+]/, placements' item on /[,;+]/); an en/em dash needs no padding
// because it is never a compound hyphen. A BARE hyphen is left out on purpose: it
// is also how the record writes a qualifier, so reading it as a separator would
// decline "Excess-Workers Compensation", a cell that IS this row.
// CASE-INSENSITIVE because this reads the RAW cell while the arms below match on
// its lowercased form: without the flag a record shouting the separator ("EPLI
// AND WORKERS COMP", the coverage_type spelling an all-caps record writes) passed
// the arm and skipped the split, and the over-removal came back on that spelling
// alone.
const LINE_SEPARATOR_RE = /\s*[&+,;–—]\s*|\s+(?:-|and)\s+/gi;

// SCOPED TO THE RUNGS THAT ASKED FOR IT. The rewrite above is the WC rung's
// instrument (#2496) and the umbrella rung rode it deliberately (that pass's own
// LAW 4). Left unscoped it also re-parts the cells plane #2572 pinned as ONE
// answer on BOTH planes — "General Liability, Inland Marine" prints as, and is
// removed as, Commercial General Liability, which is the card-and-paper agreement
// #1089 asks for and an `IM` removal must not sweep. Those rungs each landed their
// compound guard on the SLASH reading their own pins measure, so a rewritten
// separator is read only where a parted half charts as the WC row or the umbrella
// row. The slash leg below is unscoped and unchanged: it is the splitter's own
// answer, not a rewrite of the operator's bytes.
// NAMED AS ROWS AND CHARTED THROUGH THE SAME VOCABULARY the halves are charted
// with, rather than as literal codes: a code the shared vocabulary renames would
// leave a literal matching nothing, and this scope FAILS OPEN — an empty scope
// silently folds "EPLI, Workers Comp" back to the whole WC row, which is the
// over-removal #2496 exists to close.
// THE PROPERTY ROW IS THE THIRD TO ASK (plane #2627, "Coverage line removed: Prop
// — Prop. Why: We do not need property." — #2055's and #2562's sentence a third
// time). #2562 landed that rung's compound guard on the SLASH alone, so which
// KEYSTROKE the operator typed between the two lines decided whether one half
// claimed the whole cell: "Commercial Property/Cargo" kept its own identity while
// "Commercial Property, Cargo" — the same two bound lines in one coverage_type
// cell — charted as the whole Property section, and the ask's own removal then
// took the cargo half's policy number, term and limits off a customer's
// certificate (with #1977's dedupe hiding it from the paper and #2316's print
// catch naming one line over a cell naming two). The card follows either way:
// removalFamilyOf's property arbitration is unconditional on this fold (#2055).
// A hand-cut separator anchor is what the scope set exists to avoid — the estate
// spells three of this line's own NAMES with a separator ("Commercial Property &
// Business Personal Property", "Property & Casualty", "Property, Special Form")
// and splitCompoundLine keeps every one of them whole because their other half is
// uncharted.
// THE SCOPE IS A ROW, NOT A RUNG, so the sibling rungs that ask namesTwoLines see
// this widening too ("General Liability & Property", "Inland Marine, Property",
// "Professional Liability & Property" now keep their own bytes). Each of those
// planes still agrees cell for cell — the GL (#2540) and inland marine (#2572)
// arbitrations are unconditional on the fold and the professional one (#2513) asks
// this same predicate — and the move is strictly FEWER removals, which is this
// matcher's standing safe direction: everything it catches leaves the paper.
const SEPARATOR_REWRITE_SECTIONS = new Set(
  ["Workers Compensation", "Umbrella", "Property"].map((row) => normalizeGateLine(row)),
);

// AND THE ROW THE INLAND MARINE RUNG IS ASKING ABOUT (plane #2605, the third `IM —
// Inland Marine` removal). #2546 wrote that rung's compound guard as
// `!namesTwoLines(normalized)` when these legs still read EVERY separator; the scope
// above then reduced the guard, on that rung alone, to the splitter's `/`. So one
// separator decided whether this line's removal took a stranger's coverage with it —
// `Inland Marine, Workers Comp` kept its own identity while `Inland Marine, EPLI`,
// `Cargo and Inland Marine` and `Inland Marine & Cargo` charted as this whole
// section. A UNION rather than a second instrument: a superset of rows can only ADD
// a decline, so this is provably narrowing, and SEPARATOR_REWRITE_SECTIONS itself
// does not move — which is what keeps #2572's blob cells whole, every one of them
// charting on a rung ABOVE this one that this rung therefore never sees.
const INLAND_MARINE_SEPARATOR_SECTIONS = new Set([
  ...SEPARATOR_REWRITE_SECTIONS,
  normalizeGateLine("Inland Marine"),
]);

function partsOnRewrittenSeparator(rewritten: string, sections: ReadonlySet<string | null>): boolean {
  const parts = splitCompoundLine(rewritten);
  return parts.length > 1 && parts.some((p) => sections.has(normalizeGateLine(p) ?? ""));
}

function namesTwoLinesAcross(cell: string, sections: ReadonlySet<string | null>): boolean {
  // Every leg, so this can only ever ADD a decline: no rewrite is always wider
  // than the raw read. "Directors & Officers/Workers Comp" parts on its slash
  // today, while its all-at-once rewrite ("Directors/Officers/Workers Comp")
  // carries a half the vocabulary does not chart and so reads as ONE line.
  if (splitCompoundLine(cell).length > 1) return true;
  if (partsOnRewrittenSeparator(cell.replace(LINE_SEPARATOR_RE, "/"), sections)) return true;
  // A SEPARATOR IS ALSO HOW A HALF SPELLS ITSELF. Rewriting every separator at
  // once parts a cell INSIDE a half — "E&O and Workers Comp" becomes
  // "E/O/Workers Comp", whose `E`/`O` the vocabulary does not chart, so the
  // whole read as ONE line and the WC arm went on claiming a cell that names
  // two. So each separator is also offered to the splitter ALONE, leaving the
  // others as the operator typed them: "E&O/Workers Comp" is two charted
  // halves. The splitter still decides — "WC & Employers Liability" rewrites to
  // "WC/Employers Liability" and stays one row, because the E.L. half carries
  // no charted code.
  return [...cell.matchAll(LINE_SEPARATOR_RE)].some((m) =>
    partsOnRewrittenSeparator(`${cell.slice(0, m.index)}/${cell.slice(m.index + m[0].length)}`, sections),
  );
}

export function namesTwoLines(cell: string): boolean {
  return namesTwoLinesAcross(cell, SEPARATOR_REWRITE_SECTIONS);
}

// The WC rung's four arms, hoisted so the rung can ask them about one `/` segment
// of a cell as well as about the whole cell (see the rung's own #2517 note). The
// words arm's own join is `[\s_-]*` (#2535's note on the rung) and it is written
// ONCE here, so the per-segment read and the whole-cell read cannot drift (#1612):
// `Workers-Comp` charts as this row on both, and `EPLI/Workers-Comp` on neither.
const WC_SECTION_CODE_RE = /^w\s*\/?\s*c(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/;
const WC_SECTION_WORD_RES = [
  /worker(?:['’]?s|s['’])?[\s_-]*comp[a-z]*(?:\s+[a-z]+)*$/,
  /^work\s?(?:er|m[ae]n)?'?s?'?\s?comp(?:ensation)?(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/,
  /employer'?s'? liability(?:\s+[a-z]+)*(?:\s+\([a-z ]+\))?$/,
];

function normalizeWcCell(cell: string): string {
  return cell.trim().replace(/\s+/g, " ").toLowerCase();
}

function namesWcRow(cell: string): boolean {
  const s = normalizeWcCell(cell);
  return WC_SECTION_CODE_RE.test(s) || WC_SECTION_WORD_RES.some((re) => re.test(s));
}

// The CODE arm alone, on the rung's OWN normalization (never a second copy of it —
// #1612), for the one question only it can answer: is this slash inside the code's
// own spelling? (see wcRowSegments' #3019/#3026 note.) Not namesWcRow: the word
// arms are head-free by design — a leading qualifier has to keep folding — so a
// junction read through them would join `Cargo` + `Employers Liability` into one
// segment and re-open the over-removal #2517/#2679 closed.
function namesWcCode(cell: string): boolean {
  return WC_SECTION_CODE_RE.test(normalizeWcCell(cell));
}

// The segments this rung asks its arms about, one per line the cell may name.
// Every separator #2496's rewrite already reads is spelled as the slash the
// splitter parts on, so the per-segment read and the compound guard above see the
// same keystrokes (#2679) — asked of the SHARED separator set rather than a second
// table of this rung's own (#1612).
// WITH ONE SUBTRACTION, stated here rather than tabled: the HYPHEN is this line's
// own join. The words arm's `[\s_-]*` charts `Workers-Comp` AND `Workers - Comp`
// as one spelling of one line (#2535), and a leading qualifier writes it too
// ("Excess-Workers Compensation"), so a hyphen inside a NAME can never be this
// rung's segment boundary.
// AND THAT SUBTRACTION IS THE JUNCTION, NOT THE KEYSTROKE (plane #2716, "Coverage
// line removed: WC — WC. Why: no wc" — the ninth arrival of this sentence). The
// spaced form was collapsed onto the bare one UNCONDITIONALLY, which deleted
// `\s+-\s+` — one of LINE_SEPARATOR_RE's OWN alternations — before the shared set
// above was ever consulted. So on this rung alone the spaced hyphen stopped being a
// separator, and #2679's defect stayed open on that one keystroke wherever the
// compound guard cannot see the other half: `Crime, Workers Comp` and `Crime –
// Workers Comp` kept their own identity while `Crime - Workers Comp`, `Fiduciary -
// Workers Comp`, `Cargo - Employers Liability` and `EPLI - Employers Liability`
// charted as the whole statutory row, at the three costs this rung's arms already
// name (the say-it-once dedupe eats the other half, the ask's own removal drops
// that half's policy number, term and limits off a customer's certificate, and
// readableLine IS this fold, so the cell prints one line's name over a cell naming
// two).
// So the collapse now asks WHERE the hyphen sits: the two tokens either side are
// joined and offered to this rung's OWN arm (namesWcRow, never a second vocabulary
// — #1612). `Workers-Comp` names the row, so that hyphen is inside one line and the
// collapse stands; `Crime-Workers` does not, so LINE_SEPARATOR_RE charts it as the
// separator it already is. Provably NARROWING — the collapse can only be WITHHELD,
// never added — which is this matcher's standing safe direction. The row named for
// BOTH its halves is untouched because neither junction joins into a name:
// `Workers Compensation - Employers Liability` and `WC - Employers Liability` are
// read as SEGMENTS, and every segment names the row.
// KNOWN MISS left standing: a cell naming a second line across a BARE hyphen
// (`EPLI-Workers Comp`). It has no token boundary to arbitrate, so any rule that
// declined it would also decline `Workers-Comp` and the pinned
// `Excess-Workers Compensation`, which ARE this row.
// AND THE SLASH IS THIS LINE'S OWN JOIN TOO (planes #3019, "Coverage line removed:
// WC — WC. Why: not here", and #3026, "…Why: not needed" — the eleventh arrival of
// this sentence, twice, and the KNOWN MISS #2933's note named and deferred). `W/C`
// is the ONE spelling of this row that carries the SPLITTER'S separator INSIDE one
// line, so the `.split("/")` below shattered the code arm's own slash into `W` and
// `C`, neither of which names anything. The row is named for BOTH its halves, so
// this fell past `.every` in EITHER direction: the mirror pairs the bare code
// already folds — `WC, Employers Liability` (#2679) and `Employers Liability, WC`
// (#2933) — stayed open one spelling over, while `W/C, Employers Liability`,
// `Employers Liability & W/C`, `W/C & Employers Liability`, `Workers Comp & W/C`
// and `Workers Comp, W/C` kept their own bytes. So the keystroke went on deciding
// whether a recorded WC removal reached the row, at the three costs this rung's
// arms already name (the removal missed the row and it re-printed as the record's
// bare cell on the OTHER row with the statutory row left empty, the say-it-once
// ladder charted one line twice, and the card kept the row the paper kept).
// So the junction is asked here, exactly as the spaced hyphen's already is (#2716):
// two adjacent segments are re-joined on their `/` when the join names the row on
// THIS rung's own hoisted CODE arm, never a second vocabulary (#1612). Guarded on
// WC_SECTION_CODE_RE alone rather than on namesWcRow, whose E.L. word arm is
// head-unanchored — `namesWcRow("EPLI/Employers Liability")` is TRUE, and merging on
// it would re-open the over-removal #2517 closed. The code arm is anchored at BOTH
// ends, so the only merge it admits is a `w` segment beside a `c` one, and neither
// is a charted line on its own: no cell that declines today for naming a SECOND line
// can start folding. The fold stays bounded to cells where EVERY segment names this
// row — one row named for both its halves, or one line said twice: `W/C, EPLI`,
// `EPLI/W/C` and `Crime - W/C` still keep their own identity, because `namesWcRow`
// declines that half.
function wcRowSegments(cell: string): string[] {
  const segments = cell
    .replace(/(\S+)\s+-\s+(?=(\S+))/g, (whole, head: string, tail: string) =>
      namesWcRow(`${head}-${tail}`) ? `${head}-` : whole,
    )
    .replace(LINE_SEPARATOR_RE, "/")
    .split("/");
  return segments.reduce<string[]>((out, segment) => {
    const head = out[out.length - 1];
    if (head !== undefined && namesWcCode(`${head}/${segment}`)) out[out.length - 1] = `${head}/${segment}`;
    else out.push(segment);
    return out;
  }, []);
}

// The professional rung's arms, hoisted on the WC rung's terms and for the same
// reason (see that rung's #2633 note): the rung asks them about one `/` segment
// of a cell as well as about the whole cell, so it arbitrates itself against the
// vocabulary it already states rather than against a second copy of it (#1612).
// Exported because the CARD's own professional arbitration asks the same
// question (queue-source's removalFamilyOf), which is what keeps the two planes
// from disagreeing about one cell (#1089). The words arm's own connector is
// OPTIONAL and its join is `[\s_-]*` (#2591's two notes on the rung), written
// ONCE here on the WC hoist's terms, so the per-segment read and the whole-cell
// read cannot drift (#1612): `Errors-Omissions` charts as this row on both, and
// `Crime/Errors-Omissions` on neither.
const PROFESSIONAL_SECTION_CODE_RES = [
  /^e\s*&\s*o(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/,
  /^errors?[\s_-]*(?:&|and)?[\s_-]*omissions?(?:[\s_-]+(?:liability|liab|coverage|insurance|policy|line))*$/,
];

// THE FAMILY WORD IS THE WHOLE WORD (plane #3001, "Coverage line removed: E&O —
// E&O. Why: no E&O" — the sixth arrival of that sentence, and "no E&O" is the
// operator saying the account carries no professional line at all). This leg was
// `s.includes("professional")`, so a cell merely CARRYING the letters wore the
// section: a bound `Professionals Choice Package` charted here, and readableLine
// IS this fold, so the ACORD 25 OTHER row PRINTED "Professional Liability" on a
// certificate for an account that has none — the claims-coverage-that-does-not-
// exist direction every rung here guards. It cost the removal plane the other
// way too: removalFamilyOf answers off this predicate, so a recorded `E&O`
// removal swept that bound package row, its policy number and its limits off the
// card while the paper kept printing it (#1546's over-removal half).
// The law is not new — #2925 already made the checklist's own read
// (namesTheProfessionalLine) the whole word, citing this same cell — so the fold
// and the pre-issue check were answering differently for one spelling, the drift
// #1612's one-reading law exists to stop. Named as its own before/after by both
// tests/coverage-line-pl-bare-code-removal-identity-ask-2401.test.ts and
// tests/coverage-line-professional-underscore-word-boundary-pin.test.ts; this is
// that pass.
// THE BOUNDARY IS NON-ALPHANUMERIC, not `\b`: JS counts `_` as a word character,
// so `\bprofessional\b` would refuse `professional_liability` — a spelling this
// estate charts as live on this very row (#2591) — and refusing it re-opens the
// same false read from the other side.
// Strictly NARROWING, this matcher's standing safe direction: a cell it stops
// charting falls to the "an unrecognized line is its own removal identity" tail
// and keeps its own bytes on both planes. KNOWN MISS, named rather than closed: a
// solid `ProfessionalLiability` goes with it, exactly as it already does on the
// checklist — charting the solid spelling means moving BOTH reads together, and
// what this pass buys is that they agree.
const PROFESSIONAL_FAMILY_WORD_RE = /(?:^|[^a-z0-9])professional(?:[^a-z0-9]|$)/;

export function namesProfessionalRow(cell: string): boolean {
  const s = cell.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    PROFESSIONAL_FAMILY_WORD_RE.test(s) ||
    s === "pl" ||
    s === "prof" ||
    PROFESSIONAL_SECTION_CODE_RES.some((re) => re.test(s))
  );
}

// The property rung's arms, hoisted on the WC and professional rungs' terms and
// for the same reason (see that rung's #2637 note): the rung asks them about one
// `/` segment of a cell as well as about the whole cell, so it arbitrates itself
// against the vocabulary it already states rather than against a second copy of
// it (#1612). #2055's `Property Damage` narrowing is stated HERE rather than only
// on the rung, so the per-segment read and the whole-cell read cannot drift:
// `Property Damage` is the automobile row's limit label on both.
// THE THIRD BARE CODE IS WRITTEN HERE ONCE for the same reason (plane #3028,
// "Coverage line removed: Prop — Prop. Why: no prop" — the eighth arrival of this
// sentence on this line). See the rung's own note below for what it cost.
function namesPropertyRow(cell: string): boolean {
  const s = cell.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    s === "prop" ||
    s === "cp" ||
    s === "bpp" ||
    (s.includes("property") && !/\bproperty\s+damage\b/.test(s))
  );
}

// The umbrella rung's arms, hoisted on the WC, professional and property rungs'
// terms and for the same reason (see that rung's #2799 note): the rung asks them
// about one `/` segment of a cell as well as about the whole cell, so it
// arbitrates itself against the vocabulary it already states rather than against a
// second copy of it (#1612). Exported because the CARD's own umbrella arbitration
// asks the same question (queue-source's removalFamilyOf), which is what keeps the
// two planes from declining different cells (#1089).
//
// EXCESS & SURPLUS IS THE PAPER, NOT THE LINE (plane #3038, "Coverage line
// removed: Umb — Umbrella. Why: no umb" — the fifth arrival of that sentence, and
// "no umb" is the operator saying the account carries no umbrella line at all).
// The `excess` arm is a bare substring, so a bound row that names the MARKET it is
// written on — `Excess & Surplus`, `Excess and Surplus Lines`, `Excess & Surplus
// Property` — wore this section, and readableLine IS this fold, so the ACORD 25
// PRINTED an Umbrella line for an account with none: the claims-coverage-that-does-
// not-exist direction every rung here guards. It cost the removal plane the other
// way too — removalFamilyOf arbitrates on this predicate, so the ask's own recorded
// `Umb` removal swept that bound row, its policy number and its limits off the card
// while the paper kept printing it (#1546's over-removal half).
// The law is not new: detectRequestedLines names "excess and surplus paper" as the
// very reason bare `excess` earns no line on the REQUEST side (#1125), so the two
// reads were answering differently for one spelling — the drift #1612's one-reading
// law exists to stop, and the before/after shape #3001 landed one rung over.
// STATED HERE rather than on the rung, on the property rung's `Property Damage`
// terms (#2055): the per-segment read and the whole-cell read cannot drift.
// Strictly NARROWING, this matcher's standing safe direction: a cell it stops
// charting falls to the rungs BELOW — `Excess & Surplus Property` charts as the
// property section it really names — or to the "an unrecognized line is its own
// removal identity" tail, where it keeps its own bytes on both planes.
// KNOWN MISS, named rather than closed: coi-checklist's `["umbrella", "excess"]`
// alias family still reads these cells by containment, so a requested Umbrella
// still clears against a bound E&S row. That is the pre-issue check's own
// before/after, the order the professional row took (#2925 before #3001).
const EXCESS_SURPLUS_PAPER_RE = /\bexcess\s*(?:&|\+|\/|and\s)?\s*surplus\b/;

export function namesUmbrellaRow(cell: string): boolean {
  const s = cell.trim().replace(/\s+/g, " ").toLowerCase();
  if (EXCESS_SURPLUS_PAPER_RE.test(s)) return false;
  return s === "umb" || s.includes("umbrella") || s.includes("excess");
}

// The general-liability rung's arms, hoisted on the WC, professional, property and
// umbrella rungs' terms and for the same reason (see that rung's #2934 note): the
// rung asks them about one `/` segment of a cell as well as about the whole cell,
// so it arbitrates itself against the vocabulary it already states rather than
// against a second copy of it (#1612). The CARD needs no arm of its own —
// removalFamilyOf's general-liability arbitration is unconditional on this fold
// (#2540) — which is what keeps the two planes from declining different cells
// (#1089).
// BOTH CODE SPELLINGS IN ONE READ, so the generic-noun tail cannot belong to one
// of them and not the other (plane #3162, "Coverage line removed: GL — GL. Why: no
// GL"). The bare code was the last charted code on this ladder still read as exact
// EQUALITY while every rung around it — the `CGL` arm this expression already held,
// and the WC, automobile, D&O, BOP and cyber rungs — takes the generic nouns the
// estate suffixes a line with. See certificateLineSection's own rung below for what
// that cost. Anchored at both ends and the tail admits only those nouns, so
// `GL-2026-114`, `GL/EPLI`, `GL Cyber` and `GL Products` still keep their own
// identity. KNOWN MISS, named rather than closed: `G/L` carries the splitter's own
// separator inside one code, the shape #3026 arbitrated one rung over for `W/C`.
// KNOWN DIVERGENCE, tracked rather than assumed away: the SEND gate's shared
// vocabulary (normalizeGateLine) charts neither the tail forms nor `CGL`, because
// charting a line there turns an uncharted token into a `missing`, therefore
// `blocking`, one — a send-gating change with its own before/after, frozen this
// pass on purpose (#3182). So `GL Policy` is this section on the fold and its own
// token at dispatch, and the disagreement runs ONE way only (fail-safe: the gate
// holds a send, it never releases one the fold declined). The set it disagrees on
// is enumerated behaviourally in
// tests/coverage-line-gl-tail-send-gate-divergence-ask-3162.test.ts, so a later
// pass cannot read either plane's answer as the other's.
const GL_SECTION_CODE_RE = /^c?gl(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/;

function namesGeneralLiabilityRow(cell: string): boolean {
  const s = cell.trim().replace(/\s+/g, " ").toLowerCase();
  return GL_SECTION_CODE_RE.test(s) || s.includes("general liab");
}

// The inland-marine rung's arms, hoisted on the WC, professional, property,
// umbrella and general-liability rungs' terms and for the same reason (see that
// rung's #2993 note): the rung asks them about one `/` segment of a cell as well as
// about the whole cell, so it arbitrates itself against the vocabulary it already
// states rather than against a second copy of it (#1612). The words read is
// #1390's own `\b…\b` — written ONCE here, so the per-segment read and the
// whole-cell read cannot drift on the boundary that refuses "Mainland Marine".
// The CARD needs no arm of its own — removalFamilyOf's inland-marine arbitration
// defers to this fold (#2546) — which is what keeps the two planes from declining
// different cells (#1089).
const INLAND_MARINE_WORDS_RE = /\binland\s*marine\b/;

function namesInlandMarineRow(cell: string): boolean {
  const s = cell.trim().replace(/\s+/g, " ").toLowerCase();
  return s === "im" || INLAND_MARINE_WORDS_RE.test(s);
}

// ── THE ONE COVERAGE-LINE → CERTIFICATE SECTION READING ───────────────────────
// A record's coverage_type is free-form ("GL", "W/C", "Employers Liability");
// the certificate carries canonical section names. This is the SINGLE reading
// that maps one to the other, shared by the certificate generation
// (coi-generate) and the queue card's policy tier (queue-source) — a removal is
// recorded in this vocabulary, so both planes have to fold a spelling the same
// way or a line an operator took off the paper survives on the card (#1089).
// It is deliberately NOT coverageFamilyOf (service/coi-qa-gate): that vocabulary
// has a `gl` catch-all for every leftover liability spelling, which would read
// "Employers Liability" as General Liability and let a GL removal strip it.
export function certificateLineSection(t: string): string {
  // Trimmed, because a padded record spelling ("WC ") used to fall through to
  // the verbatim return below — which both defeated an operator's removal of
  // that line (#1089) and mis-routed it onto the OTHER row. Interior runs collapse
  // for the same reason and to the same rule the shared line vocabulary already
  // applies (normalizeGateLine): "Commercial  Property" is one spelling of one
  // line, and every substring test below is written with single spaces.
  const normalized = t.trim().replace(/\s+/g, " ");
  const s = normalized.toLowerCase();
  // `CGL` IS THIS SECTION (plane #2459, "Coverage line removed: GL — GL. Why: no
  // GL"). The bare code and the words were this rung's only spellings, so the
  // three-letter code the bound book actually writes fell through to the
  // "an unrecognized line is its own removal identity" tail — while four other
  // planes already chart it: the bound book's OWN measured vocabulary
  // (renewal-checklist.ts's deals_v2 coverage_type aliases, `gl · cgl ·
  // generalliability · commercialgeneralliability · generalliab`),
  // removalFamilyOf's GL_SPECIFIC_RE, coverageFamilyOf and the bind key's
  // NAMES_GL_RE, and the ACORD 25's own GL field ids (`cglPolicyNumber`,
  // `cglOccurrenceCheckbox`). So the CARD swept the line on a GL removal while
  // the paper kept printing it — the two-plane disagreement #1089's shared fold
  // exists to prevent — and it cost the other two ways this file measures:
  // a record carrying `GL` beside `CGL` named ONE line twice (#1977's shape),
  // and, having no standard section identity, the row printed as the bare code
  // on the OTHER row with the GENERAL LIABILITY section left empty (#997's
  // shape) where a recorded `GL` removal could never reach it.
  // ANCHORED at both ends on #1546's terms — the code, then only the GENERIC
  // nouns this estate suffixes a line with — so `CGL-2026-114` stays a policy
  // number, `CGL/EPLI` stays a compound cell keeping its own identity, and
  // `CGL Cyber` stays its own line.
  //
  // THE WORD ARM takes the compound-cell refusal every sibling rung already
  // states — the before/after #2459 named and deferred, arriving as the third `GL`
  // removal on the plane (#2540, "Coverage line removed: GL — GL. Why: No GL").
  // Read as a bare substring it charted a cell naming this line BESIDE another as
  // this whole section — `General Liability/EPLI`, `EPLI/General Liability`,
  // `General Liability/Cargo` — and all three seams that key on the identity paid
  // for it: the say-it-once dedupe folded a record's `General Liability` and
  // `General Liability/EPLI` into ONE line, so the EPLI half's limit never reached
  // the paper and filed itself in the GL row's own free-text cell (#1977's shape);
  // a recorded GL removal then dropped the compound cell WHOLE, taking that half's
  // policy number, term and limits off a customer's certificate — and, crossing
  // the other way, blanking the cell's OTHER row recorded a removal of the
  // account's REAL bound general liability (#2404's shape, both directions); and
  // readableLine IS this fold, so the cell PRINTED one line's name over a cell
  // naming two (#2316's print catch).
  // ASKED OF THE SHARED SPLITTER rather than anchored with a third hand-cut regex,
  // because two spellings this estate pins would not survive one: "General
  // Liability - Products Only" (#1523's collision table) and "General  Liability"
  // (#1523's whitespace pin). splitCompoundLine is the estate's ONE rule for
  // whether a cell names two lines, so the record side cannot drift from the
  // requested side (#1612), exactly as the umbrella rung asks it (#2460). Scoped
  // to the WORD arm: both code arms are anchored already and carry no separator to
  // read.
  // THE SCOPED PREDICATE, not the splitter's bare read (plane #2572, the second
  // "Coverage line removed: IM — Inland Marine" arrival, then #2627's property
  // widening). #2496 hung the separator rewrite on the SHARED predicate while it
  // still read EVERY row, and it reshaped this rung as a side effect its own note
  // only reasoned about one arm over: a cell the paper charts as THIS section
  // beside another line — "General Liability, Inland Marine", "Inland Marine,
  // General Liability" — stopped folding here and fell to the verbatim tail, so the
  // card's inland-marine read had no fold to arbitrate against (removalFamilyOf's
  // #2546 arm) and an `IM` removal took a bound GENERAL LIABILITY row, its limits
  // and its money off the board while the certificate went on printing it — then
  // family-first hid that same row from the general-liability removal that really
  // did name it (#1089, both directions). What answers that is
  // SEPARATOR_REWRITE_SECTIONS, which #2572 landed on the predicate itself: inland
  // marine is not a scoped row, so every blob cell that plane pinned still charts
  // here, and #1523's collision spellings ("General Liability - Products Only",
  // "General  Liability") survive for the same reason — their other half is not a
  // scoped row either. Asking the scope back gives this rung the property row a
  // parted half really does chart as (#2627): "General Liability & Property" keeps
  // its own bytes instead of losing the property half's policy number, term and
  // limits to a recorded `GL` removal. Strictly FEWER claims than the bare read,
  // which is this matcher's standing safe direction.
  // AND THE HALF THE SPLITTER CANNOT CHART (plane #2934, "Coverage line removed:
  // GL — GL. Why: no GL"). namesTwoLines IS splitCompoundLine, which refuses to
  // part a cell unless the shared vocabulary charts EVERY half, so `Crime`,
  // `Fiduciary` and `Stop Gap` — real bound lines this estate's line codes do not
  // name — left #2540's guard blind and the raw substring word arm claimed the
  // whole cell, at the three costs the note above already names (the say-it-once
  // dedupe eats the other half, the ask's own removal drops that half's policy
  // number, term and limits off a customer's certificate, and readableLine IS this
  // fold, so the cell prints one line's name over a cell naming two — with
  // isOtherCoverageLine barring it from the OTHER row, the other half's money
  // filled the real ACORD 25 GENERAL LIABILITY section). It lands on the WC
  // (#2517), professional (#2633), property (#2637) and umbrella (#2799) rungs'
  // terms: THIS rung's arms, hoisted, asked per `/` segment, so there is no second
  // general-liability vocabulary to drift from this one (#1612). Purely narrowing —
  // a slashless cell is one segment and every cell reaching this arm names the row
  // for itself.
  // SCOPED TO `/`, unlike the separator rewrite above: LINE_SEPARATOR_RE reads the
  // SPACED HYPHEN, and "General Liability - Products Only" is a cell #1523's
  // collision table pins as THIS row, so a shared-set segment read would decline
  // it. A non-slash separator beside an uncharted half stays this rung's KNOWN
  // MISS, named rather than closed, beside the umbrella and property rungs' own —
  // and closing it would also re-part the blob cells #2572 pins as ONE answer on
  // BOTH planes ("General Liability, Inland Marine").
  //
  // AND THE BARE CODE TAKES THE GENERIC-NOUN TAIL ITS OWN SIBLING ARM ALREADY HAD
  // (plane #3162, "Coverage line removed: GL — GL. Why: no GL" — the fifth arrival
  // of this sentence). The bare code was read as exact EQUALITY, sitting beside a
  // `CGL` arm taking `(liability|liab|coverage|insurance|policy|line)`, and beside WC,
  // automobile, D&O, BOP and cyber rungs that all take it too: `CGL Policy` charted
  // and `GL Policy` did not. So the commonest line in the book, suffixed the way a
  // record suffixes it, fell to the "an unrecognized line is its own removal
  // identity" tail, and it cost every seam that keys on this identity — a recorded
  // `GL` removal could not reach the row, so the line the operator struck came back
  // at the next generation (#1089, and the ask's own "no GL"); having no standard
  // section identity the row PRINTED as the bare cell on the OTHER row with the
  // real GENERAL LIABILITY section left empty (#997's shape); the say-it-once dedupe
  // keys on this fold, so `GL` beside `GL Policy` was one line charted twice
  // (#1977's shape); and STANDARD_POLICY_SECTION carried the same `^gl$`, so a bound
  // same-account SIBLING spelled that way read as SPECIALTY and lent this
  // certificate its coverage, its money and its OTHER-row identity (#2431's cost).
  // Read through GL_SECTION_CODE_RE, which now holds BOTH code spellings, rather
  // than as a third hand-cut pattern beside them (#1612) — and the merge gate takes
  // the same bytes in the same pass, because widening the fold alone would route
  // another policy's money into the real ACORD 25 GL row under the SELECTED policy's
  // number (#2535's rule). Purely ADDITIVE and anchored at both ends: strictly more
  // charted cells here, strictly fewer merges there, and nothing that charts today
  // changes answer.
  if (
    GL_SECTION_CODE_RE.test(s) ||
    (s.includes("general liab") && !namesTwoLines(normalized) && normalized.split("/").every(namesGeneralLiabilityRow))
  ) {
    return "Commercial General Liability";
  }
  // PRODUCT LIABILITY IS A LINE (plane #2529, "Coverage line removed: ProdL —
  // Product Liability. Why: no prod"). This ladder charted nineteen sections and
  // not one of them was products, so EVERY spelling of ONE line fell through the
  // "an unrecognized line is its own removal identity" tail and became its own
  // identity — `ProdL`, `PROD`, `Product Liability`, `Products Liability` — while
  // every other plane already folds them together (normalizeGateLine's
  // `product liability` → `PROD`, LINE_LABELS' `PROD: "Product Liability"` in both
  // the dispatch vocabulary and the routing board, the IQ taxonomy's own
  // `/^product\s*liab/i`). The BOP/D&O/Surety/Cyber/A&M class exactly: a line
  // carrying NO CoverageFamily, whose only removal identity IS this fold. So the
  // ask's own removal — recorded off the screen's code — could not reach a policy
  // row spelled in words: the line the operator took off re-printed at the next
  // generation and survived the stored sheet's strip (#1523/#2138), a record
  // carrying both spellings named ONE line TWICE (#1977), and, having no section
  // identity, the row PRINTED the bare code on the OTHER row (#997).
  // BELOW THE GENERAL-LIABILITY RUNG, which is the only rung this one collides
  // with: "General Liability - Products Only" is charted GL by #1523's collision
  // table and has to stay GL.
  // THE WORD ARM REQUIRES `liab` — this line's `Property Damage` narrowing (#2055).
  // `Products / Completed Ops` is the GL section's own aggregate LIMIT label
  // (productsCompOpAggLimit above), not a standalone line, and #2138 already pins
  // the spelling as keeping its own identity.
  // ANCHORED AT BOTH ENDS, so a separator ends the cell's claim in either position
  // and `Product Liability/Cargo`, `Cargo/Product Liability` and `PRODL-2026-114`
  // keep their own identity with no second compound guard — the anchored `CGL` and
  // `WC` code arms' terms. The canonical name is the one the rest of the estate
  // writes AND the one this spelling already fell through to, so no removal
  // identity recorded before this rung shifts meaning. The CARD needs no arm:
  // coverageFamilyOf answers `gl` for the words through its bare-`liability`
  // catch-all, which removalFamilyOf's standing GL_SPECIFIC_RE guard (#1546) nulls,
  // so every spelling carries no family and answers on the name leg this makes one.
  if (
    s === "prodl" ||
    s === "prod" ||
    /^prod(?:uct)?s?\s+liab(?:ility)?(?:\s+(?:coverage|insurance|policy|line))*$/.test(s)
  ) {
    return "Product Liability";
  }
  // "W/C" and "Worker's Comp" (singular possessive — it does NOT contain
  // "workers") are live coverage_type spellings; see coverageFamilyOf's own
  // note in service/coi-qa-gate.ts.
  // EVERY arm below is anchored at its TAIL on #1546's terms, so no cell that
  // merely CARRIES a WC spelling charts as this whole section. That anchoring is
  // what makes this rung's widenings safe under its standing rule: everything the
  // matcher catches LEAVES a customer's certificate when WC is the removal, so a
  // matcher read one byte wider than its pin strips real coverage.
  //
  // THE CODE ARM (plane #2240, "Coverage line removed: WC — WC. Why: does not do
  // WC"). It was the last bare-code rung here still read as a PREFIX, so a cell
  // that merely CARRIED the letters charted as this whole section: `WC-2026-114`
  // and `WC/EPLI` were the WC line. Both seams that key on this identity paid for
  // it — the say-it-once dedupe folded a record's `WC` and `WC/EPLI` into ONE
  // line, so the second never reached the paper at all, and a recorded WC removal
  // then dropped the compound cell WHOLE, taking the EPLI half's policy number and
  // limits off a customer's certificate. A compound cell keeps its own identity,
  // the same refusal the D&O rung states.
  //
  // THE WORD ARM — the RECORD's short spellings, folded on the pin this rung's
  // former known-misses note asked for ("Coverage line removed: WC — WC. Why: not
  // WC UW", plane #2138). "Work Comp", "WorkComp" and the workman/workmen forms
  // carry neither "worker" nor the code, so a recorded WC removal could not reach
  // a policy row spelled that way: the line the operator took off re-printed at
  // the next generation, and — not being a standard section identity — printed as
  // the record's bare code on the ACORD 25 OTHER row with the statutory WC row
  // left empty and its Each Accident / Disease limits mangled into the OTHER row's
  // free text (#997's shape). The gap was never symmetric, which is what made it
  // a defect rather than the conservative half: coverageFamilyOf already reads
  // `/work\s*comp|compensation/` as `wc`, so the CARD dropped the line while the
  // paper kept it — the two-plane disagreement #1089's shared fold exists to
  // prevent. carrier-line-plausibility charts them too, and names "workmans comp"
  // as one of the corpus's dominant spellings. Anchored on the same terms as the
  // code arm, so a "Work Comp Audit", a class-code cell, "Workmanship" and
  // "Products Completed Ops" keep their own identity.
  //
  // THE SPELLED-OUT ARM carries the code arm's compound refusal, on the D&O
  // rung's exact terms (`Directors & Officers/EPLI`): read as a bare substring it
  // charted `Workers Comp/EPLI` and `Workers Compensation-2026-114` as this whole
  // section, so the segment-wide over-removal the code arm now refuses simply
  // moved to the spelling the IQ taxonomy and the policy tier actually write —
  // one recorded WC removal still took the EPLI half's policy number, dates and
  // limits off a customer's certificate. Only the TAIL is anchored, and to WORDS
  // rather than the generic-noun list: a LEADING qualifier has to keep folding
  // here ("Excess Workers Compensation" charts onto the WC row and stays an
  // umbrella line by removalFamilyOf's family-first precedence), while a
  // separator — `/`, a policy number's dash, a parenthesis — ends the cell's
  // claim to the section, exactly as it does one rung down.
  //
  // THE WORDS ARM'S OWN JOIN is `[\s_-]*` (plane #2535, "Coverage line removed: WC
  // — WC. Why: no wc"). `\s` crosses neither a hyphen nor an underscore, so the arm
  // charted `Workers Comp`, `WorkersComp` and `Workers Compensation` and handed
  // `Workers-Comp`, `Workers-Compensation` and `workers_comp` back as their own
  // bytes — while the shared line vocabulary already answered `WC` for every one of
  // them: line-retirement-rule.mjs derives COMPACT_NAME_TO_CODE from NAME_TO_CODE
  // with `replace(/[^a-z0-9]/g,"")` and applies it to a likewise-squeezed input, so
  // every separator variant of the three charted WC names normalizes to `WC`, and
  // normalizeGateLine delegates to that table. `workers_comp` is also this estate's
  // OWN canonical line token (carrier-line-plausibility, carrier-line-books,
  // carrier-appetite), and the class is lifted from line-selection.ts's own WC
  // pattern (`workers?['’\s_-]*comp`) rather than judged afresh — the apostrophes
  // are dropped because the possessive group above already holds them. It cost the
  // ways this rung's arms already name — the removal missed a later generation's
  // separator-joined line, which then printed as the record's bare cell on the OTHER
  // row with the statutory row empty (#997's shape); a sibling's removal blanked it,
  // because uncharted it failed namesAChartedLine and "Workers-Comp, Inland Marine"
  // charted as Inland Marine ALONE (#1523's); and a bound sibling spelling its line
  // that way read as SPECIALTY and merged another policy's coverage, money and
  // OTHER-row identity onto the selected cert (#2148's). It also ended a
  // contradiction inside the rung: `Excess Workers Compensation` charts onto the WC
  // row while `Excess Workers-Compensation` fell past it to the umbrella rung.
  // `/` and `.` stay OUT — `/` is this estate's compound-cell separator — and the
  // TAILS stay whitespace-only, so `Workers-Comp/EPLI` and
  // `Workers-Compensation-2026-114` keep their own identity.
  //
  // THE E.L. ARM was the last one here still read as a bare substring, which is
  // the same defect on the spelling the policy tier writes for the WC row's other
  // half (plane #2252, "Coverage line removed: WC — WC. Why: I don't want it.").
  // `Employers Liability/EPLI` charted as this whole section, so the say-it-once
  // dedupe folded it into a record's plain `Employers Liability` and the ask's own
  // removal then dropped the compound WHOLE — the EPLI half's policy number, dates
  // and limits off a customer's certificate. Anchored on the spelled-out arm's
  // terms, with the ONE exception this estate pins as still being the line: a
  // TRAILING PARENTHESISED qualifier ("Employers Liability (Stop Gap)" — stop-gap
  // E.L. is this line in a monopolistic state, not a second one, which is why the
  // OTHER-row collision note above names it). The arms above take no parenthesis,
  // because there the parenthesis is how the record writes a second thing on the
  // row ("Workers Comp (Stop Gap)" is the WC line plus the E.L. buy-back).
  //
  // THE COMPOUND REFUSAL NOW READS BOTH DIRECTIONS (plane #2496, the sixth
  // `WC — WC` removal, and plane #2517, "Coverage line removed: WC — Workers'
  // Compensation. Why: dont need" — one defect the two asks measured from either
  // end). Every arm above is anchored at its TAIL, so the compound cell whose WC
  // half comes FIRST keeps its own identity — but the head is free by design, and
  // a free head cannot tell a LEADING QUALIFIER from a SEPARATOR. So the half
  // AFTER a separator claimed the whole cell — `EPLI/Workers Comp`,
  // `Cargo/Workers Compensation`, `Umbrella/Workers Comp`, `EPLI/Employers
  // Liability` — and the mirror of every cost the arms above name followed: the
  // say-it-once dedupe folded a record's `Workers Comp` and `EPLI/Workers Comp`
  // into ONE line (#1977's shape); the ask's own removal then dropped the compound
  // cell WHOLE, taking that half's policy number, term and limits off a customer's
  // certificate; readableLine IS this fold, so the cell PRINTED one line's name
  // over a cell naming two (#2316's print catch); and the fill barred it from the
  // OTHER row while stamping the statutory row on its behalf (#997's shape). The
  // auto rung already states the contract: a separator ends a cell's claim to the
  // section in EITHER position.
  // TWO INSTRUMENTS, BOTH NARROWING, because neither answers the whole rung on its
  // own and the cells they miss are disjoint — a decline is only ever added.
  // FIRST, THE SHARED SPLITTER, as the umbrella rung asks it (#2460), and NOT the
  // auto rung's `(?:^|\s)` head (#2404): this section is named for BOTH its halves,
  // so `Workers Compensation/Employers Liability` and `Employers Liability/Workers
  // Comp` are ONE row spelled with a slash and a separator-rejecting head would
  // hand these asks their own complaint back — a WC removal that no longer reaches
  // the row. splitCompoundLine parts a `/` only when both halves chart as DIFFERENT
  // charted lines and the whole charts as none, so it answers those two by
  // construction (the E.L. half carries no charted code), it reads a space-padded
  // separator the same as a bare one, and — through namesTwoLines' own rewrite legs
  // — it reads the separators that are NOT a slash (`EPLI & Workers Comp`,
  // `EPLI, Workers Comp`, `Workers Comp and EPLI`), which no per-segment read of
  // this rung could reach.
  // SECOND, THIS RUNG'S OWN ARMS, asked per `/` segment, for the cells the splitter
  // is a NO-OP on: it cannot part `EPLI/Employers Liability` or `Cargo/Employers
  // Liability` because normalizeGateLine charts no code for the E.L. words, so the
  // arm #2252 landed stayed open in the leading direction and the splitter's own
  // KNOWN MISS list named it. Segment-wise the rung arbitrates itself against the
  // vocabulary it already states, so there is no second WC vocabulary to drift from
  // this one (#1612) — WC_SECTION_CODE_RE and WC_SECTION_WORD_RES are hoisted for
  // exactly that reason. It is scoped to `/` on purpose: it is a per-segment read of
  // arms that are tail-anchored, so `WC/Employers Liability` still folds — the row
  // is NAMED for both halves and the slash is INSIDE one line, the same reason
  // `W/C` folds.
  // AND THE SEPARATOR IS NOT ONLY A SLASH THERE EITHER (plane #2679, "Coverage
  // line removed: WC — WC. Why: no need for WC" — the eighth arrival of this
  // sentence). #2517 landed the per-segment read on the SLASH alone, so which
  // KEYSTROKE the operator typed between the two lines decided whether one half
  // claimed the whole cell for a half the SPLITTER cannot chart: `Crime/Workers
  // Comp` kept its own identity while `Crime, Workers Comp`, `Fiduciary and
  // Workers Comp`, `EPLI, Employers Liability` and `Cargo and Employers Liability`
  // — the same two bound lines in one coverage_type cell — charted as the whole
  // statutory row, at the three costs this rung's arms already name (the
  // say-it-once dedupe eats the other half, the ask's own removal drops that
  // half's policy number, term and limits off a customer's certificate, and
  // readableLine IS this fold, so the cell prints one line's name over a cell
  // naming two). The compound guard above cannot see them: namesTwoLines IS
  // splitCompoundLine, which refuses to part a cell unless the shared vocabulary
  // charts EVERY half, and `Crime`, `Fiduciary` and the `Employers Liability`
  // words are real bound lines this estate's line codes do not name.
  // ASKED OF THIS RUNG'S OWN ARMS over the separators the guard above already
  // rewrites, never a second WC vocabulary and never a second separator table
  // (#1612): the row is named for BOTH its halves, so `Workers Compensation &
  // Employers' Liability`, `Employers Liability & Workers Comp`, `WC and Employers
  // Liability` and `Workers Comp, Employers Liability` answer for every segment
  // and stay one line. Provably NARROWING — a separator-free cell is one segment,
  // and every cell reaching this arm names the row for itself — which is this
  // matcher's standing safe direction: everything it catches leaves the paper.
  // The CARD follows with no edit of its own: removalFamilyOf's WC arbitration is
  // unconditional on this fold, and the null family falls to the name leg, which
  // reads through here too, so both planes decline the same cells (#1089).
  // KNOWN MISSES left standing: a cell whose other half neither the shared
  // vocabulary charts nor this rung's arms name AND carries no separator at all
  // (`Crime Cargo` is not this rung's at all); a BARE hyphen inside a slashless
  // cell (`EPLI-Workers Comp`), which wcRowSegments subtracts because it carries no
  // token boundary to arbitrate and the same hyphen is this line's OWN join (#2535)
  // and a qualifier's — the SPACED form is a separator again as of #2716; and the
  // sibling rungs' own non-slash residue, which each named as its own pass
  // (property #2637, professional #2633).
  // Scoped to the WORD arms: THE CODE ARM ANSWERS FIRST and unguarded, because
  // `W/C` carries its own separator and the `^work…` short spellings are already
  // anchored at BOTH ends with no separator to read.
  if (WC_SECTION_CODE_RE.test(s)) return "Workers Compensation & Employers' Liability";
  // AND THE PER-SEGMENT READ NOW ANSWERS FOR ITSELF (plane #2933, "Coverage line
  // removed: WC — WC. Why: no WC" — the tenth arrival of this sentence). The
  // segment read was gated behind a WHOLE-CELL precondition, `WC_SECTION_WORD_RES`
  // over the entire string. Every arm there is TAIL-anchored, so the gate could only
  // open when the cell's LAST segment was a WORD spelling — and this row is named
  // for BOTH its halves, so the mirror of what #2496/#2517 closed stayed open: the
  // cell whose trailing half is the bare CODE never reached the segment read at all.
  // `WC, Employers Liability` folded and `Employers Liability, WC` did not;
  // `Employers Liability and WC` folded only by accident, because arm 2's
  // `(?:\s+[a-z]+)*` tail eats " and wc" as two more words — the keystroke lottery
  // #2679 and #2716 each closed one instrument at a time, one spelling over. It cost
  // what this rung's arms already name: the recorded removal missed a policy row
  // spelled that way and the line re-printed, as the record's bare cell on the OTHER
  // row with the statutory row left empty (#997's shape); the say-it-once ladder
  // charted one line TWICE (#1977's); and the card kept the row the paper kept.
  // Provably NARROWING NOTHING: a separator-free cell is ONE segment, so `.every`
  // over it IS the precondition it replaces (the code arm answered one line above),
  // and the only cells this can newly reach are multi-segment ones where EVERY
  // segment names this row — one line said twice. A cell whose other half is a
  // different line is untouched, because `namesWcRow` declines that half.
  // AND `W/C` BESIDE ITS OTHER HALF IS THIS ROW TOO — THAT KNOWN MISS IS CLOSED
  // (planes #3019 and #3026, the eleventh arrival of this sentence). It was #2933's
  // own KNOWN MISS: the code arm's slash shattered into `W` and `C`, so
  // `Employers' Liability & W/C` declined in both directions. wcRowSegments now
  // arbitrates that junction the way it already arbitrates the spaced hyphen's — see
  // its note for why the guard is the CODE arm and not namesWcRow.
  // KNOWN MISS left standing: `W/C` beside a half that carries NO separator at all
  // (`Crime W/C`), which is not this rung's cell in any spelling.
  if (!namesTwoLines(normalized) && wcRowSegments(normalized).every(namesWcRow)) {
    return "Workers Compensation & Employers' Liability";
  }
  // The bare code on the same terms as the `prop`/`cp` and `umb` rungs below and
  // above: `CA` is the legacy `core.product.external_ref` for this line
  // (line-retirement-rule.mjs's NAME_TO_CODE "commercial auto (liability)" and
  // KNOWN_CODES, LINE_LABELS' `CA: "Commercial Auto"`, SAME_LINE_FOLD's
  // `{ CA: "AUTO" }`, COVERAGE_ABBREV's `/commercial auto|^ca$|^auto$/i`), so it
  // is a live coverage_type and the spelling the operator's own note uses
  // ("Coverage line removed: CA — Commercial Auto. Why: Don't need that.", plane
  // #2181). Unfolded it was its own removal identity, so the auto section an
  // operator blanked could not match a policy row spelling `CA` — the line came
  // back on the next generation, printed as a bare code on the OTHER row with the
  // auto section left empty. ANCHORED HARDER than the rungs that fold a code plus
  // a generic-noun tail (E&O, BOP, Garage): these two bytes are ALSO the
  // California state code — the one collision between the US state codes and this
  // vocabulary (#1126) — so nothing but the bare code folds, and "CA Liability",
  // "California", "CA-2026-114" and "Cargo" keep their own identity. #1126 itself
  // is not reached: it screens the REQUESTED side (normalizeRequestedLine, the
  // customer's self-reported set), while this fold reads record-side product refs,
  // where its own note says CA really is commercial auto. The one prose surface —
  // an operator-typed OTHER row — is covered by the disjoint-namespace guard
  // (STANDARD_SECTION_IDENTITIES), which now charts a free-text `CA` to NO
  // identity, so it always survives the rewrite.
  //
  // THE WORD ARM was the last one on a STANDARD-section rung still read as a bare
  // substring, which is the same defect on the spellings the policy tier and the IQ
  // taxonomy actually write — the second `CA — Commercial Auto` removal to reach the
  // plane (#2404). A cell that merely CARRIED the word charted as this whole
  // section: `Commercial Auto/Cargo`, `Cargo/Auto` and `AUTO-2026-114` were the auto
  // line. All three seams that key on this identity paid for it — the say-it-once
  // dedupe folded a record's `Commercial Auto` and `Commercial Auto/Cargo` into ONE
  // line so the cargo half never reached the paper (#1977's shape); a recorded auto
  // removal then dropped the compound cell WHOLE, taking that half's limits off a
  // customer's certificate (#2240's shape); and readableLine IS this fold, so the
  // cell PRINTED one line's name over a cell naming two and the half sharing its
  // policy number went unnamed (#2316's print catch). A compound cell keeps its own
  // identity, the same refusal the WC, D&O and A&M rungs state.
  // ANCHORED AT BOTH ENDS, so a separator ends a cell's claim to the section in
  // EITHER position — `Auto/Cargo` and `Cargo/Auto` are one cell naming two lines
  // whichever half leads. A LEADING qualifier still folds, on the WC spelled-out
  // arm's terms: "Commercial Auto", "Business Auto" and "Any Auto" name this line
  // and nothing else.
  // THE TAIL IS A FREE RUN OF WORDS, deliberately NOT the generic-noun list #2356
  // landed for D&O: "Auto Physical Damage" and "Hired & Non-Owned Auto" are the
  // disjoint-namespace guard's own worked examples (STANDARD_SECTION_IDENTITIES
  // below), so they have to keep folding here and the SPACE-joined compound stays a
  // KNOWN MISS on this rung, named rather than closed. The parenthesised tail is the
  // legacy product NAME ("Commercial Auto (Liability)", NAME_TO_CODE's own key), on
  // the E.L. rung's terms. The `automatic` guard stays: it is strictly narrowing and
  // the anchor does not subsume it for a cell that LEADS with those bytes.
  // AND THE COMPOUND CELL THIS RUNG NEVER ASKED ABOUT (plane #2801, "Coverage line
  // removed: Prop — Prop. Why: removed" — the seventh arrival of the property
  // sentence, and the first whose reason names no rule a property rung could be
  // built from). The anchor above is this rung's ONLY compound reading, and a SPACE
  // cannot tell a leading QUALIFIER from a separator: "Commercial Auto" and
  // "Commercial Property, Commercial Auto" are one shape to it. So the auto word at
  // the tail claimed a cell naming the property line beside it — `Commercial
  // Property, Commercial Auto`, `Property, Auto`, `Prop, Auto`, `CP, Auto`,
  // `Commercial Property & Auto`, `Commercial Property - Auto`, and even
  // `Commercial Property/Commercial Auto`, the slash form every sibling rung
  // declines. This was the last standard-section rung carrying no compound guard at
  // all (GL #2540, WC #2496, umbrella #2460, inland marine #2546, property #2562,
  // professional #2513), which is why the note above states the law as ANCHORED and
  // the anchor cannot hold it in the qualifier position.
  // It cost the PROPERTY line all three ways this file measures, on the plane that
  // keeps asking: buildCompletion's say-it-once dedupe folded the cell into the auto
  // line so the property half never reached the paper; the operator's `Prop` removal
  // could not reach the cell at all, so the line they took off kept riding the
  // certificate under the AUTO section's name (#1523's symptom, which is what this
  // sentence reports); and the mirror — an auto removal dropped the cell WHOLE,
  // taking the property half's policy number, term and limits off a customer's
  // certificate.
  // ASKED OF THE SHARED PREDICATE, never a fourth hand-cut anchor: #2627 put the
  // property row in SEPARATOR_REWRITE_SECTIONS, so namesTwoLines already answers
  // TRUE for every cell above and this rung simply never asked it (#1612 — one
  // instrument, so the record side cannot drift from the requested side). Scoped to
  // the WORD arm; `ca` is exact equality and carries no separator to read. Strictly
  // NARROWING, this matcher's standing safe direction: everything it catches leaves
  // a customer's certificate, and the cell falls to the verbatim tail, where it is
  // its own removal identity on BOTH planes with no second guard — removalFamilyOf's
  // auto arm is gated on this fold (#2404) and its name leg reads through it.
  // KNOWN MISSES, named rather than folded in: a half the SCOPE SET does not hold
  // ("Cargo, Commercial Auto" — the set is workers' comp, umbrella and property, so
  // a cargo half beside a comma is still this whole section) and the SPACE-joined
  // compound the note above already names.
  if (
    s === "ca" ||
    (/(?:^|\s)auto(?:mobile)?s?(?:\s+[a-z]+)*(?:\s+\([a-z ]+\))?$/.test(s) &&
      !s.includes("automatic") &&
      !namesTwoLines(normalized))
  ) {
    return "Automobile Liability";
  }
  // The bare code, on the same terms as the `prop`/`cp` rung below: it is a live
  // coverage_type and the spelling the operator's own note uses ("Coverage line
  // removed: Umb — Umb. Why: no umb", plane #2045), and every other table charts
  // it (KNOWN_CODES, LINE_LABELS' `UMB: "Umbrella / Excess"`, coverageAbbrev's
  // `/umbrella|^umb$/i`). Unfolded it was its own removal identity, so a blanked
  // umbrella section could not match a policy row spelling `Umb` — the line came
  // back on the next generation, printed as a bare code on the OTHER row with the
  // umbrella section left empty. ANCHORED: a substring read would take
  // `UMB-2026-114` or `Lumber` for the line.
  //
  // THE WORD ARMS take the compound-cell refusal every sibling rung already
  // states (plane #2460, the third `Umb — Umb` removal). Read as bare substrings
  // they charted a cell naming this line BESIDE another as this whole section —
  // `Umbrella/Cargo`, `Cargo/Umbrella`, `Excess/EPLI` — and all three seams that
  // key on the identity paid for it: the say-it-once dedupe folded a record's
  // `Umbrella` and `Umbrella/Cargo` into ONE line so the cargo half never reached
  // the paper (#1977's shape); a recorded umbrella removal then dropped the
  // compound cell WHOLE, taking that half's limits off a customer's certificate
  // (#2404's shape); and readableLine IS this fold, so the cell PRINTED one line's
  // name over a cell naming two (#2316's print catch).
  // ASKED OF THE SHARED SPLITTER rather than anchored with a fourth hand-cut
  // regex, because three spellings this estate pins would not survive one:
  // "Excess Liability - 2nd Layer" (#1523's collision table), "Excess E&O"
  // (#2401), and "Umbrella/Excess Liability" — a slash INSIDE one line, two halves
  // on one code. splitCompoundLine is the estate's ONE rule for whether a cell
  // names two lines (a `/` splits only when the halves chart as two DIFFERENT
  // charted lines and the whole charts as none), so it answers all three by
  // construction and the record side cannot drift from the requested side (#1612).
  // Scoped to the WORD arms: the bare code carries no separator to read.
  // AND THE HALF THE SPLITTER CANNOT CHART (plane #2799, "Coverage line removed:
  // Umb — Umb. Why: removed" — the fourth arrival of that sentence, so the same
  // line came off the same paper again). namesTwoLines IS splitCompoundLine, which
  // refuses to part a cell unless the shared vocabulary charts EVERY half, so
  // `Crime`, `Fiduciary`, `Stop Gap` and `Pollution Liability` — real bound lines
  // this estate's line codes do not name — left #2460's guard blind and the raw
  // substring word arms claimed the whole cell, at the three costs this rung's note
  // already names (the say-it-once dedupe eats the other half, the ask's own
  // removal drops that half's policy number, term and limits off a customer's
  // certificate, and readableLine IS this fold, so the cell prints one line's name
  // over a cell naming two — with isOtherCoverageLine barring it from the OTHER
  // row, the other half's money filled the real ACORD 25 UMBRELLA section). It
  // lands on the WC (#2517), professional (#2633) and property (#2637) rungs'
  // terms: THIS rung's arms, hoisted, asked per `/` segment, so there is no second
  // umbrella vocabulary to drift from this one (#1612). Purely narrowing — a
  // slashless cell is one segment and every cell reaching this arm names the row
  // for itself, which is what keeps the one-line slash whole
  // ("Umbrella/Excess Liability", both halves on one code).
  // SCOPED TO `/`, unlike the separator rewrite above: LINE_SEPARATOR_RE reads the
  // SPACED HYPHEN, and "Excess Liability - 2nd Layer" is a cell #1523's collision
  // table pins as THIS row, so a shared-set segment read would decline it. A
  // non-slash separator beside an uncharted half stays this rung's KNOWN MISS,
  // named rather than closed, beside the property rung's own.
  if (
    s === "umb" ||
    ((s.includes("umbrella") || s.includes("excess")) &&
      !namesTwoLines(normalized) &&
      normalized.split("/").every(namesUmbrellaRow))
  ) {
    return "Umbrella / Excess Liability";
  }
  if (s.includes("liquor")) return "Liquor Liability";
  if (s.includes("employment") && s.includes("practices")) return "Employment Related Practices Liability";
  // THE RECORD'S OWN CODE IS THIS LINE (plane #2546, "Coverage line removed: IM —
  // Inland Marine. Why: no im"). This rung was one raw substring read, and `IM` —
  // the code the record writes, charted by KNOWN_CODES and NAME_TO_CODE in
  // line-retirement-rule.mjs, LINE_LABELS in line-dispatch-rule.mjs,
  // COVERAGE_ABBREV in dispatch-email.ts, LINE_NAMES in ask-harper/coverage-lines
  // and coverageFamilyOf's own `^im$` (#1390's "Coverage line added: IM — Inland
  // Marine") — fell through to the "an unrecognized line is its own removal
  // identity" tail. So one line had TWO identities here and it cost the three ways
  // every sibling rung's fix names: a removal recorded off the code could not reach
  // a row spelled with the words (nor the reverse), so the line the operator took
  // off RE-PRINTED at the next generation; having no section identity it printed as
  // the two raw bytes on the ACORD 25 OTHER row (#997's shape) where the words
  // could never reach it; and the say-it-once dedupe counted a record carrying `IM`
  // beside `Inland Marine` as TWO lines (#1977's shape). Worse, the CARD already
  // folded them — removalFamilyOf answers `inland marine` for the code — so the
  // board swept a line the paper kept printing, the two-plane disagreement #1089's
  // shared fold exists to prevent. EXACT, on the A&M and CA rungs' terms and byte
  // for byte with coverageFamilyOf's `^im$`: these two bytes are ordinary in this
  // corpus, so `IM-2026-114` stays a policy number and `IM/Cargo` a compound cell.
  // THE WORDS TAKE THE BOUNDARY AND THE COMPOUND REFUSAL in the same pass, because
  // charting the code is a WIDENING and everything this matcher catches LEAVES a
  // customer's certificate: at head an `IM` removal reached nothing on the paper,
  // and the raw substring over-claimed in two directions the code now has a path
  // into. `\b…\b` is coverageFamilyOf's own read, and it is what refuses "Mainland
  // Marine" — which CONTAINS `inland marine`, the same bytes #1390's request scan
  // anchored on Bugbot's catch — while a LEADING qualifier keeps folding
  // ("Contractors Inland Marine"), the asymmetry the WC rung states. A head or tail
  // anchor instead would cost every qualified spelling that folds today ("Inland
  // Marine (Contractors Equipment)", "Inland Marine Floater"), which is a NARROWING
  // in this ask's own direction: a standing removal would stop reaching a row it
  // reaches now. The compound guard is ASKED OF THE SHARED SPLITTER on #2460's and
  // #2513's terms — the known miss both #2404's pin and #2513's pass named on THIS
  // rung — so the record side cannot drift from the requested side (#1612).
  // AND ASKED ABOUT THIS RUNG'S OWN ROW (plane #2605, the third arrival). #2546 wrote
  // the guard when the shared read still parted every separator; #2517's scope left it
  // reading a `/` alone here, so `Inland Marine, EPLI`, `Cargo and Inland Marine` and
  // `Inland Marine & Cargo` charted as this whole section while `Inland Marine,
  // Workers Comp` — one scoped row luckier than the rest — kept its own identity. The
  // union set restores the guard #2546 landed without moving the shared read, whose
  // scope #2572's blob cells depend on. KNOWN MISS on the splitter's own terms: a half
  // it charts no CODE for ("Inland Marine, Pollution Liability") is still one cell.
  // AND THE HALF THE SPLITTER CANNOT CHART (plane #2993, the fourth `IM — Inland
  // Marine` removal). Every guard above is namesTwoLinesAcross, which IS
  // splitCompoundLine, and which refuses to part a cell unless the shared vocabulary
  // charts EVERY half — so `Crime`, `Fiduciary`, `Stop Gap` and `Ocean Marine`, real
  // bound lines this estate's line codes do not name, left the guard blind and the
  // word arm claimed the whole cell. That is the KNOWN MISS the note above named, and
  // it cost the three ways every sibling rung's fix does: the say-it-once dedupe ate
  // the other half, the ask's own removal dropped that half's policy number, term and
  // limits off a customer's certificate (and, crossing the other way, blanking the
  // cell recorded a removal of the account's REAL bound inland marine), and
  // readableLine IS this fold, so the cell printed one line's name over a cell naming
  // two. It lands on the WC (#2679), professional (#2633), property (#2637), umbrella
  // (#2799) and general-liability (#2934) rungs' terms: THIS rung's arms, hoisted,
  // asked per `/` segment. Purely narrowing — a slashless cell is one segment and
  // every cell reaching this arm names the row for itself. SCOPED TO `/` like those
  // rungs: LINE_SEPARATOR_RE reads the spaced hyphen, and "Inland Marine - Equipment"
  // is a live spelling of THIS row, so a shared-set segment read would decline it —
  // and closing that class would re-part the comma blob #2572 pins as ONE answer on
  // both planes. A non-slash separator beside an uncharted half stays this rung's
  // KNOWN MISS, named rather than closed, beside its siblings' own.
  if (
    s === "im" ||
    (INLAND_MARINE_WORDS_RE.test(s) &&
      !namesTwoLinesAcross(normalized, INLAND_MARINE_SEPARATOR_SECTIONS) &&
      normalized.split("/").every(namesInlandMarineRow))
  ) {
    return "Inland Marine";
  }
  if (s.includes("pollution")) return "Pollution Liability";
  // Specialty lines that must surface on ACORD OTHER (Tanya 2026-07-28 —
  // SAM / PL / Accident Health were dropping off the cert description).
  //
  // THE A&M RUNG. One receipt three times over — "Coverage line removed:
  // Abuse&Molestation — Abuse & Molestation. Why: no A&M" on planes #2316,
  // #2317 and #699 — so one note, superseded, carrying every source those
  // passes pinned this rung to.
  // FOUR IDENTITIES FOR ONE LINE. The rung read the WORDS and the requested-side
  // alias (`SAM`, which line-vocabulary.mjs normalizes to ABUSE) and none of the
  // codes the RECORD side writes:
  //   · ABUSE — the canonical product code (KNOWN_CODES and NAME_TO_CODE in
  //     line-retirement-rule.mjs, LINE_LABELS in line-dispatch-rule.mjs,
  //     LINE_NAMES in ask-harper/coverage-lines.ts, COVERAGE_NAMES in the
  //     follow-ups contact route),
  //   · AM — the live core.product.external_ref the intent spine stamps as
  //     coverageLineCode (compose/seed/insurance-twin/01_directory.sql's
  //     `(707, 'AM', 'Abuse & Molestation')`, folded to ABUSE by that rule's
  //     CODE_ALIASES),
  //   · A&M — the abbreviation this repo mints (dispatch-email.ts's
  //     COVERAGE_ABBREV, routing-review's `ABUSE: "A&M — Abuse & Molestation"`)
  //     and the operator's own word.
  // Like BOP, D&O, Surety and Cyber and unlike Property, this line carries no
  // coverage FAMILY that could rescue a missed spelling (coverageFamilyOf finds
  // no coverage noun in any of them, and none carries the `liability` word that
  // reaches its `gl` catch-all, which removalFamilyOf nulls), so this fold is the
  // ONLY thing holding the line's removal identity. Unfolded it cost three ways:
  // a removal recorded off the words could not reach a policy row spelled ABUSE,
  // so the line came back at the next generation and — having no standard
  // section — printed as the bare code in the operator's face (#997's shape); a
  // record carrying two spellings named ONE line twice, on the card's coverage
  // read and in the OTHER row (#1977's shape); and on the comma split "AM, Inland
  // Marine" failed to split, so the kept blob charted as Inland Marine ALONE and
  // a SIBLING's removal took the abuse row, its policy number and its limits off
  // the paper.
  // EVERY ARM IS ANCHORED, on #1546's terms — the head, then only the GENERIC
  // nouns this estate suffixes a line with, nothing else. `liability` IS in that
  // tail (unlike the BOP rung's): the whole line is a liability line, so "Abuse &
  // Molestation Liability" names it rather than a half of it. The word arms take
  // the head anchor rather than a substring read because the cost is already
  // measured on these exact bytes — playbooks/iq-eligibility's BT fix records a
  // bare `abuse` read eating "Mental Health & Substance ABUSE Centers" across 34
  // accepted-instant companies. `AM` is anchored HARDER still, on the CA rung's
  // terms (exact equality, no tail), because those two bytes are ordinary in this
  // corpus ("AM Best", a meridiem in PDF-extracted free text); what licenses the
  // fold at all is the directory mirror above, where `AM` is this line and no
  // other row carries it.
  // SO THE ANCHORING NARROWS, deliberately — this rung is not the purely additive
  // widening #2317's pass read it as. Left as substring reads, which spelling a
  // COMPOUND cell used decided whether it charted: `Abuse/EPLI` and `A&M/EPLI`
  // kept their own identity while `SAM/EPLI`, `Abuse & Molestation/EPLI` and
  // `Molestation & EPLI` charted as the whole section — so this line's removal
  // emptied the OTHER row the EPLI half was printing under (description, policy
  // number, term and limits), swept a `SAM/PL` policy line off the card, and
  // recorded a blanked compound cell as an A&M removal that later stripped a real
  // A&M row. #2252's and #1546's compound-cell law, on this rung. The conjunction
  // set is the one this estate's own labels write (`&`, `and`, `or`, `/`) and it
  // reads in EITHER order — "Abuse or Molestation" and "Molestation & Abuse" name
  // this line and nothing else, so admitting them cannot reach a neighbour's name
  // the way `Molestation & EPLI` does — and `sexual` is a prefix rather than a
  // free-floating word so it cannot pair with a neighbouring line's name either.
  // That prefix rides EITHER half, which is the asymmetry the first restoration
  // left behind: it admitted "Sexual Molestation & Abuse" and still dropped
  // "Molestation & Sexual Abuse", one label of one line in the order the estate
  // writes the qualifier on the abuse half. Both halves are still this line's own
  // words, so the neighbour-reach argument is unchanged ("Molestation & Sexual
  // Harassment" is EPLI's word and takes no arm here).
  // Nothing narrows for a cell naming only this line.
  // AND THE ANCHORING MOVES WHAT A COMPOUND CELL PRINTS, not only what a removal
  // reaches (the review's catch): coi-generate's readableLine IS this fold, so
  // `SAM/PL` printed "Sexual Abuse & Molestation" on the OTHER row and now prints
  // its own bytes. That is the non-destructive half — the old answer printed ONE
  // line's name over a cell naming TWO, so the half sharing that row's policy
  // number, term and limits went unnamed on a customer's certificate — and it is
  // what the rungs anchored before this one already do (WC, D&O, Cyber, BOP).
  // Pinned on both planes in
  // tests/coverage-line-abuse-molestation-compound-cell-print-ask-2316.test.ts:
  // a compound cell prints its own bytes, a cell naming this line ALONE still
  // prints the section's name rather than the record's bare code (#997).
  // TWO THINGS DELIBERATELY LEFT PUT. The canonical name does NOT move to the
  // label tables' shorter "Abuse & Molestation": this value PRINTS on the OTHER
  // row, so renaming it is its own before/after, and the removal identity only
  // needs every spelling to fold to the SAME string. And A&M's gap in the SHARED
  // vocabulary (normalizeGateLine charts every spelling but "A&M") stays a KNOWN
  // MISS, named rather than folded in: that read feeds the dispatch gate, where
  // charting a token moves it from `unresolved` to claimable — a gate move with
  // its own before/after, which is the widening #2252's review reversed.
  if (
    /^sam(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s) ||
    /^abuse(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s) ||
    s === "am" ||
    /^a\s*&\s*m(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s) ||
    /^sexual\s+abuse(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s) ||
    /^(?:sexual\s+)?(?:abuse\s*(?:&|and|or|\/)\s*(?:sexual\s+)?molestation|molestation\s*(?:&|and|or|\/)\s*(?:sexual\s+)?abuse|molestation)(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(
      s,
    )
  ) {
    return "Sexual Abuse & Molestation";
  }
  if (
    (s.includes("accident") && (s.includes("health") || s.includes("medical") || s.includes("death"))) ||
    /\ba\s*&\s*h\b/.test(s) ||
    s.includes("accident health")
  ) {
    return "Accident Health";
  }
  // The bare code is the estate's most common spelling of this line and charts as
  // PROP in every other table (line-dispatch-rule.mjs's LINE_LABELS,
  // dispatch-email.ts's `/property|^prop$/i`). Unfolded, a removal recorded off a
  // certificate that said "Prop" could not match a policy row that said
  // "Commercial Property" (plane #1523), and the OTHER row printed the bare code
  // in the operator's face (#997). ANCHORED, per the widen-only-with-a-pin note
  // above: a substring match would read an unrelated "CP" prefix as the line.
  // The word half is NARROWED by one known miss, named rather than folded in on
  // the WC rung's terms: "Property Damage" is the AUTOMOBILE row's own limit label
  // (FIELD_VALUE_SECTIONS above, mapped by coi-generate's autoLimitFieldId) and
  // "Bodily Injury and Property Damage Liability" is the CGL coverage's name, so
  // neither is this line. Claiming them printed a Property row on a customer's
  // certificate that nobody bound, and — because the damage description shares the
  // OTHER row with the real property line — collapsed the two into ONE identity, so
  // #1523 pass 2's collision guard declined the operator's own blanking and the
  // line they removed re-printed (plane #2055, "Coverage line removed: Prop — Prop.
  // Why: no prop"). It charts to NO line rather than to GL: everything this matcher
  // catches LEAVES a customer's certificate, so the fall-through is the safe read
  // and a GL widening is its own before/after. The card follows through
  // removalFamilyOf's matching rung, or the two planes disagree.
  //
  // A COMPOUND CELL IS NOT THIS SECTION (planes #2558, "Coverage line removed: Prop
  // — Prop. Why: only GL", and #2562, "Coverage line removed: Prop — Prop. Why: no
  // prop" — #1523's and #2055's sentences word for word, so the same line came off
  // the same paper twice more, and the last word arm in this ladder still reading a
  // raw substring). #2055 narrowed the DAMAGE spelling and left the rest of the word
  // arm open, so "Commercial Property/Cargo" — one record cell naming two bound
  // lines — wore this section's identity, and it cost the three ways every sibling
  // rung's fix names: buildCompletion's say-it-once dedupe folded the cell into the
  // property line so the cargo half never reached the paper; the ask's own removal
  // dropped the cell WHOLE, taking that half's policy number, dates and limits off
  // a customer's certificate; and readableLine IS this fold, so the cell PRINTED
  // one line's name over a cell naming two. The CARD follows on BOTH legs and needs
  // no second guard of its own, unlike umbrella and professional: removalFamilyOf's
  // property arbitration below is already unconditional on THIS answer (#2055), and
  // where an earlier guard already nulls the family ("Property/Umbrella", #2460)
  // lineIsRemoved falls to normalizedLineName, which reads through here too.
  // ASKED OF THE SHARED SPLITTER on #2460's and #2513's terms, never a fourth
  // hand-cut anchor: "Property, Special Form" is one line whose own name carries a
  // comma (splitOtherRowDescription's worked example), "Property/Prop" and
  // "Commercial Property/Business Personal Property" are slashes INSIDE one line
  // that chart whole through splitCompoundLine, and this arm's tail already admits
  // "Business Personal Property" and "Property Coverage" — an anchored tail or a
  // separator-rejecting regex would have cost every one of them. Scoped to the WORD
  // arm: the two code arms are exact-equality and carry no separator to read. The
  // SPACE-joined compound stays a KNOWN MISS for the same reason.
  // AND THE HALF THE SPLITTER CANNOT CHART (plane #2637, "Coverage line removed:
  // Prop — Prop. Why: do no need property" — #1523's, #2055's and #2562's sentence
  // a fifth time, so the same line came off the same paper again). namesTwoLines IS
  // splitCompoundLine, which refuses to part a cell unless the shared vocabulary
  // charts EVERY half, so `Crime`, `Fiduciary` and the `Employers Liability` words
  // — real bound lines this estate's line codes do not name — left the guard above
  // blind and the raw substring read claimed the whole cell, at the three costs
  // this rung's own note names. #2627 deferred exactly this residue by name ("the
  // PER-SEGMENT slash read is not landed here, so `Commercial Property/Employers
  // Liability` still charts as this section"); it lands on the WC (#2517) and
  // professional (#2633) rungs' terms: THIS rung's arms, hoisted, asked per `/`
  // segment, so there is no second property vocabulary to drift from this one
  // (#1612). Purely narrowing — a slashless cell is one segment and every cell
  // reaching this arm names the row for itself. Scoped to `/` on purpose, unlike
  // the separator rewrite above: three of this line's OWN names are spelled with a
  // separator ("Property & Casualty", "Property, Special Form", "Commercial
  // Property & Business Personal Property") and a `,`/`&` segment read would
  // decline every one of them, so a non-slash separator beside an uncharted half
  // stays this rung's KNOWN MISS beside the space-joined compound.
  // AND THE THIRD BARE CODE THIS ESTATE MEASURES (plane #3028, "Coverage line
  // removed: Prop — Prop. Why: no prop" — #1523's, #2055's, #2562's, #2627's and
  // #2637's sentence an eighth time, so the same line came off the same paper
  // again). `BPP` is business personal property, and three surfaces read it as THIS
  // line while the two planes holding a removal's identity never had: the rework
  // corpus carries it as a Property spelling the product vocabulary lacks (measured
  // 2026-07-17, forge/rework-digest.ts's `BPP → PROP`), a BPP add demands the
  // property application / ACORD 140 off ONE line arm beside the words
  // (rework-checklist.ts), and the playbook registry reasons about a BPP line beside
  // GL. The spelled-out `Business Personal Property` already charts here through the
  // word arm — this arm's own tail admits it — so it was the CODE alone that fell to
  // the "an unrecognized line is its own removal identity" tail, which is #1523's
  // defect on `Prop` and #1390's, #2045's, #2181's and #2925's on `IM`, `Umb`, `CA`
  // and `PROF`. It cost both directions of #1089's law: a record row coded `BPP`
  // survived the operator's own property removal on the card's policy and deal tiers
  // and printed on the OTHER row under the bare code, and a removal recorded off
  // `BPP` carried an EMPTY family set that removalFamilyOf's matching arm now fills.
  // ANCHORED as exact-equality, exactly as the two code arms beside it are and for
  // the reason they state — `BPP-2026-114` is a policy number, `BPPX` is not this
  // line — so the generic-noun tail stays this rung's KNOWN MISS on all three codes.
  // THE SHARED VOCABULARY DOES NOT MOVE: charting a token in line-vocabulary.mjs is
  // a SEND-GATING change with its own before/after (that file's `COMMERCIAL PROPERTY`
  // note), and rework-digest keeps `BPP` a corpus-only alias on purpose.
  if (
    s === "prop" ||
    s === "cp" ||
    s === "bpp" ||
    (s.includes("property") &&
      !/\bproperty\s+damage\b/.test(s) &&
      !namesTwoLines(normalized) &&
      normalized.split("/").every(namesPropertyRow))
  ) {
    return "Property";
  }
  // A COMPOUND CELL IS NOT THIS SECTION (plane #2513, "Coverage line removed: E&O
  // — E&O. Why: We don't need that."). #2460's shape one rung over, and the last
  // word arm in this ladder still reading a raw substring: #1576 and #2401
  // anchored the `E&O` words and the `PL`/`PROF` codes and left this one open, so
  // "Professional Liability/Cyber" — one record cell naming two bound lines — wore
  // this section's identity. It cost the three ways every sibling rung's fix names:
  // buildCompletion's say-it-once dedupe folded the cell into the professional line
  // and the cyber half never reached the paper; the ask's own removal dropped the
  // cell WHOLE, taking that half's policy number and limits off a customer's
  // certificate; and readableLine IS this fold, so the cell PRINTED one line's name
  // over a cell naming two. ASKED OF THE SHARED SPLITTER on #2460's terms, never a
  // third hand-cut anchor: two spellings this estate pins are a slash INSIDE one
  // line — "Professional Liability/Errors & Omissions" (the IQ taxonomy's canonical)
  // and "Professional Liability/E&O" (#1538's separator swap) — and both chart whole
  // through splitCompoundLine, which a separator-rejecting regex would cost. Scoped
  // to the WORD arm: the code arms below carry no separator to read.
  // AND THE HALF THE SPLITTER CANNOT CHART (plane #2633, "Coverage line removed:
  // E&O — E&O. Why: they did not ask for E&O" — #2513's ask a fourth time, so the
  // same line came off the same paper again). splitCompoundLine refuses to part a
  // cell unless the shared vocabulary charts EVERY half, so `Crime` and
  // `Fiduciary` — real bound lines this estate's line codes do not name — left the
  // guard above blind and the raw substring read claimed the whole cell, at the
  // three costs the rungs above name (the say-it-once dedupe eats the other half,
  // an `E&O` removal drops that half's policy number and limits off a customer's
  // certificate, and readableLine prints one line's name over a cell naming two).
  // This is the residue the WC rung's own KNOWN-MISS list deferred to "its own
  // pass" when #2517 closed it there, and it lands on that rung's terms: THIS
  // rung's arms, hoisted, asked per `/` segment, so there is no second
  // professional vocabulary to drift from this one (#1612). Purely narrowing — a
  // slashless cell is one segment and every cell reaching this arm names the row
  // for itself — and scoped to `/`, so the two one-line slashes stay whole
  // ("Professional Liability/Errors & Omissions", "Professional Liability/E&O")
  // and the comma cell #2572 pins as ONE answer on both planes is not touched.
  if (
    s.includes("professional") &&
    !namesTwoLines(normalized) &&
    normalized.split("/").every(namesProfessionalRow)
  ) {
    return "Professional Liability";
  }
  // E&O IS that line, spelled the way the operator types it: "Coverage line
  // removed: E&O — E&O. Why: as per the custom intake form they don't need PL."
  // (plane #1576 — the note blanks an E&O row and calls the line PL in the same
  // sentence). The professional line has no standard ACORD 25 section either, so
  // it prints in the OTHER row and every spelling was its own removal identity:
  // the sheet says "E&O", the IQ taxonomy writes "Professional Liability/Errors &
  // Omissions" (iq-assign-modal.ts) and the policy tier says "Professional
  // Liability". A removal recorded off one could not match a later generation
  // spelled another, so the line the operator took off re-printed — #1546's shape
  // one rung over, except that the CARD plane already folds these
  // (coverageFamilyOf's `e&o|errors` arm reaches `professional`), so the
  // certificate identity was the whole miss.
  // ANCHORED at both ends on #1546's terms — the code or the words, then the
  // GENERIC nouns this estate suffixes a line with ("E&O Liability", "E&O
  // Coverage") and nothing else. A qualifier is a known miss in EITHER position,
  // named rather than folded: "Technology E&O" is the estate's own separate
  // charted line (TECH_EO, line-retirement-rule.mjs), "E&O Cyber" is a cyber
  // line, and a compound cell ("E&O/Cyber") must keep its own identity — fold any
  // of them and a Professional Liability removal takes the other line's whole
  // OTHER row, its policy number and its limits off a stored sheet (the review's
  // catch: a free trailing-word tail read every one of those as bare E&O). Sits
  // BELOW the professional rung so "Directors & Officers Professional Liability"
  // — the spelling the estate's own drift note refuses to decide between PL, D&O
  // and E&O — keeps the identity it already had.
  //
  // THE RECORD CODES (plane #2401, "Coverage line removed: E&O — E&O. Why: not
  // needed. She has no idea what she's looking for" — #1576's ask word for word
  // on its code half, so the same line came off the same paper twice). The arms
  // above read the OPERATOR's spellings and the taxonomy's words and neither
  // short code the RECORD side writes:
  //   · PL   — the live core.product.external_ref
  //     (compose/seed/insurance-twin/01_directory.sql's `(706, 'PL',
  //     'Professional Liability')`, KNOWN_CODES and NAME_TO_CODE in
  //     line-retirement-rule.mjs, LINE_LABELS, ask-harper's LINE_NAMES, the
  //     routing-review labels, the follow-ups contact route),
  //   · PROF — the bound book's own coverage_type, and the third-commonest one
  //     in it (post-sale/renewal-checklist.ts's measured 2026-07-09 count: GL
  //     4,850 · GAR 957 · PROF 760 · W/C 566), which the gate vocabulary
  //     already folds to PL (line-vocabulary.mjs) and queue-source's own
  //     shortLine already writes onto a card.
  // Unfolded those were three removal identities for one line, and it cost three
  // ways: a removal recorded off the words could not reach a policy row coded
  // `PL`, so the line came back at the next generation (#1523's symptom) and —
  // having no standard ACORD section — printed as the bare code in the
  // operator's face, which is what the ask's own last clause is describing
  // (#997's shape); a record carrying a code beside the words named ONE line
  // TWICE on the OTHER row (#1977's shape); and "PL, Inland Marine" failed the
  // comma split, so the kept blob charted as Inland Marine ALONE and a sibling's
  // removal took the professional row, its policy number and its limits off the
  // paper. coi-checklist.ts already had to table its own `t === "pl"` beside its
  // certificateLineSection call for want of this rung — the drift #1612's
  // one-reading law exists to stop, and the tell.
  // ANCHORED HARDER than the arms above, on the CA and A&M rungs' terms (exact
  // equality, no tail): `PL` is two ordinary bytes, so `PL/E&O` and `PL/Cyber`
  // keep their own identity as compound cells, `PL-2026-114` stays a policy
  // number, and `Proforma` stays itself. What licenses the fold at all is the
  // directory mirror above, where these codes are this line and no other row
  // carries them — EPL/EPLI is employment practices, PROD is products. Bare `EO`
  // stays a KNOWN MISS, named rather than folded in: no code table in this
  // estate charts it, and everything this matcher catches LEAVES a customer's
  // certificate.
  // `liab` joins the tail in the same pass because it is the generic-noun list
  // #1546 set and every sibling rung carries (WC, A&M, D&O, Garage, Cyber),
  // which this comment already claimed; without it coverageFamilyOf read "E&O
  // Liab" as professional while this fold declined it — two planes disagreeing
  // about one spelling.
  //
  // THE CONNECTOR IS OPTIONAL on the spelled-out arm (plane #2591, "Coverage line
  // removed: E&O — E&O. Why: no E&O"). It was mandatory, so a cell that simply
  // drops the `&` — an export that swallowed it, a record typed without it, the
  // solid form — fell through to the "an unrecognized line is its own removal
  // identity" tail: `Errors Omissions` and `ErrorsOmissions` were their own line.
  // That is a DRIFT rather than this rung's anchoring, because two estate planes
  // already chart that exact cell as this line — coverageFamilyOf reads `/errors/`
  // as `professional`, and renewal-checklist.ts's alias list spells
  // `errorsomissions` out by hand BESIDE `errorsandomissions`, so this fold charted
  // exactly one half of a pair another plane writes as one. It cost the ways the
  // arms above already name: the ask's own removal left a later sheet's OTHER row
  // standing and the line re-printed (#1523's symptom); the cell failed
  // namesAChartedLine, so "Errors Omissions, Inland Marine" failed the comma split
  // and charted as Inland Marine ALONE, and that sibling's removal blanked the
  // professional half's whole OTHER row, its policy number and its limits off a
  // customer's certificate; and one line owned two removal identities, so the
  // say-it-once dedupe printed it twice (#1977's shape).
  // A strict SUPERSET — nothing already charted moves — and the anchoring does not
  // move with it: `^…$` still holds "Technology Errors Omissions", "Errors
  // Omissions Cyber" and "Errors Omissions/Cyber" to their own identity, and bare
  // `EO` is not reachable from this arm at all, so it stays the KNOWN MISS above.
  // The card needs no second rung: removalFamilyOf already arbitrates on this fold
  // (#1576's review catch), so it follows the paper the moment the paper charts it.
  //
  // AND SO IS THE SEPARATOR (plane #2591 again, the same sentence a sixth time).
  // The arm above read whitespace and nothing else between the two words, so the
  // spelling THIS ESTATE'S OWN IQ TAXONOMY WRITES THE LINE IN fell through to the
  // "an unrecognized line is its own removal identity" tail: routing-review's
  // iq-lines.ts carries `"errors-omissions": "professional-liability"` by hand
  // ("one coverage, seven spellings") and its lineToken declares underscores and
  // spaces to be the same separator, so every row that plane writes joins these
  // words with a HYPHEN — and renewal-checklist's canonicalLine, which squashes
  // punctuation, charts the same bytes. It cost the ways the arms above name: the
  // ask's own removal left a stored `Errors-Omissions` OTHER row standing whole
  // and the line re-printed; "Errors-Omissions, Inland Marine" failed the comma
  // split and charted as Inland Marine ALONE, so that sibling's removal blanked
  // the professional half's policy number and limits off a customer's certificate;
  // and the two spellings were two removal identities, so #1977's dedupe printed
  // one line twice.
  // NOT in the class, each for a stated reason: `/` (a compound cell keeps its own
  // identity, #2513/#2460), `,` (what splitOtherRowDescription and commaPartsOf
  // split an OTHER row on), and the `–`/`—` dashes (LINE_SEPARATOR_RE's own
  // separators, which no estate table spells this line with — folding them would
  // be this rung inventing a spelling rather than closing a drift). A strict
  // SUPERSET otherwise, and the anchoring is unmoved: `^…$` still holds
  // "Technology Errors-Omissions", "Errors-Omissions Cyber" and
  // "Errors-Omissions-2026-114" to their own identity.
  //
  // The two word regexes — BOTH widenings above included — are the hoisted
  // PROFESSIONAL_SECTION_CODE_RES, so the per-segment leg above reads exactly
  // these arms and never a second copy that could drift from them (#1612), and
  // `Errors-Omissions` charts as this row on the whole-cell read and the
  // per-segment one alike. The rung stays ANCHORED on the WHOLE cell here — a
  // per-segment read of these arms would fold `PL/E&O` and `PL/Cyber`, which
  // #2401 anchored as compound cells of their own.
  if (s === "pl" || s === "prof" || PROFESSIONAL_SECTION_CODE_RES.some((re) => re.test(s))) {
    return "Professional Liability";
  }
  // D&O has no standard ACORD 25 section either, and the estate writes it three
  // ways at once: the operator's shorthand ("Coverage line removed: D&O — D&O.
  // Why: No D and O.", plane #1546), the bare product ref DO, and the IQ
  // taxonomy's "Directors & Officers Liability" (iq-assign-modal.ts). Unfolded,
  // those were three removal identities for one line, and — unlike Property —
  // there is no coverage FAMILY to catch the miss (removalFamilyOf nulls the
  // `liability` catch-all), so the removal was simply lost and the line reprinted.
  // The bare code is ANCHORED, and the initialism at BOTH ends — the code, then
  // WORDS ("D&O Liability", "D&O Insurance") and nothing else — per the
  // widen-only-with-a-pin note above: a DOC / DOT / DO-2026-114 cell is not the
  // line. A tail of `\b` was not enough, because a SEPARATOR satisfies it:
  // "D&O/EPLI", "D&O / EPLI" and "D&O-2026-114" then read as the line ALONE, and
  // since the OTHER row splits on `;` and (narrowly) `,` but never on `/`, a
  // recorded D&O removal took the whole segment off a stored sheet — the EPLI half
  // and the row's own policy number with it. That is the over-removal the
  // conservative half below exists to refuse (namesTwoChartedLinesUnsplit), so a
  // compound cell keeps its own identity instead
  // (tests/coverage-line-do-compound-cell-anchor-ask-1546.test.ts).
  // The SPELLED-OUT label is anchored on the SAME terms (the review's catch): left
  // unanchored it folded "Directors & Officers/EPLI" to the section alone, so the
  // very same segment-wide removal took the EPLI half — and the row's shared policy
  // number, dates and limits — off a stored sheet. Anchored, a spelled-out compound
  // keeps its own identity exactly as the initialism one does
  // (tests/coverage-line-do-spelled-out-compound-anchor-ask-1546.test.ts).
  // The tail that anchoring landed on was a FREE run of words, which closed the
  // compound cell on `/`, `,`, `+` and `-` and left it open on the SPACE — so
  // "D&O EPLI" and "Directors & Officers EPLI", the same two lines in the same
  // cell as the pinned "D&O/EPLI", still folded to this section alone and a
  // recorded D&O removal took the EPLI half, the row's own policy number, its
  // dates and its limits off a stored sheet ("Coverage line removed: D&O — D&O.
  // Why: no D&O on intake form", plane #2356 — the removal that then replays).
  // So the tail reads the GENERIC nouns this estate suffixes a line with and
  // nothing else, which is what this comment already claimed and what every
  // sibling rung landed since states (#1576 E&O, #1818 BOP, #2159 Surety, #2181
  // CA, #2267 Cyber, #2317 A&M) — #1576's review caught this exact free tail on
  // the rung it was modelled on and it was never carried back here.
  // Sits BELOW the professional rung on purpose — "Directors & Officers
  // Professional Liability" is the spelling the drift note refuses to decide
  // between PL and D&O, so it keeps the identity it already had. That gap is a
  // CONFIRMED miss, not an oversight (the review's ask): folding it here would be
  // this plane ruling PL-vs-D&O on a legal document where the estate's own
  // classifier declines to. So a D&O removal does not reach that row and it
  // re-prints, while the row's own removal stays a PROFESSIONAL one — both
  // directions pinned in
  // tests/coverage-line-do-professional-known-miss-ask-1546.test.ts.
  if (
    s === "do" ||
    /^d\s*&\s*o(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s) ||
    /^directors?\s*(?:&|and)\s*officers?(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s)
  ) {
    return "Directors & Officers Liability";
  }
  // The businessowners package has no standard ACORD 25 section either, and — like
  // D&O — no coverage FAMILY at all (`coverageFamilyOf` finds no coverage noun in
  // either spelling, and neither carries the `liability` word that would reach its
  // `gl` catch-all), so removalFamilyOf nulls it and this fold is the ONLY thing
  // holding the line's removal identity. The estate writes it four ways at once: the
  // operator's own code ("Coverage line removed: BOP — BOP. Why: Don't. Need BOP.",
  // plane #1818, and the bare product ref in line-retirement-rule.mjs's KNOWN_CODES),
  // the charted label "Business Owners Policy" (line-dispatch-rule.mjs's LINE_LABELS),
  // the ISO spelling written as one word (charted as a BOP alias by
  // post-sale/renewal-checklist.ts), and the possessive an operator-typed OTHER row
  // carries. Unfolded those were four identities for one line, so a removal recorded
  // off one could not match a later generation spelled another and the package the
  // operator took off re-printed — #1546's shape, one line over. It cut the other way
  // too: with no rung here "Business Owners Policy, Inland Marine" named only ONE
  // charted line, so the comma split was refused and the kept blob charted as Inland
  // Marine alone — a sibling's removal taking the customer's BOP off the paper.
  // ANCHORED at both ends on #1546's terms — the code or the words, then only the
  // GENERIC nouns this estate suffixes a line with — so a BOP-2026-114 cell, a
  // BOPFORM id and a "BOP/EPLI" compound keep their own identity. `liability` is
  // deliberately NOT in that tail (unlike the E&O rung's): on a PACKAGE, "BOP
  // Liability" names the liability HALF rather than the whole line, so it charts to
  // no BOP identity — a KNOWN MISS, named rather than folded in, on the same terms as
  // the WC spellings above, because everything this read catches LEAVES a customer's
  // certificate. Sits BELOW every rung above it so no spelling one of them already
  // claims can move.
  // The possessive takes `['’]` on both sides — the WC rung's own character class
  // (plane #2402, "Coverage line removed: BOP — BOP"; its reason quotes nothing because
  // the brief scrub masked an account name). The possessive this rung folds is the one an
  // OPERATOR TYPES, and that keyboard writes U+2019, so with `'` alone it was its
  // own removal identity: a recorded removal missed a later sheet's OTHER row and the
  // package re-printed (#1818's symptom), and a bound sibling spelling its package that
  // way read as SPECIALTY and merged another policy's coverage, limits and OTHER-row
  // identity onto the selected cert (#2182's). Deliberately NOT normalized once at the
  // top of this fold: the value returned for an UNCHARTED line prints in the OTHER row's
  // description, so an operator's own bytes must reach the customer's paper unrewritten.
  // The words arm's separators take `[\s-]` — the SURETY rung's own character class
  // twenty lines below (plane #2402's second arrival, the same unreadable reason). The
  // hyphen is not this rung's judgement to make either way: `normalizeLineCode` and
  // `normalizeGateLine` both answer `BOP` for `Business-Owners Policy` (line-retirement-
  // rule.mjs's COMPACT_NAME_TO_CODE squeezes separators out), renewal-checklist.ts's
  // squash() charts it, and — the one that bites — queue-source's own normalizedLineName
  // collapses non-alphanumeric runs, so the CARD already reads it as this line's removal
  // key while this fold handed back its own bytes. That is the disagreement the header of
  // this function forbids, running the other way: the card dropped the row and the
  // certificate re-printed it. Un-hyphenated it cost the other two ways too — a bound
  // SIBLING spelling its package that way read as SPECIALTY and merged another policy's
  // coverage, money and OTHER-row identity onto the selected cert (#2182's failure), and
  // with the spelling uncharted "Business-Owners Policy, Inland Marine" failed the comma
  // split, so the blob charted as Inland Marine ALONE and an Inland Marine removal
  // blanked the customer's package, its policy number and its limits off the paper.
  // The tail separator moves with it so a fully hyphen-joined cell is the same line.
  // The anchoring does not move: `liability` stays out of the tail, so
  // `Business-Owners Liability` is still the named KNOWN MISS, and the end anchor still
  // holds `Business-Owners Policy/EPLI` and `Business-Owners Insurance Agency` to their
  // own identity. The BOP CODE arm is deliberately untouched — no plane in the estate
  // charts `BOP-Policy`, so there is no drift there to close.
  // The words arm's TAIL separator is optional, `[\s-]*` (plane #2501, "Coverage
  // line removed: BOP — BOP. Why: no bop"). The join between the two words has been
  // optional since #1818 charted `Businessowners`, but the join before the generic
  // noun was mandatory, so the name written fully SOLID was its own removal identity.
  // That is the SURETY rung's own #1153 measurement fifty lines below, on the line
  // beside this one in the same NAME_TO_CODE table: the live self-reported code array
  // and the product external_refs carry a charted line's name written solid, which is
  // why `(?:surety[\s-]?)?bonds?` reads `SuretyBond`. Two estate planes already chart
  // the compact spelling of THIS line — line-retirement-rule.mjs's
  // COMPACT_NAME_TO_CODE (derived, separators squeezed out), so `normalizeLineCode`
  // and `normalizeGateLine` both answer `BOP`, and renewal-checklist.ts's alias list,
  // which spells `businessownerspolicy` out by hand — while this fold handed the
  // bytes back. queue-source's normalizedLineName cannot rescue it either: it
  // collapses non-alphanumeric runs AFTER this fold, so `businessownerspolicy` never
  // meets `business owners policy`. It cost the same ways the arms above already
  // name — the recorded removal missed a later sheet's OTHER row and the package
  // re-printed (#1818's symptom); a bound sibling spelling its package that way read
  // as SPECIALTY and merged another policy's coverage, money and OTHER-row identity
  // onto the selected cert (#2182's); and, uncharted, "BusinessOwnersPolicy, Inland
  // Marine" failed the comma split, so the blob charted as Inland Marine ALONE and an
  // Inland Marine removal blanked the customer's package, its policy number and its
  // limits off the paper.
  // A strict SUPERSET of what the arm read before, so nothing already charted can
  // move, and the anchoring does not move either: `liability` stays out of the tail,
  // so `BusinessOwnersLiability` is still the named KNOWN MISS, the singular owner
  // and the package word are still not this rung's, and the end anchor still holds
  // `BusinessOwnersPolicyEPLI`, `BusinessOwnersPolicy/EPLI` and
  // `BusinessOwnersInsuranceAgency` to their own identity.
  if (
    /^bop(?:\s+(?:policy|coverage|insurance|line))*$/.test(s) ||
    /^business[\s-]?owner['’]?s['’]?(?:[\s-]*(?:policy|coverage|insurance|line))*$/.test(s)
  ) {
    return "Business Owners Policy";
  }
  // Garage is the ACORD 30's own line and every other table in the estate charts
  // it — KNOWN_CODES carries GARAGE, LINE_LABELS/LINE_NAMES say "Garage
  // Liability", coverageFamilyOf answers `garage`, coi-forms routes a garage
  // policy onto the 30 — but this fold had no rung for it, so a garage line fell
  // through to the bytes below and every spelling was its own removal identity. A
  // policy tier carrying "Garage" beside "Garage Liability" then named ONE line
  // twice, on the card's coverage read and in the OTHER row's description, and the
  // operator deleted the second by hand ("Coverage line removed: Garage — Garage.
  // Why: duplicate", plane #1977); a removal recorded off either spelling missed
  // the other and the line re-printed (#1523's symptom).
  // ANCHORED at both ends on #1546's terms — the code, then only the GENERIC nouns
  // this estate suffixes a line with — so "Parking Garage Operations", a
  // GARAGE-2026-114 cell and a "Garage/Garagekeepers" compound keep their own
  // identity. GARAGEKEEPERS is a KNOWN MISS, named rather than folded in: the
  // ACORD 30 renders Garage Liability and Garage Keepers as two SEPARATE coverage
  // rows (coi-form-fields.ts's acord30 section set, CertificateSheet's own two
  // blocks), so reading one as the other would let a garage-liability removal take
  // a real second row off the paper. Sits BELOW every rung above it so no spelling
  // one of them already claims can move.
  if (/^garage(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s)) {
    return "Garage Liability";
  }
  // Surety rides the ACORD 25 OTHER row too, and — like BOP and D&O, unlike Property
  // — carries no coverage FAMILY at all (coverageFamilyOf finds no coverage noun in
  // any spelling and none carries the `liability` word that reaches its `gl`
  // catch-all), so removalFamilyOf nulls it and this fold is the ONLY thing holding
  // the line's removal identity. The estate writes it four ways at once: the
  // operator's own code ("Coverage line removed: SuretyBond — Surety Bond. Why:
  // surety bond is not subbed", plane #2159, and the same code on #1153), the charted
  // label "Surety Bond" (line-dispatch-rule.mjs's LINE_LABELS), the request aliases
  // SURETY / SURETY BONDS (line-vocabulary.mjs), and the bare product code BOND —
  // which the dispatch subject's own abbreviation already round-trips to this line
  // (dispatch-email.ts: coverageAbbrev("Surety Bond") is "Bond"). Unfolded those were
  // four removal identities for one line, so the surety row an operator blanked came
  // back on the next generation spelled another way — #1546's shape, one line over,
  // and on the one line the note says Harper never even submits, so nothing
  // downstream would ever have retired it either.
  // ANCHORED at both ends on #1546's terms — the code or the words, then only the
  // GENERIC nouns this estate suffixes a line with — so a BOND-2026-114 cell, a
  // "Surety/Fidelity" compound and "Bondline Services" keep their own identity. A
  // QUALIFIED bond is a KNOWN MISS, named rather than folded in: fidelity is a
  // separate charted line in this estate (iq-assign-modal.ts lists "Surety Bonds" and
  // "Fidelity Bond" side by side) and a bid or performance bond can hold its own row,
  // so reading one as surety would let a single removal take a real second row off a
  // customer's paper. Sits BELOW every rung above it so no spelling one of them
  // already claims can move.
  if (
    /^(?:surety[\s-]?)?bonds?(?:\s+(?:coverage|insurance|policy|line))*$/.test(s) ||
    /^surety(?:\s+(?:coverage|insurance|policy|line))*$/.test(s)
  ) {
    return "Surety Bond";
  }
  // Cyber rides the ACORD 25 OTHER row too, and — like BOP, D&O and Surety — carries
  // no coverage FAMILY that can rescue a missed spelling: coverageFamilyOf answers
  // null for the codes and reaches only its unearned `gl` catch-all for the words,
  // which removalFamilyOf's GL guard nulls. So this fold is the ONLY thing holding
  // the line's removal identity. The estate writes it four ways at once and its own
  // classifier says so out loud (coverage-classification.ts: "Cyber shows up under
  // three different names in our records (CY / CYBER / CL)"): the operator's own code
  // ("Coverage line removed: CL — CL. Why: no need for cyber", plane #2267, and the
  // same code on #689/#920), the drifted `CY`, the product code CYBER
  // (line-retirement-rule.mjs's KNOWN_CODES) and the words the taxonomy writes
  // ("Cyber Liability" — NAME_TO_CODE, iq-assign-modal's canonical). Unfolded those
  // were four removal identities for one line, so the cyber row an operator blanked
  // came back on the next generation spelled another way, printed as the bare code in
  // their face (#997's shape). It cut the other way too: with cyber charting nothing,
  // "Cyber Liability, Inland Marine" failed the comma split and the kept blob charted
  // as Inland Marine ALONE, so a sibling's removal took the customer's cyber row, its
  // policy number and its limits off the paper.
  // The canonical name is the SHORT one, which is what this estate's seven label
  // tables say (LINE_LABELS' `CYBER: "Cyber"`, ask-harper/coverage-lines, the
  // routing-review labels, renewal-checklist, queue-source's shortLine,
  // form-selection-matrices, and the label the dispatch abbreviation `CL` already
  // folds to) — and it leaves a bare "Cyber" folding to itself, unmoved.
  // ANCHORED at both ends on #1546's terms — the codes, or the word then only the
  // GENERIC nouns this estate suffixes a line with — because these two bytes are
  // ordinary in this corpus: a `CL-100` clearance-inspection id, a CL-2026-114 cell
  // and a "CL/EPLI" compound all keep their own identity. A QUALIFIED cyber is a
  // KNOWN MISS, named rather than folded in, on the same terms as the surety rung's
  // fidelity bond: "Cyber Risk" and the E&O compounds #1576 anchored from the other
  // side ("E&O Cyber", "Cyber/Tech E&O") can hold their own OTHER row, so reading one
  // as this line would let a single removal take a real second row off a customer's
  // paper. Sits BELOW every rung above it so no spelling one of them already claims
  // can move.
  if (s === "cl" || s === "cy" || /^cyber(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s)) {
    return "Cyber";
  }
  // THE WORDS THIS ESTATE ITSELF PRINTS ARE THE SAME LINE (plane #2957, "Coverage
  // line removed: Cargo — Cargo. Why: no cargo"). Cargo rides the ACORD 25 OTHER row
  // and — like BOP, D&O, Surety and Cyber — carries no coverage FAMILY that can
  // rescue a missed spelling: coverageFamilyOf answers null for the word and reaches
  // only its unearned `gl` catch-all for a generic-noun spelling, which
  // removalFamilyOf's GL guard nulls. So this fold is the ONLY thing holding the
  // line's removal identity, and it held the operator's word alone. `Motor Truck
  // Cargo` is not a stray spelling: it is BOTH lineLabel("CARGO")
  // (line-dispatch-rule.mjs) and lineDisplayName("CARGO")
  // (ask-harper/coverage-lines.ts) — the words this estate prints for the line — and
  // it folded to nothing. So a removal recorded off the operator's `Cargo` could not
  // reach the next sheet generated under our OWN name for the line: the row they
  // blanked came back, and stayed on the card's policy and deal tiers with it
  // (#1089, both planes).
  // ONLY THE SPELLING WHOSE BYTES THIS FOLD ACTUALLY MOVES. The bare word IS the
  // canonical name — three of this estate's five label registers write it
  // (routing-review's `CARGO: "Cargo"`, iq-assign-modal's canonical,
  // dispatch-email's `[/cargo/i, "Cargo", "Cargo"]`), #1523's own uncharted-identity
  // pins require this cell to keep it, and both casings already key to one identity
  // through certificateLineKey — so it needs no rung, and giving it one would be a
  // change of a different KIND rather than a wider fold. namesAChartedLine is DERIVED
  // from this fold, so a rung matching the bare token also re-parts every OTHER-row
  // comma cell in the book that names cargo beside another line, and #2627 measures
  // exactly that cost: `Commercial Property, Cargo` is one cell naming two bound
  // lines, it is its OWN removal identity there, and a standing removal recorded
  // under its bytes has to go on reaching it. That is its own before/after, not this
  // receipt's ask.
  // ANCHORED at both ends on #1546's terms — the words, then only the GENERIC nouns
  // this estate suffixes a line with — because these words are ordinary in the
  // corpus: a MOTOR-TRUCK-CARGO-prefixed policy number and the compound cells every
  // rung above already arbitrates keep their own identity. A QUALIFIED cargo is a
  // KNOWN MISS, named rather than folded in, on the surety rung's fidelity-bond
  // terms: "Motor Truck Cargo Legal Liability" can hold its own OTHER row, so reading
  // it as this line would let one removal take a real second row off a customer's
  // paper. Sits BELOW every rung above it so no spelling one of them already claims
  // can move.
  // THE SHARED VOCABULARY DOES NOT MOVE, and that boundary is deliberate: it charts
  // the bare word but not the full name, so splitCompoundLine still cannot part
  // "Umbrella Liability/Motor Truck Cargo". Charting a NAME in NAME_TO_CODE is a
  // SEND-GATING change with its own before/after (the `commercial property` and
  // `business owners` rows say so in their own notes), not this receipt's ask.
  if (/^motor\s+truck\s+cargo(?:\s+(?:liability|liab|coverage|insurance|policy|line))*$/.test(s)) {
    return "Cargo";
  }
  // ONE LINE SAID TWICE IS STILL ONE LINE (plane #2563, "Coverage line removed: BOP
  // — BOP. Why: no bop"). Every rung above is ANCHORED at both ends, so a cell that
  // restates itself — the code beside its own words, one half in a parenthetical
  // gloss — fell through to the tail below and was its own removal identity:
  // `Business Owners Policy (BOP)` and `BOP (Business Owners Policy)` matched no BOP
  // spelling. That line is the one with no rescue: coverageFamilyOf finds no coverage
  // noun in any of its spellings, so removalFamilyOf nulls it and the name leg is the
  // whole match, and queue-source's normalizedLineName runs AFTER this fold. Two
  // other planes already read that same cell as this one line — renewal-checklist's
  // canonicalLine (squash + the substring rescue) and routing-review's
  // canonicalCoverageLine, which drops a trailing gloss BEFORE its lookup and states
  // the law in its own doc comment. It cost the ways the rungs above already name:
  // the recorded removal missed a later sheet's glossed OTHER row and the package
  // re-printed (#1818's symptom); "Business Owners Policy (BOP), Inland Marine"
  // failed the comma split, so the blob charted as Inland Marine ALONE and an Inland
  // Marine removal blanked the customer's package, its policy number and its limits
  // off the paper; and a bound sibling spelling its package that way read as
  // SPECIALTY and merged another policy's coverage, money and OTHER-row identity onto
  // the selected cert (#2182's).
  // The gloss must RESTATE the line, never add one — that is the whole safety
  // property, and it is canonicalCoverageLine's own law rather than a third hand-cut
  // anchor. The WC rung above says out loud why: on a record the parenthesis is
  // usually how a SECOND thing rides the row ("Workers Comp (Stop Gap)" is the WC
  // line plus the E.L. buy-back), so `BOP (EPLI)` and `Business Owners Policy
  // (Package)` keep their own identity and a whole-package removal cannot take that
  // half with it. Asked of namesAChartedLine — the comma split's own probe — so the
  // stem has to name a charted line and an UNCHARTED cell is never rewritten:
  // "Aviation Hull (Aviation Hull)" still prints the record's bytes, and the
  // `BOP Liability` known miss takes no gloss with it either.
  // SITS BELOW EVERY RUNG, so it is a strict addition: nothing already charted can
  // move (`Employers Liability (Stop Gap)` still answers on its own arm), and the
  // only cells it can reach are the ones about to be handed back as their own bytes.
  // Not scoped to this line, for canonicalCoverageLine's reason: a restatement is a
  // restatement wherever it sits, and a second reading of "does this name a line" is
  // the drift #1612 forbids.
  const gloss = /^(.+?)\s*\(([^()]+)\)$/.exec(normalized);
  if (gloss && namesAChartedLine(gloss[1]!)) {
    const stated = certificateLineSection(gloss[1]!);
    if (stated === certificateLineSection(gloss[2]!)) return stated;
  }
  // The NORMALIZED bytes, not the raw ones: an unrecognized line is its own removal
  // identity, so returning `t` made padding and interior runs split one line into
  // two of them — "Aviation  Hull" removed off an extracted sheet could not match
  // the "Aviation Hull" the policy record spells, and the line re-printed. That is
  // #1523's own symptom, one rung below the charted lines. Case is preserved: this
  // value also prints in the OTHER row's description.
  return normalized;
}

// THE IDENTITY of a certificate line — the fold above, cased once. The charted
// rungs hand back a canonical name, but the fall-through hands back the caller's
// own bytes because those PRINT (an uncharted line reaches the paper through the
// OTHER row's description, and lowercasing the fold would print "aviation hull"
// on a customer's certificate). So the BYTES could not be the identity: "Aviation
// Hull" recorded off an extracted sheet did not match the "aviation hull" a
// policy row spells, the removal missed the row at the next buildCompletion fold
// and the specialty line reprinted — #1523's symptom one rung below the charted
// lines, the same one the whitespace collapse fixes for padding. Compare removal
// identities on THIS; render the fold's own bytes.
export function certificateLineKey(t: string): string {
  return certificateLineSection(t).toLowerCase();
}

// certificateLineSection returns a canonical name carrying capitals, while its
// fall-through returns the caller's own bytes — so a lowercased probe that comes
// back changed named a charted line, and one that comes back as itself did not.
// Derived that way rather than listed, so a new rung needs no second table.
function namesAChartedLine(raw: string): boolean {
  const probe = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return Boolean(probe) && certificateLineSection(probe) !== probe;
}
