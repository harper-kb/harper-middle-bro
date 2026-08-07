/**
 * Intake matching engine self-check — run with: npx tsx scripts/intake-match-check.ts
 *
 * Pure fixtures mirroring src/lib/intake-seed.ts (no db). Fixed `now`, so
 * every run is the same run. Exit 1 on any FAIL.
 */

import {
  MERGE_CONFIDENCE_FLOOR,
  priorityOrder,
  priorityScore,
  scoreIntakeAgainstTickets,
  scorePendingPair,
  type TicketLike,
} from "../src/lib/intake-match";
import type { IntakeEvent } from "../src/lib/types";

const NOW = "2026-08-07T10:00:00.000Z";

function minutesAgo(mins: number): string {
  return new Date(Date.parse(NOW) - mins * 60_000).toISOString();
}

function event(partial: Partial<IntakeEvent> & Pick<IntakeEvent, "id" | "body">): IntakeEvent {
  return {
    channel: "email",
    fromName: "Someone",
    fromContact: "someone@example.com",
    accountId: null,
    receivedAt: minutesAgo(10),
    subject: null,
    callMissed: null,
    callDurationSec: null,
    status: "pending",
    ticketId: null,
    ackSentAt: null,
    ackBody: null,
    ...partial,
  };
}

// ——— Fixtures mirroring intake-seed.ts ———

const greenleaf1 = event({
  id: "in-greenleaf-hoa-1",
  fromName: "Priya Patel",
  fromContact: "office@greenleaflandscape.com",
  accountId: "acct-greenleaf",
  receivedAt: minutesAgo(25),
  subject: "COI for Palm Court HOA — clubhouse contract",
  body: "Hi team — Palm Court HOA needs a certificate for our new clubhouse maintenance contract. They just need to be listed as certificate holder with the usual additional insured wording. Contract starts Monday. Thanks! — Priya",
});

const greenleaf2 = event({
  id: "in-greenleaf-hoa-2",
  fromName: "Priya Patel",
  fromContact: "office@greenleaflandscape.com",
  accountId: "acct-greenleaf",
  receivedAt: minutesAgo(5),
  subject: "Re: COI for Palm Court HOA — clubhouse contract",
  body: "Following up on my email from earlier — same request, Palm Court HOA certificate for the clubhouse contract. Just making sure it didn't get buried. — Priya",
});

const summitNamed = event({
  id: "in-summit-gc-named",
  fromName: "Dan Kowalski",
  fromContact: "dan@summitdrywall.com",
  accountId: "acct-summit",
  receivedAt: minutesAgo(120),
  subject: "GC requires named additional insured — Hartline Builders",
  body: "Our new GC, Hartline Builders LLC, reviewed the cert and says blanket wording is not enough — their contract requires being specifically named on the policy by endorsement. Can you get that going with the carrier? Job starts in two weeks.",
});

const newsletter = event({
  id: "in-vendor-newsletter",
  fromName: "InsurTech Weekly",
  fromContact: "newsletter@insurtechweekly.example",
  accountId: null,
  receivedAt: minutesAgo(65),
  subject: "5 Trends Reshaping Commercial Lines In 2026",
  body: "You're receiving this because you subscribed to InsurTech Weekly. This week: embedded insurance, AI triage desks, and the death of the fax machine…",
});

const missedCall = event({
  id: "in-unknown-foodtruck-call",
  channel: "call",
  fromName: "Unknown Caller",
  fromContact: "+1 707 555 0912",
  accountId: null,
  receivedAt: minutesAgo(50),
  subject: "Voicemail — new business inquiry",
  body: "Transcript (voicemail): Hi, I got your number from a friend — I run a food truck in Santa Rosa and need a quote for liability insurance, maybe the whole package. Name's Marco. Call me back at this number.",
  callMissed: true,
});

const harborStale = event({
  id: "in-harbor-landlord-email",
  fromName: "Bayview Property Partners",
  fromContact: "leasing@bayviewpp.com",
  accountId: "acct-harbor",
  receivedAt: minutesAgo(60 * 24 * 4),
  subject: "Insurance requirement — Suite 210 lease renewal",
  body: "Per the renewal for Suite 210, please provide an updated certificate naming Bayview Property Partners LP as additional insured (managers or lessors of premises) and certificate holder. The prior cert expires with the lease term.",
});

const freshText = event({
  id: "in-pixel-client-text",
  channel: "text",
  fromName: "Jae Park",
  fromContact: "+1 628 555 0233",
  accountId: "acct-pixel",
  receivedAt: minutesAgo(30),
  body: "Can you send our E&O cert to our new client Brightwave Media? Their vendor portal needs it before they issue the SOW. Email is vendors@brightwavemedia.com",
});

/** Routine email the same age as the missed call — for the boost check. */
const routineEmail = event({
  id: "in-routine-email-50",
  fromName: "Casey Ortiz",
  fromContact: "casey@example.com",
  accountId: "acct-apex",
  receivedAt: minutesAgo(50),
  subject: "Quick question about our policy",
  body: "Just wondering when the renewal paperwork goes out this year.",
});

// ——— Ticket fixtures ———

/** What in-greenleaf-hoa-1 becomes after an operator confirms it. */
const greenleafTicket: TicketLike = {
  id: "tkt-greenleaf-palm-court",
  srNumber: "SR-10021",
  accountId: "acct-greenleaf",
  title: "COI for Palm Court HOA — clubhouse contract",
  subject: "COI for Palm Court HOA — clubhouse contract",
  requestType: "additional_insured",
  requestTypeLabel: "Additional Insured",
  holderName: "Palm Court HOA",
  requestedBy: "Priya Patel",
  requestedByEmail: "office@greenleaflandscape.com",
  createdAt: minutesAgo(20),
};

/** Open Summit ticket about something else entirely. */
const summitUnrelatedTicket: TicketLike = {
  id: "tkt-summit-invoice",
  srNumber: "SR-10014",
  accountId: "acct-summit",
  title: "Invoice question — installment schedule",
  subject: "Invoice question — installment schedule",
  requestType: "premium_finance",
  requestTypeLabel: "Premium / Invoice / Finance",
  holderName: null,
  requestedBy: "Summit Accounting",
  requestedByEmail: "accounting@summitdrywall.com",
  createdAt: minutesAgo(60 * 72),
};

/** A cert ticket that would look tempting — the account gate must still win. */
const someCertTicket: TicketLike = {
  id: "tkt-someone-cert",
  srNumber: "SR-10030",
  accountId: "acct-someone",
  title: "Certificate for commercial lines package",
  subject: "Certificate request",
  requestType: "additional_insured",
  requestTypeLabel: "Additional Insured",
  holderName: null,
  requestedBy: "Someone",
  requestedByEmail: "newsletter@insurtechweekly.example",
  createdAt: minutesAgo(30),
};

// ——— Assertions ———

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// (a) Greenleaf pair: high-confidence duplicates of each other, same-sender reason present.
const pair = scorePendingPair(greenleaf1, greenleaf2, NOW);
check(
  "(a) Greenleaf pair scores at/above the merge floor",
  pair.kind === "pair" && pair.confidence >= MERGE_CONFIDENCE_FLOOR,
  pair.kind === "pair"
    ? `confidence ${pct(pair.confidence)} vs floor ${pct(MERGE_CONFIDENCE_FLOOR)}`
    : "no pair returned",
);
check(
  "(a) Greenleaf pair recommendation is merge with a same-sender reason",
  pair.kind === "pair" &&
    pair.recommendation === "merge" &&
    pair.reasons.some((r) => r.startsWith("Same Sender")),
  pair.kind === "pair" ? `reasons: ${pair.reasons.join(" | ")}` : "no pair returned",
);

// (a-bis) Once the older Greenleaf email is a ticket, the newer one one-click merges into it.
const followUp = scoreIntakeAgainstTickets(greenleaf2, [greenleafTicket], NOW);
check(
  "(a) Greenleaf follow-up vs the older one's ticket → merge into SR-10021",
  followUp.kind === "ticket" &&
    followUp.recommendation === "merge" &&
    followUp.srNumber === "SR-10021" &&
    followUp.reasons.some((r) => r.startsWith("Same Sender")),
  followUp.kind === "ticket"
    ? `${followUp.recommendation} at ${pct(followUp.confidence)} — ${followUp.reasons.join(" | ")}`
    : "no match returned",
);

// (b) Summit must-be-named AI request vs an unrelated open ticket → new, never merge.
const summitMatch = scoreIntakeAgainstTickets(summitNamed, [summitUnrelatedTicket], NOW);
check(
  "(b) Summit named-AI event vs unrelated ticket → recommendation new",
  summitMatch.kind === "none" && summitMatch.recommendation === "new",
  summitMatch.kind === "ticket"
    ? `unexpected ${summitMatch.recommendation} at ${pct(summitMatch.confidence)}`
    : undefined,
);

// (c) 4-day-old email ranks below a 30-minute-old item but is still present.
const ordered = priorityOrder([harborStale, freshText], NOW);
check(
  "(c) 30-min item outranks the 4-day item in priorityOrder",
  ordered[0]?.id === freshText.id && ordered[1]?.id === harborStale.id,
  `order: ${ordered.map((e) => e.id).join(", ")}`,
);
check(
  "(c) 4-day item is still present — old never means gone",
  ordered.some((e) => e.id === harborStale.id),
);

// (d) Missed call outranks a routine email of the same age.
const callVsEmail = priorityOrder([routineEmail, missedCall], NOW);
check(
  "(d) Missed call outranks a same-age routine email",
  callVsEmail[0]?.id === missedCall.id,
  `scores: call ${priorityScore(missedCall, NOW).toFixed(3)}, email ${priorityScore(routineEmail, NOW).toFixed(3)}`,
);

// (e) No account, no match — ever. Even against a tempting cert ticket.
const noAccount = scoreIntakeAgainstTickets(newsletter, [someCertTicket], NOW);
check(
  '(e) No-account event can never return kind "ticket"',
  noAccount.kind === "none" && noAccount.recommendation === "new",
);

// ——— Verdict ———

console.log(
  failures === 0
    ? "\nAll checks passed."
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
