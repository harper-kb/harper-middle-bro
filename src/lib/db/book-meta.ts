import type Database from "better-sqlite3";

/**
 * Tiny key/value flags about what the local mirror currently holds, kept in
 * SQLite so request paths can decide local-vs-live without re-reading the
 * 20MB book snapshot. Written inside the same transaction as the data they
 * describe — a flag must never claim rows that are not there.
 */

/** Set (to an ISO timestamp) once the Service Note thread mirror is synced. */
export const META_SERVICE_NOTES_SYNCED_AT = "service_notes_synced_at";

/** Set once the company-page overview mirror (details + contacts) is synced. */
export const META_COMPANY_DETAILS_SYNCED_AT = "company_details_synced_at";

export function readBookMeta(
  db: Database.Database,
  key: string,
): string | null {
  const row = db
    .prepare(`SELECT value FROM book_meta WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function writeBookMeta(
  db: Database.Database,
  key: string,
  value: string,
): void {
  db.prepare(
    `INSERT INTO book_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
