/**
 * Deterministic self-check for src/lib/day-story.ts — synthetic events only,
 * no db. Run: npx tsx scripts/day-story-check.ts
 */
import {
  bucketize,
  buildChapters,
  buildDayStory,
  type DayEvent,
} from "../src/lib/day-story";

let failures = 0;

function check(name: string, ok: boolean, note?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && note ? ` — ${note}` : ""}`);
  if (!ok) failures += 1;
}

/** Local-time ISO for today's date at h:m — keeps the checks TZ-stable. */
function at(h: number, m: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).toISOString();
}

function ev(h: number, m: number, kind: DayEvent["kind"] = "message_sent"): DayEvent {
  return { at: at(h, m), kind, headline: `synthetic ${kind} at ${h}:${m}` };
}

const NOW = at(14, 0);

// ————— bucketize: 60-minute buckets —————
{
  const events = [ev(9, 5), ev(9, 40), ev(13, 10, "ticket_closed")];
  const buckets = bucketize(events, 60, NOW);
  // Span starts at 8 AM (events exist, none earlier) through now (2 PM) → 7 buckets.
  check("60m: span 8 AM → 2 PM is 7 buckets", buckets.length === 7, `got ${buckets.length}`);
  check("60m: 8 AM bucket empty", buckets[0]?.count === 0);
  check("60m: 9 AM bucket holds both 9:05 and 9:40", buckets[1]?.count === 2);
  check("60m: 1 PM bucket holds the close", buckets[5]?.count === 1);
  check("60m: closedCount lands in 1 PM bucket", buckets[5]?.closedCount === 1);
  check(
    "60m: closedCount zero elsewhere",
    buckets.every((b, i) => (i === 5 ? true : b.closedCount === 0)),
  );
}

// ————— bucketize: 20-minute buckets —————
{
  const events = [ev(9, 5), ev(9, 40), ev(13, 10, "ticket_closed")];
  const buckets = bucketize(events, 20, NOW);
  // 8:00 → 14:00 inclusive at 20m = 19 buckets.
  check("20m: span is 19 buckets", buckets.length === 19, `got ${buckets.length}`);
  const idx905 = 3; // 9:00–9:20
  const idx940 = 5; // 9:40–10:00
  const idx1310 = 15; // 13:00–13:20
  check("20m: 9:05 lands in 9:00 bucket", buckets[idx905]?.count === 1);
  check("20m: 9:40 lands in 9:40 bucket", buckets[idx940]?.count === 1);
  check("20m: close lands in 1:00 PM bucket", buckets[idx1310]?.closedCount === 1);
}

// ————— bucketize: 10-minute buckets —————
{
  const events = [ev(9, 5), ev(9, 40), ev(13, 10, "ticket_closed")];
  const buckets = bucketize(events, 10, NOW);
  // 8:00 → 14:00 inclusive at 10m = 37 buckets.
  check("10m: span is 37 buckets", buckets.length === 37, `got ${buckets.length}`);
  check("10m: 9:05 lands in 9:00 bucket", buckets[6]?.count === 1);
  check("10m: 9:40 lands in 9:40 bucket", buckets[10]?.count === 1);
  check("10m: close lands in 1:10 PM bucket", buckets[31]?.closedCount === 1);
}

// ————— bucketize: first event before 8 AM widens the span —————
{
  const buckets = bucketize([ev(6, 45)], 60, NOW);
  check("60m: 6:45 AM event pulls span back to 6 AM", buckets.length === 9, `got ${buckets.length}`);
  check("60m: pre-8 event counted", buckets[0]?.count === 1);
}

// ————— bucketize: no events —————
{
  check("bucketize: empty input → empty array", bucketize([], 60, NOW).length === 0);
}

// ————— chapters split around noon and 5 PM —————
{
  const chapters = buildChapters([ev(11, 59), ev(12, 0), ev(16, 59), ev(17, 0)]);
  check("chapters: three chapters present", chapters.length === 3);
  check("chapters: 11:59 is Morning", chapters[0]?.title === "Morning" && chapters[0]?.events.length === 1);
  check(
    "chapters: 12:00 and 4:59 are Afternoon",
    chapters[1]?.title === "Afternoon" && chapters[1]?.events.length === 2,
  );
  check("chapters: 5:00 PM is Evening", chapters[2]?.title === "Evening" && chapters[2]?.events.length === 1);
}

{
  const chapters = buildChapters([ev(9, 30)]);
  check("chapters: morning-only day yields one chapter", chapters.length === 1 && chapters[0].id === "morning");
}

// ————— empty day is honest —————
{
  const story = buildDayStory({
    tickets: [],
    threads: [],
    decisions: [],
    openTicketCount: 4,
    now: NOW,
  });
  check("empty: no chapters", story.chapters.length === 0);
  check("empty: no events", story.events.length === 0);
  check(
    "empty: summary says no activity recorded",
    story.summary.startsWith("No activity recorded yet today."),
    story.summary,
  );
  check("empty: summary points at open work", story.summary.includes("4 open tickets"), story.summary);
}

// ————— closed ticket produces a "Closed" headline with the SR —————
{
  const story = buildDayStory({
    tickets: [
      {
        id: "tk-1",
        srNumber: "SR-10012",
        requestTypeLabel: "Additional Insured",
        accountName: "Greenleaf Landscape",
        createdAt: at(9, 12),
        closedAt: at(10, 45),
        fastPathBasis: "CG 20 33 blanket AI applies",
      },
    ],
    threads: [],
    decisions: [],
    openTicketCount: 0,
    now: NOW,
  });
  const close = story.events.find((e) => e.kind === "fast_path");
  check("close: fast-path close event exists", close != null);
  check(
    "close: headline reads Closed + SR",
    close != null && close.headline.startsWith("Closed") && close.headline.includes("SR-10012"),
    close?.headline,
  );
  check(
    "close: fast path is called out",
    close?.headline.includes("(Fast Path, No Market Contact)") === true,
    close?.headline,
  );
  check(
    "close: open event recorded too",
    story.events.some((e) => e.kind === "ticket_opened" && e.headline.includes("SR-10012")),
  );
  check("close: summary counts the close", story.summary.includes("closed 1 ticket"), story.summary);
}

// ————— messages become sent/heard events; yesterday's are excluded —————
{
  const yesterday = new Date(new Date(NOW).getTime() - 24 * 3600_000).toISOString();
  const story = buildDayStory({
    tickets: [],
    threads: [
      {
        ticketId: "tk-7",
        carrier: "Hartford Wholesale",
        accountName: "Greenleaf Landscape",
        messages: [
          { createdAt: yesterday, direction: "outbound", party: "underwriter", subject: "Original ask" },
          { createdAt: at(9, 20), direction: "outbound", party: "underwriter", subject: "Nudge" },
          { createdAt: at(11, 5), direction: "inbound", party: "underwriter", subject: "RE: Nudge" },
        ],
      },
    ],
    decisions: [],
    srNumbersByTicketId: { "tk-7": "SR-10007" },
    openTicketCount: 1,
    now: NOW,
  });
  check("messages: only today's two messages become events", story.events.length === 2, `got ${story.events.length}`);
  check(
    "messages: prior outbound makes today's a follow-up",
    story.events[0]?.headline === "Followed up with Hartford Wholesale on SR-10007",
    story.events[0]?.headline,
  );
  check(
    "messages: inbound reads as heard back",
    story.events[1]?.headline === "Heard back from Hartford Wholesale on SR-10007",
    story.events[1]?.headline,
  );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
