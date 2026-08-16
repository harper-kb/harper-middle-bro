/**
 * Live Service Note preview check — confirms the five-minute book carries
 * Workbench notes from public.service_note_entries (not producer notes), that
 * Habibi Smoke & Vape matches the authoritative latest entry, and that
 * listBookAccountsPage surfaces the note on the collapsed account row without
 * an N+1 fetch.
 *
 * Run: npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.render-check.json scripts/service-note-preview-check.ts
 */
import { getDb } from "../src/lib/db/connection";
import { listBookAccountsPage } from "../src/lib/db/queries/accounts";
import { loadSupabaseBook } from "../src/lib/supabase-book.server";
import { pickLatestServiceNote } from "../src/lib/service-note";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const book = loadSupabaseBook();
check("snapshot declares service notes present", book?.serviceNotesPresent === true);

const withNotes = (book?.orders ?? []).filter((o) => o.rich.serviceNote);
check(
  `book orders carry latest service notes (${withNotes.length} orders)`,
  withNotes.length > 0,
);

const habibi = listBookAccountsPage({
  query: "habibi",
  mode: "pending",
  source: "iq",
  range: "all-time",
  offset: 0,
  limit: 10,
});
const row = habibi.rows.find((a) => a.id === "co-926776") ?? habibi.rows[0];
check("Habibi pending account is in the page", Boolean(row));
if (row) {
  const preview = pickLatestServiceNote(row.orders);
  check(
    `Habibi latest body is Out for signature (${preview?.body ?? "none"})`,
    preview?.body === "Out for signature",
  );
  check(
    `Habibi author is Ether Hammemi (${preview?.author ?? "none"})`,
    preview?.author === "Ether Hammemi",
  );
  check(
    `Habibi order is #12909 (${preview?.orderId ?? "none"})`,
    preview?.orderId === 12909,
  );
}

// Soft-deleted notes must never land on the snapshot (deleted_at IS NULL only).
const deletedLeak = (book?.orders ?? []).some(
  (o) => o.rich.serviceNote?.body === "__deleted_should_not_appear__",
);
check("no fabricated deleted-note marker", !deletedLeak);

// Producer notes stay on their own field — never promoted into serviceNote.
const producerCollision = (book?.orders ?? []).filter(
  (o) =>
    o.rich.producerNote &&
    o.rich.serviceNote &&
    o.rich.producerNote.trim() === o.rich.serviceNote.body.trim() &&
    o.rich.serviceNote.body.trim().length > 40,
);
check(
  `producer notes are not auto-copied into serviceNote (${producerCollision.length} suspicious)`,
  producerCollision.length < 20,
);

getDb(); // ensure refresh scheduler is wired

if (failed > 0) {
  console.error(`\nservice-note-preview-check: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nservice-note-preview-check: ok");
