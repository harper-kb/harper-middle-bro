import { createHash } from "node:crypto";
import {
  certDescription,
  resolveCertSheet,
  type Acord25Sheet,
  type CertFormKey,
  type PlacementMap,
} from "./acord25";
import {
  buildCertificatePacket,
  type CertificatePacket,
} from "./certificate";
import {
  buildSuggestions,
  effStr,
  type SheetOverrides,
} from "./cert-review";
import type { CoiDraft } from "./coi";
import { FLAG_LABELS } from "./coi";
import type { PolicyFormSet } from "./forms";
import { LIMIT_SLOT_LABELS, type LimitSlot } from "./forms";
import type { Account, Policy } from "./types";

/**
 * Frozen fact snapshot — the explicit set of facts a certificate binds to.
 *
 * Issuance never rides a live view: at the send moment the assembler reads
 * the schedule of record once, records every populated field with its
 * provenance (which form, schedule row, or registry entry supplied it), and
 * stamps the set with a timestamp and a content digest. The digest is the
 * staleness clock: a prepared certificate whose digest no longer matches a
 * freshly assembled snapshot is stale by definition and cannot be sent.
 *
 * Pure module — deterministic for a given input, no database access.
 */

export interface SnapshotField {
  /** Field id on the sheet (matches the review-rail suggestion ids) */
  id: string;
  label: string;
  value: string;
  /** Which document / schedule row / registry supplied the value */
  source: string;
}

export interface FactSnapshot {
  takenAt: string;
  formKey: CertFormKey;
  holderName: string;
  holderAddress: string;
  /** Policy identity rows — number + term per selected policy */
  policies: { id: string; policyNumber: string; carrier: string; effectiveDate: string; expirationDate: string }[];
  /** Every populated field with per-field provenance */
  fields: SnapshotField[];
  /** The exact Description Of Operations text bound to the certificate */
  description: string;
  /** Content digest over everything above except takenAt — the staleness clock */
  digest: string;
}

export interface SnapshotInput {
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
  formKey: CertFormKey;
  placements: PlacementMap;
  holderName: string;
  holderAddress: string;
  /** Reviewer edits applied on top of the resolved sheet */
  overrides: SheetOverrides;
  projectWording?: string;
  /** Clock injection for tests; defaults to now */
  takenAt?: string;
}

export interface SnapshotBundle {
  snapshot: FactSnapshot;
  packet: CertificatePacket;
  sheet: Acord25Sheet;
}

function digestOf(snapshot: Omit<FactSnapshot, "digest" | "takenAt">): string {
  const canonical = JSON.stringify({
    formKey: snapshot.formKey,
    holderName: snapshot.holderName,
    holderAddress: snapshot.holderAddress,
    policies: snapshot.policies,
    fields: [...snapshot.fields].sort((a, b) => a.id.localeCompare(b.id)),
    description: snapshot.description,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Assemble the frozen snapshot for one certificate: resolve the sheet off
 * the schedule of record, apply reviewer overrides, and record every field
 * with provenance. The same call serves preparation and issuance — the
 * digest comparison between the two moments is the staleness check.
 */
export function buildFactSnapshot(input: SnapshotInput): SnapshotBundle {
  const packet = buildCertificatePacket({
    account: input.account,
    policies: input.policies,
    formSets: input.formSets,
    holderName: input.holderName,
    holderAddress: input.holderAddress,
    projectWording: input.projectWording,
  });
  const sheet = resolveCertSheet(input.formKey, packet.sections, input.placements);
  const suggestions = buildSuggestions(sheet, packet);

  const fields: SnapshotField[] = suggestions.map((s) => {
    const o = input.overrides[s.id];
    const edited = typeof o === "string" && o.trim().length > 0;
    return {
      id: s.id,
      label: s.label,
      value: edited ? (o as string).trim() : s.display,
      source: edited ? `reviewer edit (was: ${s.source})` : s.source,
    };
  });
  // Reviewer entries on fields the resolver left blank are facts too — they
  // are part of what the certificate claims, so they join the snapshot with
  // reviewer provenance and count against the digest.
  const known = new Set(fields.map((f) => f.id));
  for (const [id, v] of Object.entries(input.overrides)) {
    if (known.has(id) || id === "desc") continue;
    const value = typeof v === "boolean" ? (v ? "✓ Checked" : "") : v.trim();
    if (!value) continue;
    fields.push({ id, label: id, value, source: "reviewer entry" });
  }

  const description = effStr(input.overrides, "desc", certDescription(packet, sheet));
  const body = {
    formKey: input.formKey,
    holderName: input.holderName.trim(),
    holderAddress: input.holderAddress.trim(),
    policies: input.policies.map((p) => ({
      id: p.id,
      policyNumber: p.policyNumber,
      carrier: p.carrier,
      effectiveDate: p.effectiveDate,
      expirationDate: p.expirationDate,
    })),
    fields,
    description,
  };

  return {
    packet,
    sheet,
    snapshot: {
      ...body,
      takenAt: input.takenAt ?? new Date().toISOString(),
      digest: digestOf(body),
    },
  };
}

/**
 * Snapshot for the ticket path, whose artifact is a single-policy COI draft
 * rather than a full resolved sheet. Same shape, same digest semantics.
 */
export function buildDraftSnapshot(input: {
  draft: CoiDraft;
  policy: Policy;
  takenAt?: string;
}): FactSnapshot {
  const { draft, policy } = input;
  const fields: SnapshotField[] = [
    { id: "insured.name", label: "Named Insured", value: draft.insuredName, source: "policy record" },
    { id: "policy.number", label: "Policy Number", value: draft.policyNumber, source: "policy record" },
    { id: "policy.carrier", label: "Carrier", value: draft.carrier, source: "policy record" },
    { id: "policy.eff", label: "Policy Eff", value: draft.effectiveDate, source: "policy record" },
    { id: "policy.exp", label: "Policy Exp", value: draft.expirationDate, source: "policy record" },
  ];
  for (const [slot, cents] of Object.entries(draft.limits)) {
    if (cents == null) continue;
    fields.push({
      id: `limit.${slot}`,
      label: LIMIT_SLOT_LABELS[slot as LimitSlot] ?? slot,
      value: `$ ${new Intl.NumberFormat("en-US").format(Math.round(cents / 100))}`,
      source: "policy schedule",
    });
  }
  for (const [flag, on] of Object.entries(draft.flags)) {
    if (!on) continue;
    fields.push({
      id: `flag.${flag}`,
      label: FLAG_LABELS[flag as keyof typeof FLAG_LABELS] ?? flag,
      value: "✓ Checked",
      source: "endorsement schedule",
    });
  }
  const body = {
    formKey: "acord25" as CertFormKey,
    holderName: draft.holderName.trim(),
    holderAddress: draft.holderAddress.trim(),
    policies: [
      {
        id: policy.id,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
      },
    ],
    fields,
    description: draft.description,
  };
  return {
    ...body,
    takenAt: input.takenAt ?? new Date().toISOString(),
    digest: digestOf(body),
  };
}
