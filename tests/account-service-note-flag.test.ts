import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { listBookAccountsPage } from "@/lib/db/queries/accounts";

/**
 * `BookAccountListItem.hasServiceNotes` seeds the expanded order cards'
 * instant "No notes yet" state, so it must be a verified account-level fact:
 * true iff any of the account's book orders — filtered out of the current
 * view or not — carries a snapshot Service Note. Exercised against the synced
 * local book; skips (with a note) when the book has not synced.
 */

const DB_PATH = path.join(process.cwd(), "data", "underwriter-desk.db");

const hasBook =
  fs.existsSync(DB_PATH) &&
  (() => {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return Boolean(
        db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'book_orders'`,
          )
          .get(),
      );
    } finally {
      db.close();
    }
  })();

const withBook = hasBook ? describe : describe.skip;

withBook("account-level service note flag", () => {
  it("matches a direct scan of every order on the account", () => {
    const page = listBookAccountsPage({ offset: 0, limit: 200 });
    expect(page.rows.length).toBeGreaterThan(0);

    const db = new Database(DB_PATH, { readonly: true });
    try {
      const direct = db.prepare(
        `SELECT EXISTS (
           SELECT 1 FROM book_orders sn
           WHERE sn.account_id = ?
             AND json_extract(sn.rich_json, '$.serviceNote') IS NOT NULL
         ) AS has_notes`,
      );
      for (const row of page.rows) {
        const expected = Boolean(
          (direct.get(row.id) as { has_notes: number }).has_notes,
        );
        expect(row.hasServiceNotes, row.id).toBe(expected);
      }
      const flags = new Set(page.rows.map((row) => row.hasServiceNotes));
      // The book carries both kinds of account; a constant flag would mean
      // the column is wired wrong rather than measuring anything.
      expect(flags.size).toBe(2);
    } finally {
      db.close();
    }
  });

  it("stays account-scoped when the view filters orders away", () => {
    // Broker + pending is a heavily filtered view; the flag must still
    // describe the whole account, not the filtered order subset.
    const page = listBookAccountsPage({
      mode: "pending",
      source: "broker",
      offset: 0,
      limit: 50,
    });
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const direct = db.prepare(
        `SELECT EXISTS (
           SELECT 1 FROM book_orders sn
           WHERE sn.account_id = ?
             AND json_extract(sn.rich_json, '$.serviceNote') IS NOT NULL
         ) AS has_notes`,
      );
      for (const row of page.rows) {
        const expected = Boolean(
          (direct.get(row.id) as { has_notes: number }).has_notes,
        );
        expect(row.hasServiceNotes, row.id).toBe(expected);
      }
    } finally {
      db.close();
    }
  });
});

if (!hasBook) {
  console.warn(
    "[account-service-note-flag.test] no synced book in data/underwriter-desk.db — skipped",
  );
}
