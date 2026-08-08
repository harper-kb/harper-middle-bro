/**
 * Service-loop self-check — run with:
 *   npx tsx --conditions react-server scripts/service-loop-check.ts
 *
 * Walks the core service loop end to end against the local database using
 * the same library calls the server actions make, and asserts every step
 * writes its trace rows:
 *
 *   1. Price guidance — a request type with real desk history is quotable
 *      (three or more samples), one without history refuses a number.
 *   2. Create ticket — intake row, Service Request number, title.
 *   3. Draft + verification gates — the pre-send draft matches the
 *      underwriter, and a fabricated quote-carrier mismatch blocks.
 *   4. Send — thread + outbound message + "send" decision trace;
 *      ticket derives Waiting On Market.
 *   5. Simulated underwriter replies at three premiums:
 *      $0 (certificate is ours to produce), $120 (inside the auto-approve
 *      authority), $750 (over authority — parked for a human).
 *   6. Over-authority path: human proceed → client terms relay → payment
 *      cleared → Ready To Issue, each with its decision trace.
 *   7. Certificate outcome — issuing closes the loop and delivers the ticket.
 *   8. Blanket fast path — Ready To Issue with the form cited, no thread.
 *   9. Escalation — flag to the manager, appears in the help inbox, resolves.
 *  10. Pending triage — the intake board lists pending comms.
 *
 * Cleans up after itself: every row it created is deleted at the end, so
 * the walk is repeatable and leaves the book exactly as it found it.
 */

import path from "node:path";
import Database from "better-sqlite3";
import {
  createAndSendThread,
  createTicket,
  applyBlanketFastPath,
  escalateTicket,
  getTicketDetail,
  getAccountDetail,
  humanProceed,
  listDecisions,
  listEscalatedTickets,
  listIntakeEvents,
  listQuoteSamples,
  listUnderwriters,
  recordClientTerms,
  recordCoiDecision,
  recordPaymentCleared,
  resolveEscalation,
  simulateUwQuote,
} from "../src/lib/db";
import { buildTicketDraft } from "../src/lib/draft";
import { evaluateBlanketFastPath } from "../src/lib/fast-path";
import { getPolicyFormSet } from "../src/lib/forms";
import { getRequestType } from "../src/lib/catalog";
import {
  getGuidance,
  guidanceIsQuotable,
  summarizeQuotes,
} from "../src/lib/price-guidance";
import { verifyBeforeSend } from "../src/lib/verify";
import { AUTO_APPROVE_THRESHOLD_CENTS } from "../src/lib/types";

const OPERATOR_ID = "op-dakotah";
const ACCOUNT_ID = "acct-apex";
const POLICY_ID = "pol-apex-gl";
const FAST_ACCOUNT_ID = "acct-summit";
const FAST_POLICY_ID = "pol-summit-gl";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const createdTicketIds: string[] = [];
const createdThreadIds: string[] = [];

function newTicket(requestType: "additional_insured" | "waiver_of_subrogation", holder: string) {
  const t = createTicket({
    accountId: ACCOUNT_ID,
    policyIds: [POLICY_ID],
    requestType,
    source: "producer",
    requestedBy: "Service Loop Check",
    subject: "",
    holderName: holder,
    wording: "Ongoing operations per written contract.",
    operatorId: OPERATOR_ID,
  });
  createdTicketIds.push(t.id);
  return t;
}

// ——— 1. Price guidance ———
{
  const guidance = summarizeQuotes(listQuoteSamples());
  const isc = getGuidance(guidance, "ISC", "notice_cancellation_30");
  check(
    "Price guidance quotable for ISC 30-day notice (3+ real quotes)",
    guidanceIsQuotable(isc),
    `sampleCount=${isc?.sampleCount ?? 0}`,
  );
  const none = getGuidance(guidance, "Kinsale", "named_insured_correction");
  check(
    "Price guidance refuses without history",
    !guidanceIsQuotable(none),
    `unexpected guidance: ${JSON.stringify(none)}`,
  );
}

// ——— 2. Create ticket ———
const ticket = newTicket("additional_insured", "Oakline GC Partners");
{
  check("Ticket files at intake", ticket.status === "intake", ticket.status);
  check(
    "Ticket carries a Service Request number",
    /^SR-\d+$/.test(ticket.srNumber ?? ""),
    ticket.srNumber ?? "(none)",
  );
  check(
    "Ticket title cites the holder",
    ticket.title.includes("Oakline GC Partners"),
    ticket.title,
  );
}

// ——— 3. Draft + verification gates ———
{
  const account = getAccountDetail(ACCOUNT_ID)!;
  const policy = account.policies.find((p) => p.id === POLICY_ID)!;
  const draft = buildTicketDraft({
    ticket,
    account,
    policy,
    carrierDesks: listUnderwriters(),
    operator: null,
  });
  check("Draft matches the Kinsale underwriter", draft.underwriter?.carrier === "Kinsale");
  check("Draft is clear to send", !draft.blocked, JSON.stringify(draft.verify.issues));
  check(
    "Draft subject carries the policy number",
    draft.subject.includes(policy.policyNumber),
    draft.subject,
  );

  const tampered = verifyBeforeSend({
    account,
    policy: { ...policy, quoteCarrier: "Hiscox" },
    requestType: "additional_insured",
    carrierDesks: listUnderwriters(),
  });
  check(
    "Verification blocks a quote-carrier mismatch",
    !tampered.okToSend &&
      tampered.issues.some((i) => i.id === "quote-carrier-mismatch" && i.severity === "block"),
    JSON.stringify(tampered.issues),
  );
}

// ——— 4. Send ———
const thread = createAndSendThread({
  accountId: ACCOUNT_ID,
  policyId: POLICY_ID,
  requestType: "additional_insured",
  details: "Please add Oakline GC Partners as additional insured.",
  operatorId: OPERATOR_ID,
  ticketId: ticket.id,
});
createdThreadIds.push(thread.id);
{
  check("Thread opens waiting on the underwriter", thread.status === "waiting_uw", thread.status);
  check(
    "Outbound message recorded",
    thread.messages.length === 1 && thread.messages[0].direction === "outbound",
    `${thread.messages.length} messages`,
  );
  const decisions = listDecisions({ ticketId: ticket.id });
  check(
    "Send writes its decision trace",
    decisions.some((d) => d.kind === "send" && d.threadId === thread.id),
    decisions.map((d) => d.kind).join(","),
  );
  check(
    "Ticket derives Waiting On Market",
    getTicketDetail(ticket.id)!.status === "waiting_market",
    getTicketDetail(ticket.id)!.status,
  );
}

// ——— 5a. $0 answer — certificate is ours to produce ———
{
  const t = simulateUwQuote(thread.id, 0);
  check("No-charge reply records the premium", t.offeredPremiumCents === 0);
  const decisions = listDecisions({ ticketId: ticket.id });
  check(
    "Reply writes its decision trace",
    decisions.some((d) => d.kind === "reply"),
    decisions.map((d) => d.kind).join(","),
  );
  check(
    "No-charge answer opens the certificate gate (Ready To Issue)",
    getTicketDetail(ticket.id)!.status === "ready_to_issue",
    getTicketDetail(ticket.id)!.status,
  );
  const issued = recordCoiDecision({
    threadId: thread.id,
    decision: "issued",
    summary: "Verified against the policy coverage tab — service loop check.",
  });
  check("Issuing closes the thread", issued.status === "closed", issued.status);
  check(
    "Issuing delivers the ticket",
    getTicketDetail(ticket.id)!.status === "delivered",
    getTicketDetail(ticket.id)!.status,
  );
  check(
    "Certificate decision trace written",
    listDecisions({ ticketId: ticket.id }).some((d) => d.kind === "certificate"),
  );
}

// ——— 5b. $120 answer — inside the auto-approve authority ———
{
  const t2 = newTicket("additional_insured", "Bridgestone Property Trust");
  const th2 = createAndSendThread({
    accountId: ACCOUNT_ID,
    policyId: POLICY_ID,
    requestType: "additional_insured",
    details: "Please add Bridgestone Property Trust as additional insured.",
    operatorId: OPERATOR_ID,
    ticketId: t2.id,
  });
  createdThreadIds.push(th2.id);
  const quoted = simulateUwQuote(th2.id, 12000);
  check(
    "$120 quote auto-approves inside the $500 authority",
    quoted.status === "auto_approved" && quoted.autoApproved,
    quoted.status,
  );
  check(
    "Auto-approved ticket derives Ready To Issue",
    getTicketDetail(t2.id)!.status === "ready_to_issue",
    getTicketDetail(t2.id)!.status,
  );
}

// ——— 5c–6. $750 answer — over authority, human path ———
{
  const t3 = newTicket("additional_insured", "Crestview Municipal Authority");
  const th3 = createAndSendThread({
    accountId: ACCOUNT_ID,
    policyId: POLICY_ID,
    requestType: "additional_insured",
    details: "Please add Crestview Municipal Authority as additional insured.",
    operatorId: OPERATOR_ID,
    ticketId: t3.id,
  });
  createdThreadIds.push(th3.id);
  const quoted = simulateUwQuote(th3.id, 75000);
  check(
    "$750 quote parks for a human (over authority)",
    quoted.status === "needs_human" && !quoted.autoApproved,
    quoted.status,
  );
  check(
    "Over-authority ticket derives Needs You",
    getTicketDetail(t3.id)!.status === "needs_you",
    getTicketDetail(t3.id)!.status,
  );
  check(
    "Threshold constant is $500",
    AUTO_APPROVE_THRESHOLD_CENTS === 50000,
    String(AUTO_APPROVE_THRESHOLD_CENTS),
  );

  const proceeded = humanProceed(th3.id);
  check("Human proceed closes the market thread", proceeded.status === "closed");
  check(
    "Human approval writes its decision trace",
    listDecisions({ ticketId: t3.id }).some((d) => d.kind === "approval" && d.author === "operator"),
  );

  const terms = recordClientTerms({
    threadId: th3.id,
    body: "The market quoted $750.00 for this endorsement — reply to approve and we will send a payment link.",
    paymentReference: "PAY-CHECK-001",
  });
  check("Client terms park the thread on the insured", terms.status === "price_offered", terms.status);
  check(
    "Client relay writes its decision trace",
    listDecisions({ ticketId: t3.id }).some((d) => d.kind === "client_terms"),
  );

  recordPaymentCleared(th3.id);
  check(
    "Cleared payment advances the ticket to Ready To Issue",
    getTicketDetail(t3.id)!.status === "ready_to_issue",
    getTicketDetail(t3.id)!.status,
  );

  // ——— 9. Escalation on the same ticket ———
  escalateTicket({
    ticketId: t3.id,
    toOperatorId: "op-morgan",
    note: "Service loop check — needs manager eyes.",
  });
  const inbox = listEscalatedTickets("op-morgan");
  check(
    "Escalation lands in the manager's help inbox with a due-by",
    inbox.some((x) => x.id === t3.id && x.escalationDueBy != null),
    `${inbox.length} open escalations`,
  );
  resolveEscalation(t3.id);
  check(
    "Resolving clears the escalation",
    !listEscalatedTickets("op-morgan").some((x) => x.id === t3.id),
  );
}

// ——— 8. Blanket fast path (Summit, ISC blanket AI on file) ———
{
  const account = getAccountDetail(FAST_ACCOUNT_ID)!;
  const policy = account.policies.find((p) => p.id === FAST_POLICY_ID)!;
  const decision = evaluateBlanketFastPath({
    requestType: "additional_insured",
    wording: "Certificate holder accepts blanket wording.",
    namedOnPolicyRequired: false,
    policies: [{ policy, formSet: getPolicyFormSet(policy) }],
    account: { state: account.state, industry: account.industry },
  });
  check("Blanket fast path eligible on the Summit ISC policy", decision.eligible);
  if (decision.eligible) {
    const ft = createTicket({
      accountId: FAST_ACCOUNT_ID,
      policyIds: [FAST_POLICY_ID],
      requestType: "additional_insured",
      source: "producer",
      requestedBy: "Service Loop Check",
      subject: "",
      holderName: "Lakeshore Development LLC",
      wording: "Certificate holder accepts blanket wording.",
      operatorId: OPERATOR_ID,
    });
    createdTicketIds.push(ft.id);
    const applied = applyBlanketFastPath(ft.id, {
      basis: decision.basis,
      form: decision.form,
      policyNumber: decision.policy.policyNumber,
      requestLabel: getRequestType("additional_insured").label,
    });
    check(
      "Fast path goes straight to Ready To Issue with the form cited",
      applied.status === "ready_to_issue" &&
        (applied.fastPathBasis ?? "").includes(decision.form.form),
      `${applied.status} · ${applied.fastPathBasis}`,
    );
    check(
      "Fast path writes its certificate decision trace",
      listDecisions({ ticketId: ft.id }).some(
        (d) => d.kind === "certificate" && d.headline.includes("Blanket Fast Path"),
      ),
    );
    check("Fast path opens no market thread", getTicketDetail(ft.id)!.threads.length === 0);
  }
}

// ——— 10. Pending triage board ———
{
  const pending = listIntakeEvents("pending");
  check(
    "Pending intake board lists raw comms for triage",
    pending.length > 0,
    `${pending.length} pending`,
  );
  const channels = new Set(pending.map((e) => e.channel));
  check(
    "Pending events carry known channels",
    [...channels].every((c) => ["email", "text", "call"].includes(c)),
    [...channels].join(","),
  );
}

// ——— Cleanup: remove every row this walk created ———
{
  const db = new Database(path.join(process.cwd(), "data", "underwriter-desk.db"));
  const tickets = createdTicketIds;
  const threads = createdThreadIds;
  const inTickets = tickets.map(() => "?").join(",");
  const inThreads = threads.map(() => "?").join(",");
  const tx = db.transaction(() => {
    if (threads.length) {
      db.prepare(`DELETE FROM messages WHERE thread_id IN (${inThreads})`).run(...threads);
      db.prepare(`DELETE FROM threads WHERE id IN (${inThreads})`).run(...threads);
    }
    if (tickets.length) {
      db.prepare(`DELETE FROM decisions WHERE ticket_id IN (${inTickets})`).run(...tickets);
      db.prepare(`DELETE FROM additional_insureds WHERE ticket_id IN (${inTickets})`).run(...tickets);
      db.prepare(`DELETE FROM ticket_policies WHERE ticket_id IN (${inTickets})`).run(...tickets);
      db.prepare(`DELETE FROM tickets WHERE id IN (${inTickets})`).run(...tickets);
    }
  });
  tx();
  const leftoverTickets = tickets.length
    ? (db.prepare(`SELECT count(*) AS n FROM tickets WHERE id IN (${inTickets})`).get(...tickets) as { n: number }).n
    : 0;
  db.close();
  check("Cleanup removed every created row", leftoverTickets === 0, `${leftoverTickets} left`);
}

console.log(failures === 0 ? "\nAll service-loop checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
