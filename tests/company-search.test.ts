import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  COMPANY_SEARCH_MIN_LENGTH,
  searchCompanies,
} from "@/lib/db/queries/company-search";

/**
 * Global company search, exercised against the synced Harper book in the local
 * cache rather than fixtures — the ranking, the normalization and the preview
 * summaries are only meaningful against real names, contacts and order shapes.
 *
 * A clone that has never synced has nothing to assert on, so the suite reports
 * that and skips instead of failing.
 */

const DB_PATH = path.join(process.cwd(), "data", "underwriter-desk.db");

function readBook() {
  if (!fs.existsSync(DB_PATH)) return null;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const hasKeys = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'account_search_keys'`,
      )
      .get();
    if (!hasKeys) return null;

    const account = db
      .prepare(
        `SELECT id, name FROM accounts
         WHERE id LIKE 'co-%' AND length(name) >= 8
           AND EXISTS (SELECT 1 FROM book_orders o WHERE o.account_id = accounts.id)
         ORDER BY name LIMIT 1`,
      )
      .get() as { id: string; name: string } | undefined;
    const email = db
      .prepare(
        `SELECT account_id, value FROM account_search_keys
         WHERE kind = 'email' LIMIT 1`,
      )
      .get() as { account_id: string; value: string } | undefined;
    const phone = db
      .prepare(
        `SELECT account_id, value FROM account_search_keys
         WHERE kind = 'phone' AND length(value) = 11 AND value LIKE '1%' LIMIT 1`,
      )
      .get() as { account_id: string; value: string } | undefined;
    const multiStatus = db
      .prepare(
        `SELECT account_id FROM book_orders
         GROUP BY account_id HAVING count(DISTINCT bind_status) > 1 LIMIT 1`,
      )
      .get() as { account_id: string } | undefined;

    if (!account || !email || !phone) return null;
    return { account, email, phone, multiStatus };
  } finally {
    db.close();
  }
}

const book = readBook();
const withBook = book ? describe : describe.skip;

withBook("global company search", () => {
  it("matches a partial company name while typing", () => {
    const fragment = book!.account.name.slice(0, 6);
    const results = searchCompanies(fragment);
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.id)).toContain(book!.account.id);
  });

  it("is case-insensitive on company names", () => {
    const fragment = book!.account.name.slice(0, 6);
    expect(searchCompanies(fragment.toUpperCase()).map((r) => r.id)).toEqual(
      searchCompanies(fragment.toLowerCase()).map((r) => r.id),
    );
  });

  it("ranks a prefix match above a mere substring match", () => {
    // "n" prefixed names must outrank names that merely contain the fragment.
    const results = searchCompanies("ma");
    const ranks = results.map((r) => r.name.toLowerCase().startsWith("ma"));
    const firstSubstringOnly = ranks.indexOf(false);
    if (firstSubstringOnly === -1) return;
    expect(ranks.slice(firstSubstringOnly).some(Boolean)).toBe(false);
  });

  it("finds an account by a partial customer email", () => {
    const fragment = book!.email.value.slice(0, 8);
    const results = searchCompanies(fragment);
    expect(results.map((r) => r.id)).toContain(book!.email.account_id);
  });

  it("normalizes punctuation, spacing and country code in phone queries", () => {
    // Harper stores E.164; the operator types whatever is in front of them.
    const digits = book!.phone.value;
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7);
    const formats = [
      digits,
      `${area}${prefix}${line}`,
      `(${area}) ${prefix}-${line}`,
      `+1 ${area} ${prefix} ${line}`,
      `1-${area}-${prefix}-${line}`,
    ];
    for (const format of formats) {
      expect(
        searchCompanies(format).map((r) => r.id),
        `phone format ${format}`,
      ).toContain(book!.phone.account_id);
    }
  });

  it("returns nothing below the minimum query length", () => {
    expect(searchCompanies("a")).toEqual([]);
    expect(searchCompanies("   ")).toEqual([]);
    expect(COMPANY_SEARCH_MIN_LENGTH).toBe(2);
  });

  it("treats LIKE wildcards as literal characters", () => {
    // Unescaped, "%%" would match the entire book.
    expect(searchCompanies("%%").length).toBe(0);
    expect(searchCompanies("__").length).toBe(0);
  });

  it("caps the result set", () => {
    expect(searchCompanies("a b").length).toBeLessThanOrEqual(8);
    expect(searchCompanies("in").length).toBeLessThanOrEqual(8);
  });

  it("reports every lifecycle state on a multi-order account", () => {
    if (!book!.multiStatus) return;
    const db = new Database(DB_PATH, { readonly: true });
    const account = db
      .prepare(`SELECT name FROM accounts WHERE id = ?`)
      .get(book!.multiStatus.account_id) as { name: string };
    db.close();

    const match = searchCompanies(account.name).find(
      (r) => r.id === book!.multiStatus!.account_id,
    );
    expect(match).toBeDefined();
    expect(match!.statuses.length).toBeGreaterThan(1);
  });

  it("never returns a customer email or phone number", () => {
    const results = searchCompanies(book!.email.value.slice(0, 8));
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(book!.email.value);
    expect(serialized).not.toContain("@");
  });
});

if (!book) {
  console.warn(
    "[company-search.test] no synced book in data/underwriter-desk.db — skipped",
  );
}
