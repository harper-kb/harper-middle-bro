/**
 * Middle Bro Bot self-check — run with: npx tsx scripts/middle-bro-check.ts
 *
 * Exercises the desk-wide intent engine with a synthetic DeskWideBundle,
 * confirms the scoped Desk Brain path still answers as before, confirms both
 * refusals fire verbatim, and drives the memory module against a mocked
 * localStorage (add / dedupe / pin / cap / clear). Deterministic throughout.
 */

import {
  askDeskBrain,
  askDeskWide,
  DESK_BRAIN_REFUSAL,
  DESK_WIDE_REFUSAL,
  type DeskBrainBundle,
  type DeskWideBundle,
} from "../src/lib/desk-brain";
import { FORM_SETS } from "../src/lib/forms";

// ——— Mock localStorage BEFORE the memory module is exercised ———

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

import {
  BOT_MEMORY_CAP,
  clearBotRecent,
  loadBotMemory,
  rememberExchange,
  toggleBotPin,
} from "../src/lib/bot-memory";

// ——— Harness ———

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    console.log(`      ${detail}`);
  }
}

// ——— Fixture: synthetic desk-wide bundle ———

const deskBundle: DeskWideBundle = {
  ticketCounts: [
    { status: "intake", count: 1 },
    { status: "drafting", count: 0 },
    { status: "waiting_market", count: 2 },
    { status: "needs_you", count: 1 },
    { status: "ready_to_issue", count: 0 },
    { status: "delivered", count: 3 },
    { status: "closed", count: 5 },
  ],
  openTicketCount: 4,
  unclaimedOpenCount: 1,
  escalations: [
    {
      ticketId: "tkt-esc-1",
      srNumber: "SR-10031",
      toName: "Dana Whitfield",
      dueBy: "2026-08-07T23:59:00.000Z",
    },
  ],
  pendingIntake: [
    { channel: "email", count: 2 },
    { channel: "text", count: 0 },
    { channel: "call", count: 1 },
  ],
  operators: [
    { id: "op-1", name: "Dana Whitfield", openTickets: 3 },
    { id: "op-2", name: "Miles Archer", openTickets: 0 },
  ],
  accounts: [
    { id: "acct-1", name: "Greenleaf Landscaping LLC", status: "active" },
    { id: "acct-2", name: "Meridian Reach Studios", status: "pre_bind" },
    { id: "acct-3", name: "Oakridge Cabinetry", status: "cancelled" },
  ],
  changedToday: [
    {
      ticketId: "tkt-today-1",
      srNumber: "SR-10044",
      subject: "COI for landlord",
      status: "waiting_market",
    },
  ],
};

// ——— Desk-wide intents ———

// 1. Open-ticket counts with a Queue citation.
{
  const r = askDeskWide("How many tickets are open?", deskBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("4 tickets are open") &&
    r.answer.includes("2 Waiting On Market") &&
    r.answer.includes("1 Intake") &&
    r.answer.includes("1 of them is unclaimed") &&
    r.citations.some((c) => c.label === "Queue · 4 Open" && c.href === "/queue");
  check("Desk-wide open count answers 4 with Queue · 4 Open citation", ok, JSON.stringify(r));
}

// 2. Pending intake by channel.
{
  const r = askDeskWide("What's pending?", deskBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("3 communications are pending") &&
    r.answer.includes("2 Email") &&
    r.answer.includes("1 Call") &&
    !r.answer.includes("0 Text") &&
    r.citations.some((c) => c.href === "/pending");
  check("Desk-wide pending answers 3 (2 Email, 1 Call)", ok, JSON.stringify(r));
}

// 3. Operator load — top operator named, unclaimed pile disclosed.
{
  const r = askDeskWide("Who has the most open tickets?", deskBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Dana Whitfield has the most open tickets — 3") &&
    r.answer.includes("1 more sits unclaimed") &&
    r.citations.some((c) => c.label === "Dana Whitfield · 3 Open");
  check("Desk-wide operator load names Dana Whitfield (3)", ok, JSON.stringify(r));
}

// 4. Pre-bind accounts listed with account citations.
{
  const r = askDeskWide("Which accounts are pre-bind?", deskBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("Meridian Reach Studios") &&
    !r.answer.includes("Greenleaf") &&
    r.citations.some(
      (c) => c.label === "Meridian Reach Studios" && c.href === "/accounts/acct-2",
    );
  check("Desk-wide pre-bind lists Meridian Reach Studios only", ok, JSON.stringify(r));
}

// 5. Escalations with SR + owner + due date.
{
  const r = askDeskWide("Any escalations?", deskBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("SR-10031") &&
    r.answer.includes("Dana Whitfield") &&
    r.citations.some((c) => c.href === "/tickets/tkt-esc-1");
  check("Desk-wide escalations cites SR-10031", ok, JSON.stringify(r));
}

// 6. Changed today.
{
  const r = askDeskWide("What changed today?", deskBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("SR-10044") &&
    r.citations.some((c) => c.label === "Queue · 1 Updated Today");
  check("Desk-wide changed-today cites SR-10044", ok, JSON.stringify(r));
}

// 7. Out-of-scope refuses with the desk-wide refusal, verbatim.
{
  const r = askDeskWide("What's the weather in Tampa?", deskBundle);
  const ok = r.kind === "refusal" && r.answer === DESK_WIDE_REFUSAL;
  check("Desk-wide weather question refuses verbatim", ok, JSON.stringify(r));
}

// 8. Opinion / pricing guess refuses too.
{
  const r = askDeskWide("Should we discount waivers to win renewals?", deskBundle);
  const ok = r.kind === "refusal" && r.answer === DESK_WIDE_REFUSAL;
  check("Desk-wide opinion question refuses verbatim", ok, JSON.stringify(r));
}

// ——— Scoped path unchanged (Greenleaf, as desk-brain-check covers) ———

const scopedBundle: DeskBrainBundle = {
  account: {
    id: "acct-greenleaf",
    name: "Greenleaf Landscaping LLC",
    dba: null,
    industry: "Landscaping",
    state: "FL",
    status: "active",
    paymentReceivedAt: "2025-11-14T18:02:00.000Z",
    primaryUwName: "Coterie Service Desk",
    primaryUwCarrier: "Coterie",
    backupUwName: null,
  },
  policies: [
    {
      id: "pol-greenleaf-bop",
      policyNumber: "COT-BOP-331450",
      carrier: "Coterie",
      coverages: ["BOP", "GL"],
      effectiveDate: "2025-11-15",
      expirationDate: "2026-11-15",
      premiumCents: 1_680_00,
    },
  ],
  formSets: { "pol-greenleaf-bop": FORM_SETS["pol-greenleaf-bop"] },
  ticket: null,
  threads: [],
  decisions: [],
  quoteSamples: [],
};

// 9. Scoped blanket AI intent still cites the form.
{
  const r = askDeskBrain("Do they have blanket AI?", scopedBundle);
  const ok =
    r.kind === "answer" &&
    r.answer.includes("BP 04 48 07 13") &&
    r.citations.some((c) => c.label === "BP 04 48 07 13");
  check("Scoped blanket AI still cites BP 04 48 07 13", ok, JSON.stringify(r));
}

// 10. Scoped out-of-scope still refuses with the account refusal, verbatim.
{
  const r = askDeskBrain("Who won the World Cup in 2022?", scopedBundle);
  const ok = r.kind === "refusal" && r.answer === DESK_BRAIN_REFUSAL;
  check("Scoped general knowledge refuses verbatim", ok, JSON.stringify(r));
}

// ——— Memory module (mocked localStorage) ———

const OP = "op-check";

// 11. Remember + load round-trip.
{
  const after = rememberExchange(OP, {
    question: "How Many Tickets Are Open?",
    answer: "4 tickets are open on the desk.",
    kind: "answer",
    scopeKind: "desk",
    scopeLabel: "Desk-Wide",
    scopeQuery: "",
    askedAt: "2026-08-07T10:00:00.000Z",
  });
  const loaded = loadBotMemory(OP);
  const ok =
    after.length === 1 &&
    loaded.length === 1 &&
    loaded[0].question === "How Many Tickets Are Open?" &&
    loaded[0].pinned === false;
  check("Memory remembers and round-trips one exchange", ok, JSON.stringify(loaded));
}

// 12. Re-asking the same question dedupes instead of duplicating.
{
  const after = rememberExchange(OP, {
    question: "How Many Tickets Are Open?",
    answer: "4 tickets are open on the desk.",
    kind: "answer",
    scopeKind: "desk",
    scopeLabel: "Desk-Wide",
    scopeQuery: "",
    askedAt: "2026-08-07T10:05:00.000Z",
  });
  const ok = after.length === 1 && after[0].askedAt === "2026-08-07T10:05:00.000Z";
  check("Memory dedupes a re-asked question", ok, JSON.stringify(after));
}

// 13. Pin, then flood past the cap — pinned survives, unpinned caps at 50.
{
  const pinnedList = toggleBotPin(OP, loadBotMemory(OP)[0].id);
  const pinnedId = pinnedList[0].id;
  for (let i = 0; i < BOT_MEMORY_CAP + 10; i++) {
    rememberExchange(OP, {
      question: `Filler question ${i}?`,
      answer: `Filler answer ${i}.`,
      kind: "answer",
      scopeKind: "desk",
      scopeLabel: "Desk-Wide",
      scopeQuery: "",
      askedAt: `2026-08-07T11:${String(i % 60).padStart(2, "0")}:00.000Z`,
    });
  }
  const loaded = loadBotMemory(OP);
  const unpinned = loaded.filter((e) => !e.pinned);
  const ok =
    unpinned.length === BOT_MEMORY_CAP &&
    loaded.some((e) => e.id === pinnedId && e.pinned) &&
    loaded.length === BOT_MEMORY_CAP + 1;
  check(
    `Memory caps unpinned at ${BOT_MEMORY_CAP} and keeps the pin`,
    ok,
    `total=${loaded.length} unpinned=${unpinned.length} pinKept=${loaded.some((e) => e.id === pinnedId && e.pinned)}`,
  );
}

// 14. Clear Recent keeps only pinned.
{
  const after = clearBotRecent(OP);
  const ok = after.length === 1 && after[0].pinned;
  check("Clear Recent keeps only the pinned entry", ok, JSON.stringify(after));
}

// 15. Memory is keyed per operator — another seat sees nothing.
{
  const other = loadBotMemory("op-someone-else");
  check("Memory is keyed per operator", other.length === 0, JSON.stringify(other));
}

console.log(
  failures === 0
    ? "\nAll Middle Bro checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
