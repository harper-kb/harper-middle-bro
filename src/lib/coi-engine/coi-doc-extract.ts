// ── THE DOCUMENT-EXTRACTION FALLBACK'S PURE GRAMMAR (the binder-on-file ──────
// zero-fill, Pratik's live QA 2026-07-14) ─────────────────────────────────────
//
// The flag, from the bench itself: an account with a Commercial General
// Liability BINDER on file — carrier, policy number, term, insured, and all
// six GL limits printed right there — rendered a COMPLETELY EMPTY ACORD 25,
// because the fill ladder stopped at the structured stores (saved cert
// field_values → insurance.policy → deals_v2) and never consulted the
// authoritative source documents the ready gate already knows how to find.
// Ground truth on the flagged account: 0 policy rows, 0 deal rows, 0
// generated_certificates rows — and a cached Hermes extraction of that
// binder sitting in the artifact store since April, never read.
//
// The cure is NOT new extraction machinery. harper-tools already owns the
// door ("documents extraction get" reads the cached parse; "documents
// extraction extract" runs + caches one — the exact "re-extracted into field
// values" path the read-only banner names). This module is the PURE half:
// normalize a cached extraction payload — whatever its per-type contract —
// into the small set of certificate facts the completion builder can fold,
// each one traceable back to the ONE document it came from.
//
// THE NO-INVENTION LAW HOLDS: every fact here is read from the extraction of
// a real document on the account's file. A key the extraction doesn't carry
// stays null; null folds to "missing" downstream — never a guessed value.
// The I/O half (the bounded harper-tools reads) lives in coi-data.ts beside
// the other context legs.

import { canonicalLimitKeyFromLabel } from "./coi-deterministic-mapper";
import {
  COI_CARRIER_SLOTS,
  coiCoverageBasisFromValue,
  coiPolicyLineFromText,
  emptyCoiAddress,
  type CanonicalCoiGenerationInput,
  type CoiCarrierSlot,
  type CoiGenerationLimit,
  type CoiGenerationPolicy,
  type CoiPolicyLine,
} from "./coi-generation-contract";

// The completion's limit shape (line-tagged, so the ACORD projection can route
// each limit to the coverage section its source document named).
export interface DocCoverageLimit {
  line: string;
  label: string;
  amount: string;
}

export interface DocPolicyFacts {
  // The one document these facts were read from — the provenance receipt
  // every consumer cites (the card, the checker, the source trace).
  artifactId: string;
  docName: string;
  classificationType: string | null;
  namedInsured: string | null;
  insuredDba: string | null;
  insuredAddress: {
    /** Legacy joined street retained for the default-off generator. */
    street: string | null;
    street1: string | null;
    street2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
  } | null;
  carrier: string | null;
  carrierNaic?: string | null;
  policyNumber: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  coverageLines: string[];
  limits: DocCoverageLimit[];
  deductible: string | null;
  /** Full policy-derived input for the deterministic generator. */
  generationInput?: CanonicalCoiGenerationInput;
}

// Only aether artifacts have extractable bytes — the legacy-store handles
// (`legacy-<id>`) live in a GCS store this service has no byte door to.
// FULL-STRING match on the id grammar, not a prefix check: this id is
// interpolated into a harper-tools command line, so anything outside the
// known-safe charset (whitespace, flag-shaped payloads) is refused here at
// the boundary (the security reviewer's catch on PR #544).
export function isExtractableArtifactId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^harper:artifact:[A-Za-z0-9_-]+$/.test(id);
}

// ── The tolerant readers ──────────────────────────────────────────────────────
// Extraction contracts differ per classification type (BINDER speaks
// quote_context/coverages; POLICY_DOCUMENT speaks policy.declarations), and
// the payloads are model output — every read below is defensive: wrong shape
// answers null, never throws, never substitutes a default.

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function addressOf(v: unknown): DocPolicyFacts["insuredAddress"] {
  const a = rec(v);
  if (!a) return null;
  const explicitStreet1 = str(a.street1) ?? str(a.address_line_1);
  const explicitStreet2 = str(a.street2) ?? str(a.address_line_2);
  const street = str(a.street);
  const streetLines = street
    ? street
        .split(/[\r\n]+/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  const street1 = explicitStreet1 ?? streetLines[0] ?? null;
  const street2 =
    explicitStreet2 ??
    (streetLines.length > 1 ? streetLines.slice(1).join(" ") : null);
  const out = {
    street: [street1, street2].filter(Boolean).join("\n") || null,
    street1,
    street2,
    city: str(a.city),
    state: str(a.state),
    zip: str(a.zip) ?? str(a.postal_code),
    country: str(a.country) ?? str(a.country_code),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

// "Limit—Each Occurrence: 1,000,000.00" / "Deductible: None" — the BINDER
// contract's coverage_details line grammar. Non-limit lines answer null.
export function parseCoverageDetailLine(line: string): { kind: "limit"; label: string; amount: string } | { kind: "deductible"; value: string } | null {
  const m = line.match(/^\s*Limit\s*[—\-–:]\s*([^:]+):\s*(.+)\s*$/i);
  if (m) {
    const label = m[1].trim();
    const amount = m[2].trim();
    if (label && amount) return { kind: "limit", label, amount };
  }
  const d = line.match(/^\s*Deductible\s*[—\-–:]?\s*:?\s*(.+)\s*$/i);
  if (d) {
    const value = d[1].trim();
    if (value && !/^none$/i.test(value)) return { kind: "deductible", value };
  }
  return null;
}

interface CoverageFold {
  lines: string[];
  limits: DocCoverageLimit[];
  deductible: string | null;
  policies: CoiGenerationPolicy[];
}

function foldCoverageEntry(
  entry: unknown,
  fold: CoverageFold,
  identity: {
    carrierRef: string;
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
  },
): void {
  const c = rec(entry);
  if (!c) return;
  // coverage_type arrives as an array (BINDER) or a string (POLICY_DOCUMENT).
  const types = Array.isArray(c.coverage_type) ? c.coverage_type.map(str).filter(Boolean) : [str(c.coverage_type)].filter(Boolean);
  const lineName = (types[0] as string | undefined) ?? str(c.coverage_description) ?? "Coverage";
  for (const t of types) if (t && !fold.lines.includes(t)) fold.lines.push(t);
  if (!types.length && str(c.coverage_description) && !fold.lines.includes(lineName)) fold.lines.push(lineName);
  const canonicalLimits: Array<{ label: string; amount: string }> = [];
  // POLICY_DOCUMENT contract: limits as [{ label, amount }].
  for (const lim of arr(c.limits)) {
    const l = rec(lim);
    const label = l ? str(l.label) : null;
    const amount = l ? str(l.amount) : null;
    if (label && amount) {
      fold.limits.push({ line: lineName, label, amount });
      canonicalLimits.push({ label, amount });
    }
  }
  // BINDER contract: coverage_details as "Limit—X: amount" strings.
  for (const detail of arr(c.coverage_details)) {
    const s = str(detail);
    if (!s) continue;
    const parsed = parseCoverageDetailLine(s);
    if (parsed?.kind === "limit") {
      fold.limits.push({ line: lineName, label: parsed.label, amount: parsed.amount });
      canonicalLimits.push({ label: parsed.label, amount: parsed.amount });
    }
    if (parsed?.kind === "deductible" && !fold.deductible) fold.deductible = parsed.value;
  }
  if (!fold.deductible) {
    const d = str(c.deductible);
    if (d && !/^none$/i.test(d)) fold.deductible = d;
  }
  const policyLines = types.length
    ? (types as string[])
    : [lineName];
  // A BINDER can name several coverage lines beside one flat identity/limit
  // block. Those shared facts cannot be attributed to any one ACORD section.
  // Keep the line shells, but leave their per-line facts empty until extraction
  // supplies a one-line entry.
  const canonicalPolicyLines = policyLines.map((displayName) => {
    const line = coiPolicyLineFromText(displayName);
    const policyKey =
      line === "other"
        ? `${line}:${displayName.trim().replace(/\s+/g, " ").toLowerCase()}`
        : line;
    return { displayName, line, policyKey };
  });
  const factsAreLineSpecific =
    new Set(canonicalPolicyLines.map(({ policyKey }) => policyKey)).size === 1;
  const seenPolicyKeys = new Set<string>();
  for (const { displayName, line, policyKey } of canonicalPolicyLines) {
    if (seenPolicyKeys.has(policyKey)) continue;
    seenPolicyKeys.add(policyKey);
    const limits: CoiGenerationLimit[] = factsAreLineSpecific
      ? canonicalLimits.map(({ label, amount }) => ({
          key: canonicalLimitKeyFromLabel(displayName, label),
          amount,
          rawLabel: label,
        }))
      : [];
    fold.policies.push({
      line,
      displayName,
      carrierRef: factsAreLineSpecific ? identity.carrierRef : "",
      policyNumber: factsAreLineSpecific ? identity.policyNumber : "",
      effectiveDate: factsAreLineSpecific ? identity.effectiveDate : "",
      expirationDate: factsAreLineSpecific ? identity.expirationDate : "",
      coverageBasis: factsAreLineSpecific
        ? coiCoverageBasisFromValue(c.coverage_basis)
        : "unknown",
      limits,
    });
  }
}

// ── The normalizer ────────────────────────────────────────────────────────────
// One extraction payload (whatever its per-type contract) → the certificate
// facts. Known contracts read precisely; unknown shapes fall through to null
// facts (which the caller treats as "the extraction holds nothing usable" —
// the honest empty, never a guess).
export function docFactsFromExtraction(
  payload: unknown,
  meta: { artifactId: string; docName: string; classificationType: string | null },
): DocPolicyFacts | null {
  const root = rec(payload);
  if (!root) return null;

  // POLICY_DOCUMENT: the facts live under policy.declarations.
  const decl = rec(rec(root.policy)?.declarations);
  // BINDER: the facts live at the top level (insured / carrier / coverage /
  // quote_context).
  const insured = rec(decl?.named_insured) ?? rec(root.insured);
  const carrier = rec(decl?.carrier) ?? rec(root.carrier);
  const term = rec(decl?.policy_term) ?? rec(rec(root.quote_context)?.proposed_term);

  // The policy number: POLICY_DOCUMENT states it outright; a BINDER carries
  // it as the binder/quote number (the same paper's number pre-issuance) —
  // document-sourced either way, so the checker's confirm-against-the-
  // document line rides every consumer.
  const policyNumber = str(decl?.policy_number) ?? str(rec(root.quote_context)?.quote_number);
  const effectiveDate = str(term?.effective_date) ?? str(term?.effective);
  const expirationDate = str(term?.expiration_date) ?? str(term?.expiration);
  const carrierName = str(carrier?.name);
  const carrierNaic =
    str(carrier?.naic_code) ??
    str(carrier?.naic_number) ??
    str(carrier?.naic) ??
    str(carrier?.NAIC);
  const carrierRef = "carrier-A";
  const fold: CoverageFold = {
    lines: [],
    limits: [],
    deductible: null,
    policies: [],
  };
  const identity = {
    carrierRef,
    policyNumber: policyNumber ?? "",
    effectiveDate: effectiveDate ?? "",
    expirationDate: expirationDate ?? "",
  };
  for (const entry of arr(decl?.coverage_lines)) {
    foldCoverageEntry(entry, fold, identity);
  }
  for (const entry of arr(rec(root.coverage)?.coverages)) {
    foldCoverageEntry(entry, fold, identity);
  }
  const insuredAddress = addressOf(insured?.address);
  const namedInsured = str(insured?.legal_name) ?? str(insured?.name);
  const generationInput: CanonicalCoiGenerationInput = {
    insured: {
      legalName: namedInsured ?? "",
      address: insuredAddress
        ? {
            street1: insuredAddress.street1 ?? "",
            street2: insuredAddress.street2 ?? "",
            city: insuredAddress.city ?? "",
            state: insuredAddress.state ?? "",
            zip: insuredAddress.zip ?? "",
            country: insuredAddress.country ?? "",
          }
        : emptyCoiAddress(),
    },
    carriers:
      carrierName || carrierNaic
        ? [
            {
              ref: carrierRef,
              slot: "A",
              legalName: carrierName ?? "",
              naicCode: carrierNaic ?? "",
            },
          ]
        : [],
    policies: fold.policies,
  };

  const facts: DocPolicyFacts = {
    artifactId: meta.artifactId,
    docName: meta.docName,
    classificationType: meta.classificationType,
    namedInsured,
    insuredDba: str(insured?.dba),
    insuredAddress,
    carrier: carrierName,
    carrierNaic,
    policyNumber,
    effectiveDate,
    expirationDate,
    coverageLines: fold.lines,
    limits: fold.limits,
    deductible: fold.deductible,
    generationInput,
  };

  const holdsAnything =
    facts.namedInsured || facts.carrier || facts.policyNumber || facts.effectiveDate || facts.expirationDate || facts.coverageLines.length || facts.limits.length;
  return holdsAnything ? facts : null;
}

// The named-insured display form: "TESTA SAMPLESON dba SAMPLE RANCH 99" —
// the certificate names the party the document names, dba included.
export function docInsuredDisplayName(facts: Pick<DocPolicyFacts, "namedInsured" | "insuredDba">): string | null {
  if (!facts.namedInsured) return null;
  return facts.insuredDba ? `${facts.namedInsured} dba ${facts.insuredDba}` : facts.namedInsured;
}

const GENERATION_LINE_ORDER: CoiPolicyLine[] = [
  "cgl",
  "auto",
  "umbrella",
  "workers_comp",
  "other",
];

function carrierIdentity(name: string, naic: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${naic.trim()}`;
}

function mergeGenerationInputs(
  parts: DocPolicyFacts[],
  namedInsured: string | null,
  insuredAddress: DocPolicyFacts["insuredAddress"],
): CanonicalCoiGenerationInput | undefined {
  const inputs = parts.flatMap((part, partIndex) =>
    part.generationInput ? [{ partIndex, input: part.generationInput }] : [],
  );
  if (!inputs.length) return undefined;

  const carrierByIdentity = new Map<
    string,
    { legalName: string; naicCode: string }
  >();
  const localCarrierIdentity = new Map<string, string>();
  for (const { partIndex, input } of inputs) {
    for (const carrier of input.carriers) {
      const identity = carrierIdentity(carrier.legalName, carrier.naicCode);
      if (!identity.replace("|", "")) continue;
      localCarrierIdentity.set(`${partIndex}:${carrier.ref}`, identity);
      if (!carrierByIdentity.has(identity)) {
        carrierByIdentity.set(identity, {
          legalName: carrier.legalName,
          naicCode: carrier.naicCode,
        });
      }
    }
  }

  const policies = inputs.flatMap(({ partIndex, input }, inputIndex) =>
    input.policies.map((policy, policyIndex) => ({
      partIndex,
      inputIndex,
      policyIndex,
      policy,
      identity:
        localCarrierIdentity.get(`${partIndex}:${policy.carrierRef}`) ?? "",
    })),
  );
  policies.sort(
    (left, right) =>
      GENERATION_LINE_ORDER.indexOf(left.policy.line) -
        GENERATION_LINE_ORDER.indexOf(right.policy.line) ||
      left.inputIndex - right.inputIndex ||
      left.policyIndex - right.policyIndex,
  );

  const slotByIdentity = new Map<string, CoiCarrierSlot>();
  const assignSlot = (identity: string) => {
    if (!identity || slotByIdentity.has(identity)) return;
    const slot = COI_CARRIER_SLOTS[slotByIdentity.size];
    if (slot) slotByIdentity.set(identity, slot);
  };
  for (const row of policies) assignSlot(row.identity);
  for (const identity of carrierByIdentity.keys()) assignSlot(identity);

  const carriers = [...slotByIdentity.entries()].flatMap(([identity, slot]) => {
    const carrier = carrierByIdentity.get(identity);
    return carrier
      ? [
          {
            ref: `carrier-${slot}`,
            slot,
            legalName: carrier.legalName,
            naicCode: carrier.naicCode,
          },
        ]
      : [];
  });
  const seenPolicies = new Set<string>();
  const mergedPolicies = policies.flatMap(({ policy, identity }) => {
    const slot = slotByIdentity.get(identity);
    const merged: CoiGenerationPolicy = {
      ...policy,
      carrierRef: slot ? `carrier-${slot}` : "",
      limits: policy.limits.map((limit) => ({ ...limit })),
    };
    const key = JSON.stringify([
      merged.line,
      merged.displayName,
      merged.carrierRef,
      merged.policyNumber,
      merged.effectiveDate,
      merged.expirationDate,
      merged.coverageBasis,
      merged.limits,
    ]);
    if (seenPolicies.has(key)) return [];
    seenPolicies.add(key);
    return [merged];
  });

  const sourceAddress =
    inputs.map(({ input }) => input.insured.address).find((address) =>
      Object.values(address).some(Boolean),
    ) ?? emptyCoiAddress();
  return {
    insured: {
      legalName:
        namedInsured ??
        inputs.map(({ input }) => input.insured.legalName).find(Boolean) ??
        "",
      address: insuredAddress
        ? {
            street1: insuredAddress.street1 ?? "",
            street2: insuredAddress.street2 ?? "",
            city: insuredAddress.city ?? "",
            state: insuredAddress.state ?? "",
            zip: insuredAddress.zip ?? "",
            country: insuredAddress.country ?? "",
          }
        : { ...sourceAddress },
    },
    carriers,
    policies: mergedPolicies,
  };
}

// Merge extraction facts from multiple operator-picked documents.
// Order: newest-authoritative-first (caller sorts). Scalar fields keep the
// first non-null; coverage lines/limits union with de-dupe. Provenance names
// every contributing document on docName.
export function mergeDocPolicyFacts(parts: DocPolicyFacts[]): DocPolicyFacts | null {
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const head = parts[0];
  const namedInsured = parts.map((p) => p.namedInsured).find(Boolean) ?? null;
  const insuredDba = parts.map((p) => p.insuredDba).find(Boolean) ?? null;
  const insuredAddress = parts.map((p) => p.insuredAddress).find(Boolean) ?? null;
  const carrier = parts.map((p) => p.carrier).find(Boolean) ?? null;
  const carrierNaic = parts.map((p) => p.carrierNaic).find(Boolean) ?? null;
  const policyNumber = parts.map((p) => p.policyNumber).find(Boolean) ?? null;
  const effectiveDate = parts.map((p) => p.effectiveDate).find(Boolean) ?? null;
  const expirationDate = parts.map((p) => p.expirationDate).find(Boolean) ?? null;
  const deductible = parts.map((p) => p.deductible).find(Boolean) ?? null;
  const coverageLines: string[] = [];
  const limits: DocCoverageLimit[] = [];
  for (const p of parts) {
    for (const line of p.coverageLines) if (!coverageLines.includes(line)) coverageLines.push(line);
    for (const lim of p.limits) {
      if (!limits.some((x) => x.line === lim.line && x.label === lim.label && x.amount === lim.amount)) {
        limits.push(lim);
      }
    }
  }
  const names = parts.map((p) => p.docName).filter(Boolean);
  return {
    artifactId: head.artifactId,
    docName: names.length > 1 ? `${names.join(" + ")}` : head.docName,
    classificationType: head.classificationType,
    namedInsured,
    insuredDba,
    insuredAddress,
    carrier,
    carrierNaic,
    policyNumber,
    effectiveDate,
    expirationDate,
    coverageLines,
    limits,
    deductible,
    generationInput: mergeGenerationInputs(parts, namedInsured, insuredAddress),
  };
}
