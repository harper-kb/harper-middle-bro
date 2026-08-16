/**
 * Managers run the desk: assign accounts, receive escalations, see the whole
 * book. Operators see the accounts they've been granted and their own work.
 */
export type OperatorRole = "manager" | "operator";

export interface Operator {
  id: string;
  /** Clerk user id when this desk is linked to a real sign-in */
  clerkUserId: string | null;
  displayName: string;
  email: string;
  title: string;
  phone: string | null;
  role: OperatorRole;
  /** Team label, e.g. "COI Team" — null for unteamed desks */
  team: string | null;
  /** Full email signature block — stamped on every draft */
  signature: string;
  /** Preferred email template id */
  defaultTemplate: "standard" | "brief" | "formal" | "bullets";
}

/** A manager's grant of one account to one operator. */
export interface AccountGrant {
  operatorId: string;
  accountId: string;
  grantedBy: string | null;
  grantedAt: string;
}

export type ThreadStatus =
  | "drafting"
  | "waiting_uw"
  | "price_offered"
  | "auto_approved"
  | "needs_human"
  | "closed";

export type RequestTypeId =
  | "additional_insured"
  | "waiver_of_subrogation"
  | "primary_non_contributory"
  | "blanket_ai_wos"
  | "limit_change"
  | "additional_named_insured"
  | "coverage_extension"
  | "named_insured_correction"
  | "business_change"
  | "notice_cancellation_30"
  | "subjectivity_response"
  | "binder_confirmation"
  | "premium_finance"
  | "general_uw_question"
  | "renewal_remarket";

/**
 * Expected premium impact before the market quotes — guides the compose stack.
 * Three tiers: rarely / sometimes / usually. Operator ballpark only — the
 * market always sets the actual price.
 */
export type PremiumBearing = "usually" | "sometimes" | "rarely";

export interface Underwriter {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  portal: string | null;
  carrier: string;
  notes: string | null;
  /** Default reach path for this market desk */
  channelPrimary: "portal" | "email" | "phone" | "hybrid";
  /** Shared / exception inbox that still exists on portal markets */
  serviceEmail: string | null;
  channelNote: string | null;
}

export interface Policy {
  id: string;
  accountId: string;
  policyNumber: string;
  carrier: string;
  coverages: string[];
  effectiveDate: string;
  expirationDate: string;
  premiumCents: number;
  /** Named insured as printed on the quote — may disagree with the account (upload error) */
  quoteInsuredName: string | null;
  /** Carrier as printed on the quote PDF */
  quoteCarrier: string | null;
  /**
   * Writing company legal name off the dec page, recorded when the brand is
   * an MGA (ISC issues on Hadron Specialty / Sutton National / SiriusPoint
   * America / Third Coast). Omitted or null = writer not recorded; the NAIC
   * cell falls back to the brand rules and may print blank.
   */
  issuingCarrier?: string | null;
}

/**
 * Account lifecycle. New business sits in `pre_bind` (quoted/bound, unpaid) —
 * we still do work for them (DocuSigns, prep), but paper issues once paid.
 * Payment received is what flips an account into active service.
 */
export type AccountStatus = "pre_bind" | "active" | "cancelled";

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pre_bind: "Pre-Bind",
  active: "Active",
  cancelled: "Cancelled",
};

// ————————————————— Comm Intake —————————————————

/**
 * Raw communications land here before they are tickets: service-inbox emails,
 * texts, and phone calls (with transcripts). The Pending board proposes
 * tickets from these; nothing becomes an SR without either high-confidence
 * matching or an operator's confirm.
 */
export type IntakeChannel = "email" | "text" | "call";

export type IntakeStatus =
  | "pending" // awaiting triage on the Pending board
  | "ticketed" // became its own ticket
  | "merged" // attached to an existing ticket (high-confidence duplicate)
  | "dismissed"; // no action needed (spam, FYI, wrong number)

export interface IntakeEvent {
  id: string;
  channel: IntakeChannel;
  fromName: string;
  /** Email address or phone number the comm came from */
  fromContact: string;
  /** Matched account, when the sender resolves to one — null means unknown */
  accountId: string | null;
  receivedAt: string;
  subject: string | null;
  /** Email body, text message, or call transcript */
  body: string;
  /** Calls only — missed calls are the triage priority */
  callMissed: boolean | null;
  callDurationSec: number | null;
  status: IntakeStatus;
  /** Ticket this event created or merged into */
  ticketId: string | null;
  /** Service-inbox acknowledgment ("we got it, here's your SR") — sent time + exact body */
  ackSentAt: string | null;
  ackBody: string | null;
}

export interface Account {
  id: string;
  name: string;
  dba: string | null;
  industry: string;
  /** Mailing address on the account record — feeds the certificate's INSURED box. */
  addressLine1: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  primaryUwId: string;
  backupUwId: string | null;
  notes: string | null;
  status: AccountStatus;
  /** When payment landed — the moment service became active */
  paymentReceivedAt: string | null;
}

/** How the work arrived. Portal, producer relay, and service request are the same shape. */
export type TicketSource =
  | "producer"
  | "insured"
  | "portal"
  | "email"
  | "sms"
  | "phone"
  | "internal";

export type TicketStatus =
  | "intake"
  | "drafting"
  | "waiting_market"
  | "needs_you"
  | "ready_to_issue"
  | "delivered"
  | "closed";

/** A document sitting on the account. Customer uploads are filed, never trusted as a limit source. */
export interface AccountDoc {
  id: string;
  name: string;
  kind: "quote" | "policy" | "customer_upload" | "endorsement";
  sizeLabel: string;
  trusted: boolean;
}

/**
 * The unit of work. Someone asked for something and we owe them an outcome.
 * Emails to the market are what a ticket produces, not the ticket itself.
 */
export interface Ticket {
  id: string;
  accountId: string;
  requestType: RequestTypeId;
  title: string;
  /** How the request read when it arrived — inbound subject line or portal reference */
  subject: string;
  source: TicketSource;
  requestedBy: string;
  requestedByEmail: string | null;
  holderName: string | null;
  holderAddress: string | null;
  wording: string;
  /** Holder contractually requires being named on the policy — blanket wording won't satisfy them */
  namedOnPolicyRequired: boolean;
  /** Set when the blanket fast path issued this without the market — cites the exact form */
  fastPathBasis: string | null;
  /** Escalation: an operator flagged this up for help ("I'll get to it by end of day") */
  escalatedToId: string | null;
  escalationNote: string | null;
  escalatedAt: string | null;
  /** The promise — defaults to end of the flagging day */
  escalationDueBy: string | null;
  escalationResolvedAt: string | null;
  status: TicketStatus;
  /** Human-facing service request number — e.g. SR-10042 */
  srNumber: string;
  operatorId: string | null;
  docs: AccountDoc[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface TicketDetail extends Ticket {
  account: AccountDetail;
  /** A cert or an AI request routinely spans policies */
  policies: Policy[];
  threads: ThreadDetail[];
}

export interface Thread {
  id: string;
  /** Every market conversation belongs to a ticket — no orphan email */
  ticketId: string | null;
  accountId: string;
  policyId: string;
  underwriterId: string;
  operatorId: string | null;
  requestType: RequestTypeId;
  subject: string;
  status: ThreadStatus;
  agentName: string;
  offeredPremiumCents: number | null;
  autoApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  /** `client` is outbound to the insured — terms relays and certificate notices */
  role: "agent" | "underwriter" | "human" | "client";
  body: string;
  premiumImpactCents: number | null;
  createdAt: string;
  subject: string;
  toName: string;
  toEmail: string | null;
  direction: "outbound" | "inbound";
  party: "underwriter" | "client";
  channel: string;
  /** Why we had to touch this thread again — the eliminate-this list */
  loopReason: LoopReasonId | null;
}

/** One-tap tags on any outbound after the first, so loops are countable. */
export const LOOP_REASONS = [
  { id: "missing_info", label: "Missing Info From Insured" },
  { id: "market_question", label: "Market Asked A Question" },
  { id: "wrong_desk", label: "Wrong Desk First Time" },
  { id: "premium_approval", label: "Premium Approval" },
  { id: "quote_mismatch", label: "Quote Mismatch" },
  { id: "chasing", label: "Chasing No Reply" },
  { id: "other", label: "Other" },
] as const;

export type LoopReasonId = (typeof LOOP_REASONS)[number]["id"];

export function loopReasonLabel(id: string | null): string {
  return LOOP_REASONS.find((r) => r.id === id)?.label ?? "Untagged";
}

export interface AccountDetail extends Account {
  primaryUw: Underwriter;
  backupUw: Underwriter | null;
  policies: Policy[];
  threads: Thread[];
}

export interface ThreadDetail extends Thread {
  account: Account;
  policy: Policy;
  underwriter: Underwriter;
  messages: Message[];
}

export interface OversightStats {
  openThreads: number;
  waitingUw: number;
  needsHuman: number;
  autoApproved: number;
  totalOfferedCents: number;
  autoApprovedCents: number;
  humanHeldCents: number;
  byCarrier: { carrier: string; count: number; offeredCents: number }[];
  byRequestType: { requestType: RequestTypeId; count: number }[];
  byStatus: { status: ThreadStatus; count: number }[];
  threads: ThreadDetail[];
}

export const AUTO_APPROVE_THRESHOLD_CENTS = 50_000;

// ————————————————— Step Bro CRM contracts —————————————————
//
// Canonical task/work-item + adapter seams. UI reads these shapes only;
// BigBrother / Agent Tools / legacy backends stay behind server adapters.
// Source APIs and capability gates: docs/step-bro-adapters.md

/** Sidebar groups: Accounts | Service | Manager. */
export type ServiceNavGroup = "accounts" | "service" | "manager";

/**
 * One home lane per work item. Sections may show filtered views of the same
 * item but must never mint a duplicate with a different home lane.
 */
export type ServiceLaneId =
  | "pending_orders"
  | "active_service"
  | "pending_cancels"
  | "post_sales"
  | "coi"
  | "subjectivities"
  | "instant_binds"
  | "communications";

export const SERVICE_LANE_IDS: readonly ServiceLaneId[] = [
  "pending_orders",
  "active_service",
  "pending_cancels",
  "post_sales",
  "coi",
  "subjectivities",
  "instant_binds",
  "communications",
] as const;

export const SERVICE_LANE_LABELS: Record<ServiceLaneId, string> = {
  pending_orders: "Pending Orders",
  active_service: "Active Service",
  pending_cancels: "Pending Cancellations",
  post_sales: "Post Sales",
  coi: "COI Studio",
  subjectivities: "Subjectivities",
  instant_binds: "Instant Binds",
  communications: "Inbox",
};

export const SERVICE_LANE_HREFS: Record<ServiceLaneId, string> = {
  pending_orders: "/pending-orders",
  active_service: "/active-service",
  pending_cancels: "/pending-cancels",
  post_sales: "/post-sales",
  coi: "/coi",
  subjectivities: "/subjectivities",
  instant_binds: "/instant-binds",
  communications: "/communications",
};

/** Live only after count reconciliation against BigBrother; else labeled sample. */
export type LaneDataMode = "live" | "sample";

export type UrgencyTier = "A" | "B" | "C" | "none";

export type WorkItemClockKind =
  | "sla"
  | "cancellation_effective"
  | "follow_up"
  | "bind_deadline"
  | "aged_backlog";

/**
 * Compact section-row signals (anti-overload): at most five of these appear
 * on a queue row. Depth lives in the split workspace, never on the row.
 */
export type WorkItemRowSignal =
  | "what"
  | "who"
  | "clock"
  | "blocker"
  | "action";

export const WORK_ITEM_ROW_SIGNALS: readonly WorkItemRowSignal[] = [
  "what",
  "who",
  "clock",
  "blocker",
  "action",
] as const;

/** Why this item is next — shown in Desk and section detail. */
export interface WorkItemPriorityReason {
  code:
    | "fire_flag"
    | "operator_override"
    | "urgency_tier"
    | "urgency_score"
    | "action_required"
    | "deadline"
    | "age"
    | "lane_clock";
  label: string;
  detail?: string;
}

export interface WorkItemOwner {
  operatorId: string | null;
  displayName: string | null;
  team: string | null;
}

export interface WorkItemBlocker {
  code: string;
  label: string;
  /** Capability or external system that must clear before the action is live */
  capabilityId?: CapabilityId | null;
}

export interface WorkItemClock {
  kind: WorkItemClockKind;
  /** ISO timestamp when known */
  at: string | null;
  label: string;
  breached: boolean;
}

/**
 * Canonical unit of service work. One home lane; other sections may filter
 * the same id but must not create a second WorkItem for the same grain.
 */
export interface WorkItem {
  id: string;
  /** Stable external id from BigBrother / service.tasks when live */
  externalId: string | null;
  homeLane: ServiceLaneId;
  accountId: string;
  accountName: string;
  /** Human title — the "what" on a compact row */
  title: string;
  summary: string;
  owner: WorkItemOwner;
  urgencyTier: UrgencyTier;
  urgencyScore: number | null;
  isOnFire: boolean;
  actionRequired: boolean;
  clock: WorkItemClock;
  blocker: WorkItemBlocker | null;
  /** One-click primary action label shown on the row */
  nextActionLabel: string;
  priorityReasons: WorkItemPriorityReason[];
  /** ISO created / last activity for age tie-breaks */
  createdAt: string;
  updatedAt: string;
  /** When parked/skipped — Desk requires a reason + next wake */
  parkedUntil: string | null;
  parkReason: string | null;
}

/** Compact projection for section queues (≤5 signals). */
export interface WorkItemRow {
  id: string;
  homeLane: ServiceLaneId;
  accountId: string;
  what: string;
  who: string;
  clock: string;
  clockBreached: boolean;
  blocker: string | null;
  action: string;
  urgencyTier: UrgencyTier;
  isOnFire: boolean;
  mode: LaneDataMode;
}

export function toWorkItemRow(item: WorkItem, mode: LaneDataMode): WorkItemRow {
  return {
    id: item.id,
    homeLane: item.homeLane,
    accountId: item.accountId,
    what: item.title,
    who: item.owner.displayName ?? "Unassigned",
    clock: item.clock.label,
    clockBreached: item.clock.breached,
    blocker: item.blocker?.label ?? null,
    action: item.nextActionLabel,
    urgencyTier: item.urgencyTier,
    isOnFire: item.isOnFire,
    mode,
  };
}

// —— Capabilities / receipts / adapters ——

/**
 * Action doors Step Bro may invoke. Capability discovery returns which are
 * available vs blocked (missing Agent Tools door, missing credentials, etc.).
 */
export type CapabilityId =
  | "read.bigbrother.lanes"
  | "read.bigbrother.account"
  | "write.issue"
  | "write.task"
  | "write.draft"
  | "write.comms.email"
  | "write.comms.text"
  | "write.comms.bulk"
  | "write.payment_link"
  | "write.docusign"
  | "write.bind"
  | "write.service_note"
  | "write.coi.issue"
  | "write.coi.send"
  | "read.memory"
  | "read.agent_status"
  | "write.reminder"
  | "service_spine.enabled"
  | "service_agent.enabled";

export type CapabilityState = "available" | "blocked" | "unavailable";

export interface CapabilityGate {
  id: CapabilityId;
  state: CapabilityState;
  /** Precise blocker copy when not available — never a dead control */
  blockerLabel: string | null;
  /** Adapter that would serve this capability today */
  provider: "agent_tools" | "bigbrother" | "legacy" | "local";
}

export type ConfirmationPolicy =
  | "none"
  | "one_click"
  | "batch_review";

export type ReceiptStatus =
  | "accepted"
  | "confirmed"
  | "rejected"
  | "failed"
  | "idempotent_replay";

/**
 * Redacted audit receipt for every mutation. UI and QA rely on this shape;
 * never return raw secrets or full PII payloads.
 */
export interface ActionReceipt {
  id: string;
  capabilityId: CapabilityId;
  idempotencyKey: string;
  status: ReceiptStatus;
  operatorId: string;
  workItemId: string | null;
  accountId: string | null;
  /** Short operator-visible summary */
  summary: string;
  /** ISO timestamps */
  requestedAt: string;
  completedAt: string | null;
  /** Read-after-write verification result when applicable */
  verified: boolean | null;
  /** Non-sensitive diagnostic crumbs */
  details: Record<string, string | number | boolean | null>;
}

export interface IdempotencyRecord {
  key: string;
  capabilityId: CapabilityId;
  receiptId: string;
  createdAt: string;
}

/** Per-lane live-read result with honesty metadata. */
export interface LaneSnapshot {
  lane: ServiceLaneId;
  mode: LaneDataMode;
  /** When mode is sample, this explains why (missing credential, etc.) */
  modeReason: string | null;
  items: WorkItem[];
  /** Count reported by Step Bro adapter */
  count: number;
  /** Count from BigBrother reconciliation probe when available */
  sourceCount: number | null;
  /** true only when counts match and credentials are live */
  reconciled: boolean;
  fetchedAt: string;
  sourceApi: string;
}

/**
 * Server-only live-read adapter contract. Implementations must import
 * `server-only` and never be referenced from client components.
 */
export interface LaneReadAdapter {
  lane: ServiceLaneId;
  sourceApi: string;
  list(params?: { operatorId?: string | null }): Promise<LaneSnapshot>;
  get(workItemId: string): Promise<WorkItem | null>;
}

export interface ActionRequest {
  capabilityId: CapabilityId;
  operatorId: string;
  idempotencyKey: string;
  workItemId: string | null;
  accountId: string | null;
  /** Opaque payload validated by the specific adapter */
  payload: Record<string, unknown>;
  confirmed: boolean;
}

/**
 * Server-only mutation adapter. Prefer Agent Tools; fall back to proven
 * BigBrother / legacy harper-tools only when the door is incomplete.
 */
export interface ActionAdapter {
  capabilityId: CapabilityId;
  confirmation: ConfirmationPolicy;
  provider: CapabilityGate["provider"];
  execute(request: ActionRequest): Promise<ActionReceipt>;
}

export interface IdentityMapping {
  clerkUserId: string;
  operatorId: string;
  displayName: string;
  role: OperatorRole;
  /** BigBrother / HWS actor id when known */
  externalActorId: string | null;
}

/** Assert a row never exceeds the anti-overload signal budget. */
export function assertRowSignalBudget(
  signals: WorkItemRowSignal[],
): asserts signals is WorkItemRowSignal[] {
  if (signals.length > WORK_ITEM_ROW_SIGNALS.length) {
    throw new Error(
      `Work item row exceeds ${WORK_ITEM_ROW_SIGNALS.length}-signal budget (got ${signals.length})`,
    );
  }
}
