import type {
  Account,
  LoopReasonId,
  Message,
  Operator,
  Policy,
  RequestTypeId,
  Thread,
  ThreadStatus,
  Underwriter,
} from "../types";

export function mapUw(row: Record<string, unknown>): Underwriter {
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string) ?? null,
    portal: (row.portal as string) ?? null,
    carrier: row.carrier as string,
    notes: (row.notes as string) ?? null,
    channelPrimary:
      ((row.channel_primary as Underwriter["channelPrimary"]) ||
        "email") as Underwriter["channelPrimary"],
    serviceEmail: (row.service_email as string) ?? null,
    channelNote: (row.channel_note as string) ?? null,
  };
}

export function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    name: row.name as string,
    dba: (row.dba as string) ?? null,
    industry: row.industry as string,
    addressLine1: (row.address1 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: row.state as string,
    zip: (row.zip as string | null) ?? null,
    primaryUwId: (row.primary_uw_id as string) ?? (row.primaryUwId as string),
    backupUwId:
      (row.backup_uw_id as string | null) ??
      (row.backupUwId as string | null) ??
      null,
    notes: (row.notes as string) ?? null,
    status: ((row.status as string) || "active") as Account["status"],
    paymentReceivedAt: (row.payment_received_at as string) ?? null,
  };
}

export function mapPolicy(row: Record<string, unknown>): Policy {
  return {
    id: row.id as string,
    accountId: (row.account_id as string) ?? (row.accountId as string),
    policyNumber:
      (row.policy_number as string) ?? (row.policyNumber as string),
    carrier: row.carrier as string,
    coverages: JSON.parse(row.coverages_json as string) as string[],
    effectiveDate:
      (row.effective_date as string) ?? (row.effectiveDate as string),
    expirationDate:
      (row.expiration_date as string) ?? (row.expirationDate as string),
    premiumCents:
      (row.premium_cents as number) ?? (row.premiumCents as number),
    issuingCarrier:
      (row.issuing_carrier as string | null) ??
      (row.issuingCarrier as string | null) ??
      null,
    quoteInsuredName:
      (row.quote_insured_name as string | null) ??
      (row.quoteInsuredName as string | null) ??
      null,
    quoteCarrier:
      (row.quote_carrier as string | null) ??
      (row.quoteCarrier as string | null) ??
      null,
  };
}

export function mapThread(row: Record<string, unknown>): Thread {
  return {
    id: row.id as string,
    ticketId: (row.ticket_id as string | null) ?? null,
    accountId: row.account_id as string,
    policyId: row.policy_id as string,
    underwriterId: row.underwriter_id as string,
    operatorId: (row.operator_id as string | null) ?? null,
    requestType: row.request_type as RequestTypeId,
    subject: row.subject as string,
    status: row.status as ThreadStatus,
    agentName: row.agent_name as string,
    offeredPremiumCents: (row.offered_premium_cents as number) ?? null,
    autoApproved: Boolean(row.auto_approved),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapOperator(row: Record<string, unknown>): Operator {
  return {
    id: row.id as string,
    clerkUserId: (row.clerk_user_id as string | null) ?? null,
    displayName: row.display_name as string,
    email: row.email as string,
    title: row.title as string,
    phone: (row.phone as string) ?? null,
    role: ((row.role as string) || "operator") as Operator["role"],
    team: (row.team as string | null) ?? null,
    signature: row.signature as string,
    defaultTemplate: (row.default_template as Operator["defaultTemplate"]) || "standard",
  };
}

export function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    role: row.role as Message["role"],
    body: row.body as string,
    premiumImpactCents: (row.premium_impact_cents as number) ?? null,
    createdAt: row.created_at as string,
    subject: (row.subject as string | null) ?? "",
    toName: (row.to_name as string | null) ?? "",
    toEmail: (row.to_email as string | null) ?? null,
    direction:
      ((row.direction as Message["direction"] | null) ??
        (row.role === "underwriter" ? "inbound" : "outbound")),
    party:
      ((row.party as Message["party"] | null) ??
        (row.role === "client" ? "client" : "underwriter")),
    channel: (row.channel as string | null) ?? "email",
    loopReason: (row.loop_reason as LoopReasonId | null) ?? null,
  };
}

export function formatCents(cents: number | null): string {
  if (cents == null) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}
