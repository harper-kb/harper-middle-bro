import "server-only";
import { getDb } from "@/lib/db/connection";
import type { CoiFormType } from "./coi-forms";

// ── The generated-certificate store (this repo's rewrite of HTA's coi-save) ──
// HTA persisted through harper-tools' gated `service coi update` door into
// insurance.generated_certificates. This desk has no prod gateway, so the same
// contract lands on the local SQLite `generated_certificates` table instead:
// one row per generation, corrections CAS-guarded on updated_at (compared
// byte-for-byte, exactly like the far door compared Postgres version strings).

export interface StoredGeneratedCert {
  certificateId: number;
  accountId: string;
  formType: CoiFormType;
  status: string;
  fieldValues: Record<string, string>;
  generation: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCoiCore {
  generatedCert: StoredGeneratedCert | null;
  /** The newest OLDER row whose field_values actually hold something. */
  priorCert: StoredGeneratedCert | null;
}

export type CoiSaveResult =
  | { kind: "saved"; detail: string; updatedAt: string }
  | { kind: "no_change"; detail: string }
  | { kind: "conflict"; detail: string }
  | { kind: "not_found"; detail: string };

interface CertRow {
  id: number;
  account_id: string;
  form_type: string;
  status: string;
  field_values_json: string;
  generation_json: string | null;
  created_at: string;
  updated_at: string;
}

function parseFieldValues(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function mapRow(row: CertRow): StoredGeneratedCert {
  let generation: Record<string, unknown> | null = null;
  if (row.generation_json) {
    try {
      const parsed = JSON.parse(row.generation_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        generation = parsed as Record<string, unknown>;
      }
    } catch {
      generation = null;
    }
  }
  return {
    certificateId: row.id,
    accountId: row.account_id,
    formType: row.form_type === "acord30" ? "acord30" : "acord25",
    status: row.status,
    fieldValues: parseFieldValues(row.field_values_json),
    generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The account's newest stored certificate + the prior tier below it. */
export function loadStoredCoiCore(accountId: string): StoredCoiCore {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM generated_certificates WHERE account_id = ? ORDER BY id DESC LIMIT 10`,
    )
    .all(accountId) as CertRow[];
  const mapped = rows.map(mapRow);
  const generatedCert = mapped[0] ?? null;
  const priorCert =
    mapped
      .slice(1)
      .find((cert) => Object.values(cert.fieldValues).some((v) => v.trim())) ?? null;
  return { generatedCert, priorCert };
}

/** One EXACT stored row, or null — a receipt names a row, never "latest". */
export function loadStoredCoiCertificateResource(
  accountId: string,
  certificateId: number,
): StoredGeneratedCert | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM generated_certificates WHERE account_id = ? AND id = ?`,
    )
    .get(accountId, certificateId) as CertRow | undefined;
  return row ? mapRow(row) : null;
}

/** Insert a fresh generation row (status 'draft'). */
export function persistCoiGeneration(input: {
  accountId: string;
  formType: CoiFormType;
  fieldValues: Record<string, string>;
  generation?: Record<string, unknown> | null;
}): { certificateId: number; updatedAt: string } {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO generated_certificates (
        account_id, form_type, status, field_values_json, generation_json, created_at, updated_at
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
    )
    .run(
      input.accountId,
      input.formType,
      JSON.stringify(input.fieldValues),
      input.generation ? JSON.stringify(input.generation) : null,
      now,
      now,
    );
  return { certificateId: Number(result.lastInsertRowid), updatedAt: now };
}

/**
 * Persist reviewer corrections onto an existing row. The CAS rail: when the
 * caller carries expectedVersion, it must equal the row's updated_at
 * byte-for-byte or the write refuses — a newer save landed since the card
 * loaded, and overwriting it silently is the losing direction.
 */
export function persistCoiCorrection(input: {
  certificateId: number;
  fieldValues: Record<string, string>;
  expectedVersion?: string | null;
}): CoiSaveResult {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM generated_certificates WHERE id = ?`)
    .get(input.certificateId) as CertRow | undefined;
  if (!row) {
    return { kind: "not_found", detail: `No stored certificate row ${input.certificateId}.` };
  }
  if (input.expectedVersion && input.expectedVersion !== row.updated_at) {
    return {
      kind: "conflict",
      detail:
        "The stored certificate changed since this card loaded. Reload and re-apply your corrections.",
    };
  }
  const current = parseFieldValues(row.field_values_json);
  const next = { ...current, ...input.fieldValues };
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return { kind: "no_change", detail: "No field changed — nothing written." };
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE generated_certificates SET field_values_json = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(next), now, input.certificateId);
  return {
    kind: "saved",
    detail: `Saved ${Object.keys(input.fieldValues).length} field(s).`,
    updatedAt: now,
  };
}
