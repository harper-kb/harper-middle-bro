/**
 * Producer Note card anatomy — collapsed/expanded, author attribution, edit
 * permission, relative + exact timestamps.
 *
 * The card carries NO "Endorsement" field: `orders_temp` has no endorsement
 * association for a producer note, and notes whose text begins "Endorsement -"
 * are carrying that in the note body itself. A labelled field there would be
 * fabricated UI, so these checks assert it stays absent.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/producer-note-render-check.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { ProducerNoteCard } from "../src/app/all-accounts/ProducerNoteCard";
import {
  formatExactTimestamp,
  formatRelativeTime,
} from "../src/lib/relative-time";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

const now = Date.parse("2026-08-15T20:00:00.000Z");
const threeDaysAgo = "2026-08-12T18:30:00.000Z";
const oneHourAgo = "2026-08-15T19:00:00.000Z";
const justNow = "2026-08-15T19:59:30.000Z";

check(
  `relative: Just now (${formatRelativeTime(justNow, now)})`,
  formatRelativeTime(justNow, now) === "Just now",
);
check(
  `relative: 1 hour ago (${formatRelativeTime(oneHourAgo, now)})`,
  formatRelativeTime(oneHourAgo, now) === "1 hour ago",
);
check(
  `relative: 3 days ago (${formatRelativeTime(threeDaysAgo, now)})`,
  formatRelativeTime(threeDaysAgo, now) === "3 days ago",
);
check(
  "exact timestamp includes timezone",
  Boolean(formatExactTimestamp(threeDaysAgo)?.match(/PDT|PST|GMT|UTC/)),
);
check("null stamp → null relative", formatRelativeTime(null) === null);
check("null stamp → null exact", formatExactTimestamp(null) === null);

// The real order 12704 shape: a short note whose text IS "Endorsement -".
const endorsementBodyHtml = renderToStaticMarkup(
  <ProducerNoteCard
    note="Endorsement -"
    updatedAt={threeDaysAgo}
    authorName="Robert Kijak"
    canEdit={true}
    editHref="https://bigbrother.harperinsure.com/company/1/transaction?tab=orders"
  />,
);

check("title Producer Note", endorsementBodyHtml.includes("Producer Note"));
check("author Robert Kijak", endorsementBodyHtml.includes("Robert Kijak"));
check(
  "note body 'Endorsement -' rendered",
  endorsementBodyHtml.includes("Endorsement -"),
);
check(
  "no fabricated Endorsement field label",
  !/ENDORSEMENT|<dt/i.test(endorsementBodyHtml.replace("Endorsement -", "")),
);
check(
  "no 'None' empty state anywhere",
  !endorsementBodyHtml.includes("None"),
);
check(
  "no Unknown producer when author resolves",
  !endorsementBodyHtml.includes("Unknown producer"),
);
check("relative time rendered", endorsementBodyHtml.includes("days ago"));
check(
  "no Show more for short single-line note",
  !endorsementBodyHtml.includes("Show more"),
);
check(
  "Edit present when permitted",
  endorsementBodyHtml.includes("Edit producer note"),
);
check(
  "Edit is its own anchor, not the whole card",
  endorsementBodyHtml.includes('href="https://bigbrother.harperinsure.com'),
);
check(
  "time element carries datetime",
  endorsementBodyHtml.includes(`dateTime="${threeDaysAgo}"`) ||
    endorsementBodyHtml.includes(`datetime="${threeDaysAgo}"`),
);

const longAuthor = "Alexandria Maximiliana Featherstonehaugh-Worthington III";
const longBody = [
  "AI:",
  "",
  "Crawford County Fair Association, Crawford County, and Crawford County Commissioners as additional insured",
  "",
  "903 Diamond Street",
  "Meadville, PA 16335",
  "",
  "Please prioritize — high-value client. Subjectivities must clear before bind.",
].join("\n");

const longHtml = renderToStaticMarkup(
  <ProducerNoteCard
    note={longBody}
    updatedAt={oneHourAgo}
    authorName={longAuthor}
    canEdit={false}
    editHref={null}
  />,
);

check("long author rendered", longHtml.includes(longAuthor));
check("Show more for long/multiline", longHtml.includes("Show more"));
check("aria-expanded false when collapsed", longHtml.includes('aria-expanded="false"'));
check("aria-controls wired to panel", longHtml.includes("aria-controls="));
check("no Edit when read-only", !longHtml.includes("Edit producer note"));
check("collapsed preview omits later lines", !longHtml.includes("Please prioritize"));

const unknownHtml = renderToStaticMarkup(
  <ProducerNoteCard
    note="Bind effective August 14th."
    updatedAt={null}
    authorName={null}
    canEdit={false}
    editHref={null}
  />,
);
check(
  "missing author → Unknown producer",
  unknownHtml.includes("Unknown producer"),
);
check("no relative time without stamp", !unknownHtml.includes("ago"));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll producer-note render checks passed.");
