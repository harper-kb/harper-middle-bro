import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type {
  CarrierKnowledgeEntry,
  KnowledgeKind,
  KnowledgeSeverity,
} from "./carrier-knowledge";

/**
 * Operator-added carrier knowledge — the SQLite half of the registry. The
 * committed registry (`carrier-knowledge.ts`) carries the reviewed, possibly
 * enforceable entries; this table carries what the desk learns day to day.
 *
 * By design, rows written here are never enforceable: they render as cards
 * (notes and warnings) on the carrier page, merged with the committed
 * registry at read time. Turning a learned fact into a hard block means
 * moving it into the committed registry through code review.
 */

export function migrateCarrierKnowledgeTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS carrier_knowledge_entries (
      id TEXT PRIMARY KEY,
      carrier TEXT NOT NULL,
      writing_company TEXT,
      coverage_line TEXT,
      industry_vertical TEXT,
      state TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      consequence TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS carrier_knowledge_carrier
      ON carrier_knowledge_entries(carrier);
  `);
}

function mapRow(row: Record<string, unknown>): CarrierKnowledgeEntry {
  return {
    id: row.id as string,
    carrier: row.carrier as string,
    writingCompany: (row.writing_company as string) || undefined,
    coverageLine: (row.coverage_line as string) || undefined,
    industryVertical: (row.industry_vertical as string) || undefined,
    state: (row.state as string) || undefined,
    kind: row.kind as KnowledgeKind,
    severity: row.severity as KnowledgeSeverity,
    // Structural: operator rows can never hard-block. Enforcement rules
    // require code review by design.
    enforceable: false,
    title: row.title as string,
    detail: row.detail as string,
    consequence: (row.consequence as string) ?? "",
    source: row.source as string,
    recordedAt: (row.recorded_at as string).slice(0, 10),
  };
}

export function listOperatorKnowledgeEntries(
  db: Database.Database,
  carrier?: string,
): CarrierKnowledgeEntry[] {
  const rows = carrier
    ? (db
        .prepare(
          `SELECT * FROM carrier_knowledge_entries
           WHERE lower(carrier) = lower(?) ORDER BY recorded_at DESC, title ASC`,
        )
        .all(carrier) as Record<string, unknown>[])
    : (db
        .prepare(
          `SELECT * FROM carrier_knowledge_entries ORDER BY recorded_at DESC, title ASC`,
        )
        .all() as Record<string, unknown>[]);
  return rows.map(mapRow);
}

export function insertOperatorKnowledgeEntry(
  db: Database.Database,
  input: {
    carrier: string;
    writingCompany?: string | null;
    coverageLine?: string | null;
    industryVertical?: string | null;
    state?: string | null;
    kind: KnowledgeKind;
    /** Operator entries warn or note — a blocker requires code review */
    severity: Extract<KnowledgeSeverity, "warning" | "note">;
    title: string;
    detail: string;
    consequence?: string | null;
    source: string;
    createdBy?: string | null;
  },
): CarrierKnowledgeEntry {
  const id = `op-${randomUUID()}`;
  const recordedAt = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO carrier_knowledge_entries (
      id, carrier, writing_company, coverage_line, industry_vertical, state,
      kind, severity, title, detail, consequence, source, recorded_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.carrier.trim(),
    input.writingCompany?.trim() || null,
    input.coverageLine?.trim() || null,
    input.industryVertical?.trim() || null,
    input.state?.trim().toUpperCase() || null,
    input.kind,
    input.severity,
    input.title.trim(),
    input.detail.trim(),
    input.consequence?.trim() || "",
    input.source.trim(),
    recordedAt,
    input.createdBy ?? null,
  );
  const row = db
    .prepare(`SELECT * FROM carrier_knowledge_entries WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  return mapRow(row);
}
