import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  buildHumanHoldReply,
  buildProceedReply,
  canAutoApprove,
} from "../../threads/agent";
import { SERVICE_MAILBOX } from "../../brand";
import { coverageLabels, getRequestType } from "../../catalog";
import { channelLabel, resolveChannel } from "../../threads/channels";
import { endOfLocalDayIso, startOfLocalDayIso } from "../../dates";
import type { ModelCall } from "../../model";
import {
  loadPolicyFormSetFromDb,
  upsertAdditionalInsured,
  type AdditionalInsuredRecord,
} from "../../carriers/policy-intelligence";
import type { QuoteSample } from "../../certificates/price-guidance";
import {
  renderEmailBody,
  type EmailTemplateId,
} from "../../threads/templates";
import {
  buildCertificateSteps,
  buildReplySteps,
  buildSendSteps,
} from "../../threads/trace";
import { AUTO_APPROVE_THRESHOLD_CENTS, loopReasonLabel } from "../../types";
import type {
  LoopReasonId,
  Message,
  OversightStats,
  RequestTypeId,
  ThreadDetail,
  ThreadStatus,
} from "../../types";
import { verifyBeforeSend } from "../../threads/verify";
import { getDb } from "../connection";
import {
  formatCents,
  mapAccount,
  mapMessage,
  mapPolicy,
  mapThread,
} from "../mappers";
import { getAccountDetail, getUnderwriter, listUnderwriters } from "./accounts";
import { insertDecision } from "./decisions";
import { getOperator } from "./operators";
import {
  createTicket,
  getTicketDetail,
  setTicketStatus,
  syncTicketStatus,
} from "./tickets";

/** One door for every message write, so routing metadata is never missing. */
export function insertMessage(
  db: Database.Database,
  m: {
    threadId: string;
    role: Message["role"];
    body: string;
    premiumImpactCents?: number | null;
    subject: string;
    toName: string;
    toEmail?: string | null;
    direction: "outbound" | "inbound";
    party: "underwriter" | "client";
    channel?: string;
    loopReason?: string | null;
    createdAt: string;
  },
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO messages (
      id, thread_id, role, body, premium_impact_cents, created_at,
      subject, to_name, to_email, direction, party, channel, loop_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    m.threadId,
    m.role,
    m.body,
    m.premiumImpactCents ?? null,
    m.createdAt,
    m.subject,
    m.toName,
    m.toEmail ?? null,
    m.direction,
    m.party,
    m.channel ?? "email",
    m.loopReason ?? null,
  );
  return id;
}

export function listThreads(filters?: {
  status?: ThreadStatus | "all";
  carrier?: string;
  requestType?: RequestTypeId | "all";
  premiumBand?: "all" | "under" | "over";
  /** Local calendar day key YYYY-MM-DD, or "today", or "all" */
  day?: string | "today" | "all";
  q?: string;
  operatorId?: string;
  openOnly?: boolean;
}): ThreadDetail[] {
  const db = getDb();
  let sql = `SELECT t.id FROM threads t
    JOIN policies p ON p.id = t.policy_id
    JOIN accounts a ON a.id = t.account_id
    WHERE 1=1`;
  const params: (string | number)[] = [];

  if (filters?.status && filters.status !== "all") {
    sql += ` AND t.status = ?`;
    params.push(filters.status);
  }
  if (filters?.carrier && filters.carrier !== "all") {
    sql += ` AND p.carrier = ?`;
    params.push(filters.carrier);
  }
  if (filters?.requestType && filters.requestType !== "all") {
    sql += ` AND t.request_type = ?`;
    params.push(filters.requestType);
  }
  if (filters?.premiumBand === "under") {
    sql += ` AND t.offered_premium_cents IS NOT NULL AND t.offered_premium_cents <= 50000`;
  } else if (filters?.premiumBand === "over") {
    sql += ` AND t.offered_premium_cents IS NOT NULL AND t.offered_premium_cents > 50000`;
  }

  const day = filters?.day;
  if (day && day !== "all") {
    const key = day === "today" ? undefined : day;
    sql += ` AND t.created_at >= ? AND t.created_at <= ?`;
    params.push(startOfLocalDayIso(key), endOfLocalDayIso(key));
  }

  if (filters?.q?.trim()) {
    const q = `%${filters.q.trim().toLowerCase()}%`;
    sql += ` AND (
      lower(a.name) LIKE ? OR lower(t.subject) LIKE ? OR lower(p.carrier) LIKE ?
      OR lower(t.agent_name) LIKE ? OR lower(t.request_type) LIKE ?
    )`;
    params.push(q, q, q, q, q);
  }

  if (filters?.operatorId) {
    sql += ` AND t.operator_id = ?`;
    params.push(filters.operatorId);
  }

  if (filters?.openOnly) {
    sql += ` AND t.status != 'closed'`;
  }

  sql += ` ORDER BY t.updated_at DESC`;
  const ids = db.prepare(sql).all(...params) as { id: string }[];
  return ids.map((r) => getThreadDetail(r.id)!);
}

/**
 * Every underwriter answer that carried a price, for price guidance.
 * Raw history only — summarizing (and refusing to guess) lives in
 * price-guidance.ts.
 */
export function listQuoteSamples(): QuoteSample[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.id AS thread_id, p.carrier, t.request_type,
              t.offered_premium_cents, a.name AS account_name,
              t.subject, t.created_at
       FROM threads t
       JOIN policies p ON p.id = t.policy_id
       JOIN accounts a ON a.id = t.account_id
       WHERE t.offered_premium_cents IS NOT NULL
       ORDER BY t.created_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    threadId: r.thread_id as string,
    carrier: r.carrier as string,
    requestType: r.request_type as RequestTypeId,
    offeredPremiumCents: r.offered_premium_cents as number,
    accountName: r.account_name as string,
    subject: r.subject as string,
    createdAt: r.created_at as string,
  }));
}

export function getThreadDetail(id: string): ThreadDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM threads WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  const thread = mapThread(row);
  const account = mapAccount(
    db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(thread.accountId) as Record<
      string,
      unknown
    >,
  );
  const policy = mapPolicy(
    db.prepare(`SELECT * FROM policies WHERE id = ?`).get(thread.policyId) as Record<
      string,
      unknown
    >,
  );
  const underwriter = getUnderwriter(thread.underwriterId)!;
  const messages = (
    db
      .prepare(
        `SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
      )
      .all(id) as Record<string, unknown>[]
  ).map(mapMessage);

  return { ...thread, account, policy, underwriter, messages };
}

export function createAndSendThread(input: {
  accountId: string;
  policyId: string;
  requestType: RequestTypeId;
  details: string;
  operatorId: string;
  templateId?: EmailTemplateId;
  /** Override the catalog label (e.g. stacked "AI + WOS + 30-day NOC"). */
  requestLabel?: string;
  /** Extra bullets for multi-request compose. */
  requestItems?: string[];
  /** Operator acknowledged warn-level mismatches (UW rematch, missing quote name). */
  ackWarnings?: boolean;
  /** Every market email belongs to a ticket — one is opened if none is passed. */
  ticketId?: string | null;
  /** Required on any outbound after the first on a ticket */
  loopReason?: LoopReasonId | null;
  /** Pre-composed body from the ticket draft; falls back to the template render. */
  bodyOverride?: string | null;
  /** Trace context — what left with the email and who decided to send it. */
  attachments?: { name: string; originalName?: string | null }[];
  edited?: boolean;
  auto?: boolean;
  /**
   * Every model call made while producing this email. Pass `session.calls`
   * from the `ModelSession` that generated the draft — a call that skips this
   * is a call the trace cannot see.
   */
  modelCalls?: ModelCall[];
}): ThreadDetail {
  const db = getDb();
  const account = getAccountDetail(input.accountId);
  if (!account) throw new Error("Account not found");
  const policy = account.policies.find((p) => p.id === input.policyId);
  if (!policy) throw new Error("Policy not found");

  const operator = getOperator(input.operatorId);
  if (!operator) throw new Error("Sign in as an operator before sending");

  const desks = listUnderwriters();
  const verify = verifyBeforeSend({
    account,
    policy,
    requestType: input.requestType,
    carrierDesks: desks,
    wording: input.details,
  });

  if (!verify.okToSend) {
    const blockers = verify.issues
      .filter((i) => i.severity === "block")
      .map((i) => i.title)
      .join("; ");
    throw new Error(`Cannot send — blocked before send: ${blockers}`);
  }
  if (verify.needsAck && !input.ackWarnings) {
    throw new Error(
      "Confirm the verification warnings before sending (UW rematch or incomplete quote data).",
    );
  }
  if (!verify.matchedUw) {
    throw new Error("No underwriter matched to this policy carrier");
  }

  const uw = verify.matchedUw;
  const req = getRequestType(input.requestType);
  const displayLabel = input.requestLabel?.trim() || req.label;
  const templateId = input.templateId ?? operator.defaultTemplate;
  const route = resolveChannel({
    carrier: policy.carrier,
    requestType: input.requestType,
    uwEmail: uw.email,
    uwPhone: uw.phone,
    uwPortal: uw.portal,
    serviceEmail: uw.serviceEmail,
  });

  const verifyFooter =
    verify.issues.length > 0
      ? [
          "",
          "— Verification —",
          ...verify.issues.map(
            (i) => `[${i.severity.toUpperCase()}] ${i.title}: ${i.detail}`,
          ),
          `Matched UW: ${uw.name} (${uw.carrier}) via ${verify.matchSource}`,
        ].join("\n")
      : "";

  const emailBody =
    renderEmailBody(templateId, {
      accountName: account.name,
      policyNumber: policy.policyNumber,
      carrier: policy.carrier,
      coverages: coverageLabels(policy.coverages),
      uwName: uw.name,
      requestLabel: displayLabel,
      requestItems: input.requestItems,
      details: input.details.trim(),
      signature: operator.signature,
    }) + verifyFooter;

  const body = input.bodyOverride?.trim()
    ? input.bodyOverride.trim() + verifyFooter
    : route.sendEmail
    ? emailBody
    : [
        `Channel: ${route.primary.toUpperCase()}`,
        route.instruction,
        "",
        `Request: ${displayLabel}`,
        `Insured: ${account.name}`,
        `Policy: ${policy.policyNumber} (${policy.carrier})`,
        `Details: ${input.details.trim() || "[none]"}`,
        `Operator: ${operator.displayName}`,
        route.portalUrl ? `Portal: ${route.portalUrl}` : null,
        route.email ? `Exception email on file: ${route.email}` : null,
        route.phone ? `Phone: ${route.phone}` : null,
        "",
        route.openPortal
          ? "Logged as a portal task — complete in the carrier portal, then confirm here."
          : route.callFirst
            ? "Logged as a phone path — call the market, then confirm here."
            : "Logged for follow-up.",
        verifyFooter || null,
      ]
        .filter(Boolean)
        .join("\n");

  const now = new Date().toISOString();
  const threadId = randomUUID();
  const subject = route.sendEmail
    ? `[Harper] ${displayLabel} — ${account.name} (${policy.policyNumber})`
    : `[Portal] ${displayLabel} — ${account.name} (${policy.policyNumber})`;
  const agentName = operator.displayName;

  // A market email with no ticket behind it is exactly the thing we're fixing.
  const ticketId =
    input.ticketId ??
    createTicket({
      accountId: account.id,
      policyIds: [policy.id],
      requestType: input.requestType,
      source: "internal",
      requestedBy: operator.displayName,
      requestedByEmail: operator.email,
      subject,
      wording: input.details.trim(),
      operatorId: operator.id,
    }).id;

  const ticket = getTicketDetail(ticketId);
  const touch =
    (ticket?.threads.reduce((n, t) => n + t.messages.length, 0) ?? 0) + 1;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO threads (
        id, ticket_id, account_id, policy_id, underwriter_id, operator_id, request_type, subject, status,
        agent_name, offered_premium_cents, auto_approved, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
    ).run(
      threadId,
      ticketId,
      account.id,
      policy.id,
      uw.id,
      operator.id,
      input.requestType,
      subject,
      "waiting_uw",
      agentName,
      now,
      now,
    );

    const messageId = insertMessage(db, {
      threadId,
      role: "agent",
      body,
      subject,
      toName: uw.name,
      toEmail: route.sendEmail ? uw.email : null,
      direction: "outbound",
      party: "underwriter",
      channel: route.primary,
      loopReason: input.loopReason ?? null,
      createdAt: now,
    });

    if (ticket) {
      const steps = buildSendSteps({
        ticket,
        account,
        policy,
        candidatePolicies: ticket.policies.length ? ticket.policies : [policy],
        verify,
        underwriter: uw,
        route,
        templateId,
        operator,
        attachments: input.attachments ?? [],
        edited: input.edited ?? false,
        ackWarnings: input.ackWarnings ?? false,
        auto: input.auto ?? false,
        touch,
        loopReasonLabel: input.loopReason
          ? loopReasonLabel(input.loopReason)
          : null,
        modelCalls: input.modelCalls,
      });

      insertDecision(db, {
        ticketId,
        threadId,
        messageId,
        kind: input.auto ? "auto_send" : "send",
        author: input.auto ? "ai" : "operator",
        headline: `${route.sendEmail ? "Emailed" : "Routed To"} ${uw.name} — ${policy.carrier}`,
        summary: `${req.label} on ${policy.policyNumber}, ${channelLabel(route.primary).toLowerCase()}, touch ${touch}.`,
        steps,
        createdAt: now,
      });
    }
  });
  tx();

  syncTicketStatus(ticketId);
  return getThreadDetail(threadId)!;
}

export function simulateUwQuote(
  threadId: string,
  premiumImpactCents: number,
): ThreadDetail {
  const db = getDb();
  const thread = getThreadDetail(threadId);
  if (!thread) throw new Error("Thread not found");

  const now = new Date().toISOString();
  const dollars = (premiumImpactCents / 100).toFixed(2);
  const uwBody =
    premiumImpactCents === 0
      ? "Thanks for the request. This one is covered under the existing form — no additional premium. Issue the certificate on your end and send us a copy for the file."
      : `Thanks for the request. We can process this endorsement for an additional premium of $${dollars}. Please confirm if you'd like us to proceed.`;

  const auto = canAutoApprove(premiumImpactCents);
  const agentBody = auto
    ? buildProceedReply(premiumImpactCents)
    : buildHumanHoldReply(premiumImpactCents);
  const status: ThreadStatus = auto ? "auto_approved" : "needs_human";

  const tx = db.transaction(() => {
    const replyId = insertMessage(db, {
      threadId,
      role: "underwriter",
      body: uwBody,
      premiumImpactCents,
      subject: `Re: ${thread.subject}`,
      toName: thread.operatorId
        ? (getOperator(thread.operatorId)?.displayName ?? "Harper Service")
        : "Harper Service",
      toEmail: SERVICE_MAILBOX,
      direction: "inbound",
      party: "underwriter",
      createdAt: now,
    });

    if (thread.ticketId) {
      insertDecision(db, {
        ticketId: thread.ticketId,
        threadId,
        messageId: replyId,
        kind: "reply",
        author: "ai",
        headline:
          premiumImpactCents === 0
            ? `No Charge From ${thread.underwriter.name}`
            : `${thread.underwriter.name} Quoted ${formatCents(premiumImpactCents)}`,
        summary: auto
          ? "Inside agent authority — proceeded without asking a human."
          : "Over agent authority — parked for a human and a client relay.",
        steps: buildReplySteps({
          underwriter: thread.underwriter,
          premiumImpactCents,
          autoApproved: auto,
        }),
        createdAt: now,
      });
    }

    const agentNow = new Date(Date.now() + 1000).toISOString();
    insertMessage(db, {
      threadId,
      role: "agent",
      body: agentBody,
      subject: `Re: ${thread.subject}`,
      toName: thread.underwriter.name,
      toEmail: thread.underwriter.email,
      direction: "outbound",
      party: "underwriter",
      loopReason: auto ? null : "premium_approval",
      createdAt: agentNow,
    });

    db.prepare(
      `UPDATE threads SET status = ?, offered_premium_cents = ?, auto_approved = ?, updated_at = ? WHERE id = ?`,
    ).run(status, premiumImpactCents, auto ? 1 : 0, agentNow, threadId);
  });
  tx();

  syncTicketStatus(thread.ticketId);

  if (
    thread.requestType === "additional_insured" ||
    thread.requestType === "blanket_ai_wos"
  ) {
    recordAiPartyFromThread(thread, premiumImpactCents, auto ? "bound" : "quoted");
  }

  return getThreadDetail(threadId)!;
}

function recordAiPartyFromThread(
  thread: ThreadDetail,
  premiumCents: number | null,
  status: AdditionalInsuredRecord["status"],
) {
  const db = getDb();
  const ticket = thread.ticketId ? getTicketDetail(thread.ticketId) : null;
  const name =
    ticket?.holderName?.trim() ||
    (ticket?.subject.match(/for (.+)$/i)?.[1] ?? null) ||
    "Additional Insured Party";
  const formSet = loadPolicyFormSetFromDb(db, thread.policyId);
  const aiForm =
    formSet?.endorsements.find((e) => e.kind === "ai")?.form ?? null;

  upsertAdditionalInsured(db, {
    accountId: thread.accountId,
    policyId: thread.policyId,
    ticketId: thread.ticketId,
    srNumber: ticket?.srNumber ?? null,
    name,
    address: ticket?.holderAddress ?? null,
    formUsed: aiForm,
    effectiveAt: new Date().toISOString().slice(0, 10),
    premiumCents,
    status,
    notes: `From ${ticket?.srNumber ?? thread.id} · ${getRequestType(thread.requestType).label}`,
  });
}

export function humanProceed(threadId: string): ThreadDetail {
  const db = getDb();
  const thread = getThreadDetail(threadId);
  if (!thread) throw new Error("Thread not found");

  const now = new Date().toISOString();
  const body =
    "Confirmed by human CSR — please proceed with the endorsement as quoted. Thank you.";

  const tx = db.transaction(() => {
    const messageId = insertMessage(db, {
      threadId,
      role: "human",
      body,
      subject: `Re: ${thread.subject}`,
      toName: thread.underwriter.name,
      toEmail: thread.underwriter.email,
      direction: "outbound",
      party: "underwriter",
      loopReason: "premium_approval",
      createdAt: now,
    });

    if (thread.ticketId) {
      insertDecision(db, {
        ticketId: thread.ticketId,
        threadId,
        messageId,
        kind: "approval",
        author: "operator",
        headline: `Human Approved ${formatCents(thread.offeredPremiumCents)}`,
        summary: "Over the agent's authority, so a person carried the decision.",
        steps: [
          {
            id: "escalation",
            label: "Why A Human",
            rule: `Anything over ${formatCents(AUTO_APPROVE_THRESHOLD_CENTS)} leaves the agent's authority.`,
            inputs: [
              {
                label: "Quoted",
                value: formatCents(thread.offeredPremiumCents),
              },
              {
                label: "Authority Limit",
                value: formatCents(AUTO_APPROVE_THRESHOLD_CENTS),
              },
            ],
            outcome: "Escalated to a human before the market heard yes",
            verdict: "warn",
          },
          {
            id: "decision",
            label: "Decision",
            rule: "The operator's confirmation is what authorizes the endorsement.",
            inputs: [{ label: "Told The Market", value: body }],
            outcome: "Approved — market cleared to proceed",
            verdict: "ok",
          },
        ],
        createdAt: now,
      });
    }

    db.prepare(
      `UPDATE threads SET status = 'closed', auto_approved = 0, updated_at = ? WHERE id = ?`,
    ).run(now, threadId);
  });
  tx();

  syncTicketStatus(thread.ticketId);
  return getThreadDetail(threadId)!;
}

/** Relay the carrier's terms to the insured and park the thread on their answer. */
export function recordClientTerms(input: {
  threadId: string;
  body: string;
  paymentReference: string | null;
}): ThreadDetail {
  const db = getDb();
  const thread = getThreadDetail(input.threadId);
  if (!thread) throw new Error("Thread not found");

  const now = new Date().toISOString();
  const body = input.paymentReference
    ? `${input.body}\n\n[Payment Reference ${input.paymentReference}]`
    : input.body;

  const tx = db.transaction(() => {
    const messageId = insertMessage(db, {
      threadId: input.threadId,
      role: "client",
      body,
      premiumImpactCents: thread.offeredPremiumCents,
      subject: `Your ${getRequestType(thread.requestType).label} Request — Terms`,
      toName: thread.account.name,
      toEmail: null,
      direction: "outbound",
      party: "client",
      createdAt: now,
    });

    if (thread.ticketId) {
      insertDecision(db, {
        ticketId: thread.ticketId,
        threadId: input.threadId,
        messageId,
        kind: "client_terms",
        author: "operator",
        headline: `Terms Relayed To ${thread.account.name}`,
        summary: `${formatCents(thread.offeredPremiumCents)} quoted by ${thread.underwriter.name}, passed through with a payment link.`,
        steps: [
          {
            id: "why-relay",
            label: "Why The Client Hears This",
            rule: `Premium over ${formatCents(AUTO_APPROVE_THRESHOLD_CENTS)} is not ours to accept — the insured decides.`,
            inputs: [
              { label: "Quoted", value: formatCents(thread.offeredPremiumCents) },
              { label: "Market", value: `${thread.underwriter.name} — ${thread.policy.carrier}` },
            ],
            outcome: "Relayed for the insured's decision",
            verdict: "warn",
          },
          {
            id: "relay-contents",
            label: "What Was Relayed",
            rule: "The client sees what they asked for and what the market answered — no interpretation in between.",
            inputs: [
              { label: "Requested", value: thread.subject },
              {
                label: "Payment Reference",
                value: input.paymentReference ?? "None issued",
              },
            ],
            outcome: "Request plus market terms, with a way to pay",
            verdict: "info",
          },
        ],
        createdAt: now,
      });
    }

    db.prepare(
      `UPDATE threads SET status = 'price_offered', updated_at = ? WHERE id = ?`,
    ).run(now, input.threadId);
  });
  tx();

  syncTicketStatus(thread.ticketId);
  return getThreadDetail(input.threadId)!;
}

/**
 * Payment is what advances an over-threshold ticket — not the operator's
 * optimism about the insured saying yes.
 */
export function recordPaymentCleared(threadId: string): ThreadDetail {
  const db = getDb();
  const thread = getThreadDetail(threadId);
  if (!thread) throw new Error("Thread not found");

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    insertMessage(db, {
      threadId,
      role: "human",
      body: `Payment cleared for ${formatCents(thread.offeredPremiumCents)}. Endorsement is paid — the certificate is ours to issue.`,
      premiumImpactCents: thread.offeredPremiumCents,
      subject: `Payment Received — ${thread.account.name}`,
      toName: "Harper Service",
      toEmail: SERVICE_MAILBOX,
      direction: "inbound",
      party: "client",
      channel: "payment",
      createdAt: now,
    });
    db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(
      now,
      threadId,
    );
  });
  tx();

  if (thread.ticketId) setTicketStatus(thread.ticketId, "ready_to_issue");
  return getThreadDetail(threadId)!;
}

/** Log a certificate check. Issuing closes the request; rejecting keeps it open. */
export function recordCoiDecision(input: {
  threadId: string;
  decision: "issued" | "rejected";
  summary: string;
  /** Model calls that read the uploaded document, if any were made. */
  modelCalls?: ModelCall[];
}): ThreadDetail {
  const db = getDb();
  const thread = getThreadDetail(input.threadId);
  if (!thread) throw new Error("Thread not found");

  const now = new Date().toISOString();
  const header =
    input.decision === "issued"
      ? "Certificate Issued — verified against the policy coverage tab."
      : "Certificate Rejected — the request asks for coverage this policy doesn't carry.";

  const issued = input.decision === "issued";

  const tx = db.transaction(() => {
    const messageId = insertMessage(db, {
      threadId: input.threadId,
      role: issued ? "client" : "human",
      body: `${header}\n\n${input.summary}`,
      subject: issued
        ? `Certificate Of Insurance — ${thread.account.name}`
        : `Certificate Request Rejected — ${thread.account.name}`,
      toName: issued ? thread.account.name : "Harper Service",
      toEmail: issued ? null : SERVICE_MAILBOX,
      direction: "outbound",
      party: issued ? "client" : "underwriter",
      channel: issued ? "email" : "internal",
      createdAt: now,
    });

    if (thread.ticketId) {
      insertDecision(db, {
        ticketId: thread.ticketId,
        threadId: input.threadId,
        messageId,
        kind: "certificate",
        author: "operator",
        headline: issued
          ? `Certificate Issued — ${thread.account.name}`
          : `Certificate Refused — ${thread.account.name}`,
        summary: input.summary,
        steps: buildCertificateSteps({
          decision: input.decision,
          summary: input.summary,
          policy: thread.policy,
          modelCalls: input.modelCalls,
        }),
        createdAt: now,
      });
    }
    if (issued) {
      db.prepare(
        `UPDATE threads SET status = 'closed', updated_at = ? WHERE id = ?`,
      ).run(now, input.threadId);
    } else {
      db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(
        now,
        input.threadId,
      );
    }
  });
  tx();

  // Issuing the certificate is the outcome the ticket existed for.
  if (issued && thread.ticketId) {
    setTicketStatus(thread.ticketId, "delivered");
    if (
      thread.requestType === "additional_insured" ||
      thread.requestType === "blanket_ai_wos"
    ) {
      recordAiPartyFromThread(
        thread,
        thread.offeredPremiumCents,
        "bound",
      );
    }
  } else {
    syncTicketStatus(thread.ticketId);
  }
  return getThreadDetail(input.threadId)!;
}

export function closeThread(threadId: string): ThreadDetail {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE threads SET status = 'closed', updated_at = ? WHERE id = ?`).run(
    now,
    threadId,
  );
  const thread = getThreadDetail(threadId)!;
  syncTicketStatus(thread.ticketId);
  return thread;
}

export function getOversightStats(filters?: {
  status?: ThreadStatus | "all";
  carrier?: string;
  requestType?: RequestTypeId | "all";
  premiumBand?: "all" | "under" | "over";
  day?: string | "today" | "all";
  q?: string;
}): OversightStats {
  const threads = listThreads(filters);
  const openStatuses: ThreadStatus[] = [
    "drafting",
    "waiting_uw",
    "price_offered",
    "auto_approved",
    "needs_human",
  ];

  const byCarrierMap = new Map<string, { count: number; offeredCents: number }>();
  const byRequestMap = new Map<RequestTypeId, number>();
  const byStatusMap = new Map<ThreadStatus, number>();

  let totalOfferedCents = 0;
  let autoApprovedCents = 0;
  let humanHeldCents = 0;
  let waitingUw = 0;
  let needsHuman = 0;
  let autoApproved = 0;

  for (const t of threads) {
    byStatusMap.set(t.status, (byStatusMap.get(t.status) ?? 0) + 1);
    byRequestMap.set(t.requestType, (byRequestMap.get(t.requestType) ?? 0) + 1);

    const carrierEntry = byCarrierMap.get(t.policy.carrier) ?? {
      count: 0,
      offeredCents: 0,
    };
    carrierEntry.count += 1;
    carrierEntry.offeredCents += t.offeredPremiumCents ?? 0;
    byCarrierMap.set(t.policy.carrier, carrierEntry);

    if (t.offeredPremiumCents != null) {
      totalOfferedCents += t.offeredPremiumCents;
      if (t.autoApproved || t.status === "auto_approved") {
        autoApprovedCents += t.offeredPremiumCents;
      }
      if (t.status === "needs_human") {
        humanHeldCents += t.offeredPremiumCents;
      }
    }

    if (t.status === "waiting_uw") waitingUw += 1;
    if (t.status === "needs_human") needsHuman += 1;
    if (t.status === "auto_approved") autoApproved += 1;
  }

  return {
    openThreads: threads.filter((t) => openStatuses.includes(t.status)).length,
    waitingUw,
    needsHuman,
    autoApproved,
    totalOfferedCents,
    autoApprovedCents,
    humanHeldCents,
    byCarrier: [...byCarrierMap.entries()]
      .map(([carrier, v]) => ({ carrier, ...v }))
      .sort((a, b) => b.count - a.count),
    byRequestType: [...byRequestMap.entries()]
      .map(([requestType, count]) => ({ requestType, count }))
      .sort((a, b) => b.count - a.count),
    byStatus: [...byStatusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    threads,
  };
}
