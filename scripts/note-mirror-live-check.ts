/**
 * Live check for the local-first mirrors against the real Harper book.
 *
 * The claim this run has to earn: one boot-triggered full refresh (running
 * the extended accounts read, the all-entries notes read, and the widened
 * digest sweep against live Postgres) lands the Service Note threads and the
 * company-page overview in SQLite, after which note threads and the overview
 * answer entirely from local reads. Also exercises the scoped (unnest)
 * variants of the same SQL through the write-through primitive and a forced
 * one-company delta.
 *
 *   set -a; source .env.local; set +a
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/note-mirror-live-check.ts
 */
import {
  isRefreshConfigured,
  refreshBookDelta,
  refreshCompanyServiceNotes,
} from "../src/lib/db/book-refresh";
import {
  META_COMPANY_DETAILS_SYNCED_AT,
  META_SERVICE_NOTES_SYNCED_AT,
  readBookMeta,
} from "../src/lib/db/book-meta";
import { readBookRefreshStatus } from "../src/lib/db/book-refresh-status";
import { getDb } from "../src/lib/db/connection";
import { loadLocalCompanyOverview } from "../src/lib/company-detail.server";
import {
  loadLocalNoteThreads,
  localNoteThreadsReady,
} from "../src/lib/note-threads.server";
import { loadSupabaseBook } from "../src/lib/supabase-book.server";

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function count(db: ReturnType<typeof getDb>, sql: string, ...args: unknown[]) {
  return (db.prepare(sql).get(...args) as { c: number }).c;
}

async function main() {
  check("refresh credentials configured", isRefreshConfigured());
  if (failed) process.exit(1);

  const started = Date.now();
  // Boot: the on-disk snapshot predates the mirrors, so scheduleBookRefresh
  // fires a full refresh through the new SQL. One refresh for the whole run —
  // the shared Management API quota is not spent twice.
  const db = getDb();
  console.log("INFO  waiting for the boot full refresh to complete…");
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const status = readBookRefreshStatus();
    const fullAt = status.lastFullRefreshAt
      ? Date.parse(status.lastFullRefreshAt)
      : Number.NaN;
    if (Number.isFinite(fullAt) && fullAt >= started) break;
    const attemptAt = status.lastAttemptAt
      ? Date.parse(status.lastAttemptAt)
      : Number.NaN;
    if (
      status.lastAttemptStatus === "failed" &&
      Number.isFinite(attemptAt) &&
      attemptAt >= started
    ) {
      check("boot full refresh succeeded", false, "attempt failed — see log above");
      process.exit(1);
    }
    if (Date.now() > deadline) {
      check("boot full refresh completed within 5 minutes", false);
      process.exit(1);
    }
    await sleep(2_000);
  }
  console.log(
    `INFO  full refresh completed in ${Math.round((Date.now() - started) / 1000)}s`,
  );

  console.log("\n-- snapshot shape --");
  const book = loadSupabaseBook();
  check("snapshot loaded", book !== null);
  if (!book) process.exit(1);
  check("snapshot marks note threads present", book.noteThreadsPresent === true);
  check(
    "snapshot marks company details present",
    book.companyDetailsPresent === true,
  );
  const notes = book.serviceNoteEntries ?? [];
  const details = book.companyDetails ?? [];
  console.log(
    `INFO  ${book.accounts.length} accounts, ${book.orders.length} orders, ` +
      `${notes.length} note entries, ${details.length} company details`,
  );
  check(
    `snapshot carries the note corpus (${notes.length} entries)`,
    notes.length > 1_000,
  );
  check(
    "one company detail per account",
    details.length === book.accounts.length,
    `${details.length} vs ${book.accounts.length}`,
  );
  const contactsInSnapshot = details.reduce(
    (sum, detail) => sum + detail.contacts.length,
    0,
  );
  check(
    `snapshot carries display contacts (${contactsInSnapshot})`,
    contactsInSnapshot > 1_000,
  );

  console.log("\n-- SQLite mirrors --");
  const noteRows = count(db, `SELECT count(*) AS c FROM book_service_notes`);
  check(
    `book_service_notes mirrors the snapshot (${noteRows})`,
    noteRows === notes.length,
    `${noteRows} vs ${notes.length}`,
  );
  const detailRows = count(db, `SELECT count(*) AS c FROM book_company_details`);
  check(
    `book_company_details mirrors the snapshot (${detailRows})`,
    detailRows === details.length,
    `${detailRows} vs ${details.length}`,
  );
  const contactRows = count(db, `SELECT count(*) AS c FROM book_contacts`);
  check(
    `book_contacts mirrors the snapshot (${contactRows})`,
    contactRows === contactsInSnapshot,
    `${contactRows} vs ${contactsInSnapshot}`,
  );
  check(
    "note mirror marker set",
    readBookMeta(db, META_SERVICE_NOTES_SYNCED_AT) !== null,
  );
  check(
    "company details marker set",
    readBookMeta(db, META_COMPANY_DETAILS_SYNCED_AT) !== null,
  );
  check("local note threads report ready", localNoteThreadsReady(db));

  console.log("\n-- local reads --");
  // The busiest thread in the book is the most demanding local read.
  const notesByAccount = new Map<string, number>();
  for (const entry of notes) {
    notesByAccount.set(
      entry.accountId,
      (notesByAccount.get(entry.accountId) ?? 0) + 1,
    );
  }
  const [busiestAccount, busiestCount] = [...notesByAccount.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]!;
  const companyId = Number(busiestAccount.replace("co-", ""));
  const anchorOrder =
    book.orders.find((order) => order.accountId === busiestAccount)
      ?.harperOrderId ?? notes.find((n) => n.accountId === busiestAccount)!.orderId;
  const readStarted = Date.now();
  const threads = loadLocalNoteThreads(db, {
    companyId,
    orderId: anchorOrder,
    visibilityScope: "live-check",
  });
  const readMs = Date.now() - readStarted;
  check(
    `local thread read returns the full thread (${threads.service.entries.length} entries in ${readMs}ms)`,
    threads.service.entries.length === Math.min(busiestCount, 499),
    `${threads.service.entries.length} vs ${busiestCount}`,
  );
  check("local thread read is instant (<50ms)", readMs < 50, `${readMs}ms`);

  const overview = loadLocalCompanyOverview(companyId);
  check("local overview resolves", overview !== null);
  if (overview) {
    check(
      `local overview carries the account name ("${overview.name}")`,
      overview.name.trim().length > 0,
    );
    console.log(
      `INFO  overview: producer=${overview.producer?.name ?? "unassigned"}, ` +
        `city=${overview.location.city ?? "—"}, tz=${overview.timeZone.id ?? "—"}, ` +
        `${overview.contacts.length} contact(s)`,
    );
  }

  console.log("\n-- scoped reads (unnest branch) --");
  await refreshCompanyServiceNotes(db, companyId);
  const afterRoundTrip = count(
    db,
    `SELECT count(*) AS c FROM book_service_notes WHERE account_id = ?`,
    busiestAccount,
  );
  check(
    `write-through round-trip keeps the thread populated (${afterRoundTrip})`,
    afterRoundTrip >= 1,
  );

  db.prepare(
    `UPDATE book_sync_digests SET digest = 'forced' WHERE kind = 'company' AND id = ?`,
  ).run(String(companyId));
  const forced = await refreshBookDelta(db);
  check(
    "forced delta refetched the invalidated company",
    forced.delta.changedCompanyIds.includes(companyId),
    JSON.stringify(forced.delta.changedCompanyIds),
  );
  check(
    "delta merge kept the mirrors marked present",
    forced.book.noteThreadsPresent === true &&
      forced.book.companyDetailsPresent === true,
  );
  const afterDelta = count(
    db,
    `SELECT count(*) AS c FROM book_service_notes WHERE account_id = ?`,
    busiestAccount,
  );
  check(
    `the company's thread survived the delta merge (${afterDelta})`,
    afterDelta >= 1,
  );

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL ", err instanceof Error ? err.message : err);
  process.exit(1);
});
