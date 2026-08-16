import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type {
  DecisionTrace,
  TraceAuthor,
  TraceKind,
  TraceStep,
} from "../../threads/trace";
import { getDb } from "../connection";

/** The reasoning behind a write, recorded next to it in the same transaction. */
export function insertDecision(
  db: Database.Database,
  d: {
    ticketId: string;
    threadId?: string | null;
    messageId?: string | null;
    kind: TraceKind;
    author: TraceAuthor;
    headline: string;
    summary?: string;
    steps: TraceStep[];
    createdAt: string;
  },
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO decisions (
      id, ticket_id, thread_id, message_id, kind, author,
      headline, summary, steps_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    d.ticketId,
    d.threadId ?? null,
    d.messageId ?? null,
    d.kind,
    d.author,
    d.headline,
    d.summary ?? "",
    JSON.stringify(d.steps),
    d.createdAt,
  );
  return id;
}

function mapDecision(row: Record<string, unknown>): DecisionTrace {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    threadId: (row.thread_id as string) ?? null,
    messageId: (row.message_id as string) ?? null,
    kind: row.kind as TraceKind,
    author: row.author as TraceAuthor,
    headline: row.headline as string,
    summary: (row.summary as string) ?? "",
    steps: JSON.parse((row.steps_json as string) || "[]") as TraceStep[],
    createdAt: row.created_at as string,
  };
}

export function listDecisions(filters?: {
  ticketId?: string;
  messageId?: string;
  kind?: string;
}): DecisionTrace[] {
  const db = getDb();
  const where: string[] = [];
  const args: unknown[] = [];

  if (filters?.ticketId) {
    where.push("ticket_id = ?");
    args.push(filters.ticketId);
  }
  if (filters?.messageId) {
    where.push("message_id = ?");
    args.push(filters.messageId);
  }
  if (filters?.kind && filters.kind !== "all") {
    where.push("kind = ?");
    args.push(filters.kind);
  }

  const rows = db
    .prepare(
      `SELECT * FROM decisions
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC`,
    )
    .all(...args) as Record<string, unknown>[];
  return rows.map(mapDecision);
}

/**
 * A carrier-knowledge blocker stopped a request before the market saw it.
 * Recorded as a decision trace on the ticket so the block is auditable:
 * which entry, what it forbids, and what the request asked for.
 */
export function recordCarrierKnowledgeBlock(input: {
  ticketId: string;
  requestLabel: string;
  policy: { policyNumber: string; carrier: string; coverages: string[] };
  account: { name: string; state: string; industry: string };
  hits: {
    id: string;
    title: string;
    detail: string;
    consequence: string;
    severity: string;
  }[];
}): void {
  if (input.hits.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const first = input.hits[0];
  insertDecision(db, {
    ticketId: input.ticketId,
    kind: "certificate",
    author: "ai",
    headline: `Carrier Knowledge Block — ${first.title}`,
    summary: `${input.requestLabel} on ${input.policy.carrier} ${input.policy.policyNumber} stopped by the carrier knowledge registry (${input.hits
      .map((h) => h.id)
      .join(", ")}). Nothing went to the market.`,
    steps: input.hits.map((hit, i) => ({
      id: `carrier-knowledge-${hit.id}-${i}`,
      label: "Carrier Knowledge Gate",
      rule: "Enforceable registry entries encode what a carrier will never grant. A matching blocker stops the request before the desk promises anything or touches the market.",
      inputs: [
        { label: "Knowledge Entry", value: `${hit.id} — ${hit.title}` },
        { label: "Request", value: input.requestLabel },
        {
          label: "Policy",
          value: `${input.policy.carrier} ${input.policy.policyNumber} (${input.policy.coverages.join(", ")})`,
        },
        {
          label: "Account Scope",
          value: `${input.account.name} — ${input.account.industry}, ${input.account.state}`,
        },
        { label: "What The Registry Says", value: hit.detail },
        { label: "Why It Matters", value: hit.consequence },
      ],
      outcome:
        hit.severity === "blocker"
          ? "Blocked — non-overridable"
          : "Warned — needs operator acknowledgment",
      verdict: hit.severity === "blocker" ? "block" : "warn",
      source: "rule",
    })),
    createdAt: now,
  });
}
