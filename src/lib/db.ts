import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { SEED_ACCOUNTS, SEED_POLICIES, SEED_UNDERWRITERS } from "./seed";
import {
  loadSupabaseBook,
  UNASSIGNED_UNDERWRITER,
  type SupabaseBook,
} from "./supabase-book.server";
import { SEED_ACCOUNT_GRANTS, SEED_OPERATORS } from "./operators-seed";
import { SEED_INTAKE_EVENTS } from "./intake-seed";
import { SEED_TICKETS } from "./tickets-seed";
import { buildSignature } from "./signature";
import { SERVICE_MAILBOX } from "./brand";
import { AUTO_SEND_UNLOCK_AT } from "./aidesk";
import { buildTicketTitle, deriveTicketStatus } from "./tickets";
import { summarizeRequest } from "./request-summary";
import { coverageLabels, getRequestType } from "./catalog";
import {
  buildHumanHoldReply,
  buildProceedReply,
  canAutoApprove,
} from "./agent";
import { channelLabel, resolveChannel } from "./channels";
import { endOfLocalDayIso, startOfLocalDayIso } from "./dates";
import {
  renderEmailBody,
  type EmailTemplateId,
} from "./templates";
import { verifyBeforeSend } from "./verify";
import {
  buildCertificateSteps,
  buildReplySteps,
  buildSendSteps,
  type DecisionTrace,
  type TraceAuthor,
  type TraceKind,
  type TraceStep,
} from "./trace";
import type { ModelCall } from "./model";
import { AUTO_APPROVE_THRESHOLD_CENTS, loopReasonLabel } from "./types";
import type {
  Account,
  AccountDetail,
  AccountDoc,
  AccountGrant,
  IntakeEvent,
  LoopReasonId,
  Message,
  Operator,
  OversightStats,
  Policy,
  RequestTypeId,
  Thread,
  ThreadDetail,
  ThreadStatus,
  Ticket,
  TicketDetail,
  TicketSource,
  TicketStatus,
  Underwriter,
} from "./types";
import {
  fileDocument,
  attachIscSchedule,
  attachPolicyFormSet,
  getCarrierByName,
  getCarrierBySlug,
  listAdditionalInsureds,
  listCarrierForms,
  listDocuments,
  loadPolicyFormSetFromDb,
  migrateIntelligenceTables,
  syncPolicyIntelligence,
  upsertAdditionalInsured,
  type AdditionalInsuredRecord,
  type CarrierFormRecord,
  type CarrierRecord,
} from "./policy-intelligence";
import { registerPolicyFormLoader } from "./policy-store";
import {
  insertOperatorKnowledgeEntry,
  listOperatorKnowledgeEntries,
  migrateCarrierKnowledgeTable,
} from "./carrier-knowledge-store";
import {
  listAtRiskWindows,
  listRetentionEvents,
  migrateRetentionTables,
  setWindowOwner,
  setWindowValuation,
  syncDerivedLedger,
  type LedgerSyncResult,
} from "./retention/store";
import {
  assignOwner,
  auditOwnership,
  getCurrentOwner,
  listOwnerHistory,
  seedOwnershipFromServiceOwner,
} from "./retention/ownership-store";
import type { DerivedLedger } from "./retention/signals";
import type { OwnerAssignment, OwnershipViolation } from "./retention/ownership";
import type { AtRiskOutcome, AtRiskWindow, RetentionEvent } from "./retention/types";
import type {
  CarrierKnowledgeEntry,
  KnowledgeKind,
  KnowledgeSeverity,
} from "./carrier-knowledge";
import { iscParseAttachable, parseIscDec } from "./isc-intake";
import type { DeskDocument } from "./documents";
import type { QuoteSample } from "./price-guidance";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "underwriter-desk.db");

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  ensureColumn(db, "operators", "clerk_user_id", "clerk_user_id TEXT");
  migrateIntelligenceTables(db);
  migrateCarrierKnowledgeTable(db);
  migrateRetentionTables(db);
  seedIfEmpty(db);
  syncAccountsAndPolicies(db);
  syncUnderwriterChannels(db);
  syncPolicyQuoteFields(db);
  syncOperators(db);
  seedIntakeEvents(db);
  seedTickets(db);
  seedIscQuoteHistory(db);
  backfillSrNumbers(db);
  // Backfills read through the exported getters, so the handle has to be live first.
  dbInstance = db;
  backfillThreadTickets(db);
  backfillSrNumbers(db);
  syncPolicyIntelligence(db);
  registerPolicyFormLoader((policyId) => loadPolicyFormSetFromDb(db, policyId));
  backfillMessageMetadata(db);
  backfillDecisions(db);
  return db;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS underwriters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      portal TEXT,
      carrier TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dba TEXT,
      industry TEXT NOT NULL,
      address1 TEXT,
      city TEXT,
      state TEXT NOT NULL,
      zip TEXT,
      primary_uw_id TEXT NOT NULL REFERENCES underwriters(id),
      backup_uw_id TEXT REFERENCES underwriters(id),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      payment_received_at TEXT
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      policy_number TEXT NOT NULL,
      carrier TEXT NOT NULL,
      coverages_json TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      premium_cents INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      policy_id TEXT NOT NULL REFERENCES policies(id),
      underwriter_id TEXT NOT NULL REFERENCES underwriters(id),
      request_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      offered_premium_cents INTEGER,
      auto_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      premium_impact_cents INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operators (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      title TEXT NOT NULL,
      phone TEXT,
      signature TEXT NOT NULL,
      default_template TEXT NOT NULL DEFAULT 'standard',
      role TEXT NOT NULL DEFAULT 'operator',
      team TEXT
    );

    CREATE TABLE IF NOT EXISTS operator_accounts (
      operator_id TEXT NOT NULL REFERENCES operators(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      granted_by TEXT,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (operator_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS intake_events (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      from_name TEXT NOT NULL,
      from_contact TEXT NOT NULL,
      account_id TEXT,
      received_at TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      call_missed INTEGER,
      call_duration_sec INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      ticket_id TEXT,
      ack_sent_at TEXT,
      ack_body TEXT
    );

    CREATE INDEX IF NOT EXISTS intake_events_status ON intake_events(status);
    CREATE INDEX IF NOT EXISTS intake_events_account ON intake_events(account_id);

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      request_type TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_by_email TEXT,
      holder_name TEXT,
      holder_address TEXT,
      wording TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      operator_id TEXT,
      docs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_policies (
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      policy_id TEXT NOT NULL REFERENCES policies(id),
      PRIMARY KEY (ticket_id, policy_id)
    );

    CREATE TABLE IF NOT EXISTS operator_streaks (
      operator_id TEXT NOT NULL,
      request_type TEXT NOT NULL,
      clean_streak INTEGER NOT NULL DEFAULT 0,
      confirmed_total INTEGER NOT NULL DEFAULT 0,
      auto_send INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (operator_id, request_type)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      thread_id TEXT,
      message_id TEXT,
      kind TEXT NOT NULL,
      author TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS decisions_ticket ON decisions(ticket_id);
    CREATE INDEX IF NOT EXISTS decisions_message ON decisions(message_id);

    -- Address verification cache: one row per (normalized address, provider).
    -- Repeat certificate opens read the cached verdict instead of re-hitting
    -- the geocoder. Only real verdicts are cached; outages never are.
    CREATE TABLE IF NOT EXISTS address_verifications (
      address_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      matched_address TEXT,
      standardized_json TEXT,
      checked_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "underwriters", "channel_primary", "channel_primary TEXT");
  ensureColumn(db, "underwriters", "service_email", "service_email TEXT");
  ensureColumn(db, "underwriters", "channel_note", "channel_note TEXT");
  ensureColumn(db, "policies", "quote_insured_name", "quote_insured_name TEXT");
  ensureColumn(db, "policies", "quote_carrier", "quote_carrier TEXT");
  ensureColumn(db, "policies", "issuing_carrier", "issuing_carrier TEXT");
  ensureColumn(db, "threads", "operator_id", "operator_id TEXT");
  ensureColumn(db, "threads", "ticket_id", "ticket_id TEXT");

  ensureColumn(db, "messages", "subject", "subject TEXT");
  ensureColumn(db, "messages", "to_name", "to_name TEXT");
  ensureColumn(db, "messages", "to_email", "to_email TEXT");
  ensureColumn(db, "messages", "direction", "direction TEXT");
  ensureColumn(db, "messages", "party", "party TEXT");
  ensureColumn(db, "messages", "channel", "channel TEXT");
  ensureColumn(db, "messages", "loop_reason", "loop_reason TEXT");
  ensureColumn(db, "tickets", "sr_number", "sr_number TEXT");
  ensureColumn(db, "accounts", "status", "status TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "accounts", "payment_received_at", "payment_received_at TEXT");
  ensureColumn(db, "accounts", "address1", "address1 TEXT");
  ensureColumn(db, "accounts", "city", "city TEXT");
  ensureColumn(db, "accounts", "zip", "zip TEXT");
  ensureColumn(db, "tickets", "named_on_policy", "named_on_policy INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tickets", "fast_path_basis", "fast_path_basis TEXT");
  ensureColumn(db, "operators", "role", "role TEXT NOT NULL DEFAULT 'operator'");
  ensureColumn(db, "operators", "team", "team TEXT");
  ensureColumn(db, "tickets", "escalated_to", "escalated_to TEXT");
  ensureColumn(db, "tickets", "escalation_note", "escalation_note TEXT");
  ensureColumn(db, "tickets", "escalated_at", "escalated_at TEXT");
  ensureColumn(db, "tickets", "escalation_due_by", "escalation_due_by TEXT");
  ensureColumn(db, "tickets", "escalation_resolved_at", "escalation_resolved_at TEXT");
  backfillSrNumbers(db);
}

/** Assign sequential SR-##### to any ticket missing one. */
function backfillSrNumbers(db: Database.Database) {
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS tickets_sr_number_uq ON tickets(sr_number) WHERE sr_number IS NOT NULL`,
  );
  const missing = db
    .prepare(
      `SELECT id FROM tickets WHERE sr_number IS NULL OR trim(sr_number) = '' ORDER BY created_at ASC, id ASC`,
    )
    .all() as { id: string }[];
  if (missing.length === 0) return;

  const update = db.prepare(`UPDATE tickets SET sr_number = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const row of missing) {
      update.run(allocateSrNumber(db), row.id);
    }
  });
  tx();
}

function allocateSrNumber(db: Database.Database): string {
  const row = db
    .prepare(
      `SELECT sr_number FROM tickets
       WHERE sr_number IS NOT NULL AND sr_number LIKE 'SR-%'
       ORDER BY CAST(substr(sr_number, 4) AS INTEGER) DESC
       LIMIT 1`,
    )
    .get() as { sr_number: string } | undefined;
  const n = row ? Number.parseInt(row.sr_number.slice(3), 10) : 10000;
  const next = Number.isFinite(n) ? n + 1 : 10001;
  return `SR-${next}`;
}

/** Re-apply channel + contact assignments from seed (portal markets keep exception emails). */
function syncUnderwriterChannels(db: Database.Database) {
  const upsert = db.prepare(`
    INSERT INTO underwriters (
      id, name, email, phone, portal, carrier, notes,
      channel_primary, service_email, channel_note
    ) VALUES (
      @id, @name, @email, @phone, @portal, @carrier, @notes,
      @channelPrimary, @serviceEmail, @channelNote
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      portal = excluded.portal,
      carrier = excluded.carrier,
      notes = excluded.notes,
      channel_primary = excluded.channel_primary,
      service_email = excluded.service_email,
      channel_note = excluded.channel_note
  `);

  const tx = db.transaction(() => {
    for (const uw of SEED_UNDERWRITERS) {
      upsert.run({
        id: uw.id,
        name: uw.name,
        email: uw.email,
        phone: uw.phone,
        portal: uw.portal,
        carrier: uw.carrier,
        notes: uw.notes,
        channelPrimary: uw.channelPrimary,
        serviceEmail: uw.serviceEmail,
        channelNote: uw.channelNote,
      });
    }
  });
  tx();
}

function seedIfEmpty(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM accounts").get() as {
    c: number;
  };
  if (count.c > 0) return;

  const insertUw = db.prepare(`
    INSERT INTO underwriters (
      id, name, email, phone, portal, carrier, notes,
      channel_primary, service_email, channel_note
    )
    VALUES (
      @id, @name, @email, @phone, @portal, @carrier, @notes,
      @channelPrimary, @serviceEmail, @channelNote
    )
  `);
  const insertAcct = db.prepare(`
    INSERT INTO accounts (id, name, dba, industry, address1, city, state, zip, primary_uw_id, backup_uw_id, notes, status, payment_received_at)
    VALUES (@id, @name, @dba, @industry, @address1, @city, @state, @zip, @primaryUwId, @backupUwId, @notes, @status, @paymentReceivedAt)
  `);
  const insertPol = db.prepare(`
    INSERT INTO policies (
      id, account_id, policy_number, carrier, coverages_json,
      effective_date, expiration_date, premium_cents,
      quote_insured_name, quote_carrier, issuing_carrier
    )
    VALUES (
      @id, @accountId, @policyNumber, @carrier, @coveragesJson,
      @effectiveDate, @expirationDate, @premiumCents,
      @quoteInsuredName, @quoteCarrier, @issuingCarrier
    )
  `);

  const tx = db.transaction(() => {
    for (const uw of SEED_UNDERWRITERS) insertUw.run(uw);
    for (const a of SEED_ACCOUNTS) {
      insertAcct.run({
        id: a.id,
        name: a.name,
        dba: a.dba,
        industry: a.industry,
        address1: a.addressLine1,
        city: a.city,
        state: a.state,
        zip: a.zip,
        primaryUwId: a.primaryUwId,
        backupUwId: a.backupUwId,
        notes: a.notes,
        status: a.status,
        paymentReceivedAt: a.paymentReceivedAt,
      });
    }
    for (const p of SEED_POLICIES) {
      insertPol.run({
        id: p.id,
        accountId: p.accountId,
        policyNumber: p.policyNumber,
        carrier: p.carrier,
        coveragesJson: JSON.stringify(p.coverages),
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        premiumCents: p.premiumCents,
        quoteInsuredName: p.quoteInsuredName,
        quoteCarrier: p.quoteCarrier,
        issuingCarrier: p.issuingCarrier ?? null,
      });
    }
  });
  tx();
}

/** Upsert seed accounts/policies so expanding the book lands on existing DBs. */
function syncAccountsAndPolicies(
  db: Database.Database,
  bookOverride?: SupabaseBook,
) {
  const insertUw = db.prepare(`
    INSERT INTO underwriters (
      id, name, email, phone, portal, carrier, notes,
      channel_primary, service_email, channel_note
    )
    VALUES (
      @id, @name, @email, @phone, @portal, @carrier, @notes,
      @channelPrimary, @serviceEmail, @channelNote
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      portal = excluded.portal,
      carrier = excluded.carrier,
      notes = excluded.notes,
      channel_primary = excluded.channel_primary,
      service_email = excluded.service_email,
      channel_note = excluded.channel_note
  `);
  const upsertAcct = db.prepare(`
    INSERT INTO accounts (id, name, dba, industry, address1, city, state, zip, primary_uw_id, backup_uw_id, notes, status, payment_received_at)
    VALUES (@id, @name, @dba, @industry, @address1, @city, @state, @zip, @primaryUwId, @backupUwId, @notes, @status, @paymentReceivedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      dba = excluded.dba,
      industry = excluded.industry,
      address1 = excluded.address1,
      city = excluded.city,
      state = excluded.state,
      zip = excluded.zip,
      primary_uw_id = excluded.primary_uw_id,
      backup_uw_id = excluded.backup_uw_id,
      notes = excluded.notes
  `);
  // status / payment_received_at are deliberately NOT in the conflict update:
  // a runtime "Mark Payment Received" must survive the boot reseed.
  const upsertPol = db.prepare(`
    INSERT INTO policies (
      id, account_id, policy_number, carrier, coverages_json,
      effective_date, expiration_date, premium_cents,
      quote_insured_name, quote_carrier, issuing_carrier
    )
    VALUES (
      @id, @accountId, @policyNumber, @carrier, @coveragesJson,
      @effectiveDate, @expirationDate, @premiumCents,
      @quoteInsuredName, @quoteCarrier, @issuingCarrier
    )
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      policy_number = excluded.policy_number,
      carrier = excluded.carrier,
      coverages_json = excluded.coverages_json,
      effective_date = excluded.effective_date,
      expiration_date = excluded.expiration_date,
      premium_cents = excluded.premium_cents,
      quote_insured_name = excluded.quote_insured_name,
      quote_carrier = excluded.quote_carrier,
      issuing_carrier = COALESCE(policies.issuing_carrier, excluded.issuing_carrier)
  `);

  // Real-book overlay: when data/supabase-book.local.json exists, the boot
  // upsert carries the real Harper slice instead of the fictional seed.
  // Fictional rows already in the DB stay put (seeded tickets/threads
  // reference them); stale co-*/deal-* rows from older syncs are pruned.
  const book = bookOverride ?? loadSupabaseBook();
  const accounts = book ? book.accounts : SEED_ACCOUNTS;
  const policies = book ? book.policies : SEED_POLICIES;

  const tx = db.transaction(() => {
    for (const uw of SEED_UNDERWRITERS) insertUw.run(uw);
    if (book) insertUw.run(UNASSIGNED_UNDERWRITER);
    for (const a of accounts) {
      upsertAcct.run({
        id: a.id,
        name: a.name,
        dba: a.dba,
        industry: a.industry,
        address1: a.addressLine1,
        city: a.city,
        state: a.state,
        zip: a.zip,
        primaryUwId: a.primaryUwId,
        backupUwId: a.backupUwId,
        notes: a.notes,
        status: a.status,
        paymentReceivedAt: a.paymentReceivedAt,
      });
    }
    for (const p of policies) {
      upsertPol.run({
        id: p.id,
        accountId: p.accountId,
        policyNumber: p.policyNumber,
        carrier: p.carrier,
        coveragesJson: JSON.stringify(p.coverages),
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        premiumCents: p.premiumCents,
        quoteInsuredName: p.quoteInsuredName,
        quoteCarrier: p.quoteCarrier,
        issuingCarrier: p.issuingCarrier ?? null,
      });
    }
    if (book) pruneStaleBookRows(db, book.accounts, book.policies);
  });
  tx();

  // The imported book's schedules of record. Without these an imported
  // policy is `unscheduled` and its certificate prints identity only, which
  // is the whole reason the real book produced empty ACORD forms.
  if (book?.schedules) {
    for (const [policyId, set] of Object.entries(book.schedules)) {
      if (!policies.some((p) => p.id === policyId)) continue;
      attachPolicyFormSet(db, { policyId, set });
    }
  }
}

/**
 * Remove `co-` / `deal-` rows that fell out of the refreshed book. Rows with
 * desk history (threads, tickets, schedules…) are kept — the per-row delete
 * simply skips anything a foreign key still references.
 */
function pruneStaleBookRows(
  db: Database.Database,
  accounts: Account[],
  policies: Policy[],
) {
  const keepPolicies = new Set(policies.map((p) => p.id));
  const stalePolicies = (
    db.prepare(`SELECT id FROM policies WHERE id LIKE 'deal-%'`).all() as {
      id: string;
    }[]
  ).filter((r) => !keepPolicies.has(r.id));
  const deletePolicy = db.prepare(`DELETE FROM policies WHERE id = ?`);
  for (const row of stalePolicies) {
    try {
      deletePolicy.run(row.id);
    } catch {
      // Still referenced (thread / ticket / schedule) — keep it.
    }
  }

  const keepAccounts = new Set(accounts.map((a) => a.id));
  const staleAccounts = (
    db.prepare(`SELECT id FROM accounts WHERE id LIKE 'co-%'`).all() as {
      id: string;
    }[]
  ).filter((r) => !keepAccounts.has(r.id));
  const deleteAccount = db.prepare(`DELETE FROM accounts WHERE id = ?`);
  for (const row of staleAccounts) {
    try {
      deleteAccount.run(row.id);
    } catch {
      // Still referenced — keep it.
    }
  }
}

/** Keep quote named-insured / carrier fields in sync with seed (human-error demos). */
function syncPolicyQuoteFields(db: Database.Database) {
  const upsert = db.prepare(`
    UPDATE policies
    SET quote_insured_name = @quoteInsuredName,
        quote_carrier = @quoteCarrier,
        carrier = @carrier,
        policy_number = @policyNumber,
        coverages_json = @coveragesJson,
        premium_cents = @premiumCents,
        issuing_carrier = COALESCE(issuing_carrier, @issuingCarrier)
    WHERE id = @id
  `);
  const tx = db.transaction(() => {
    for (const p of SEED_POLICIES) {
      upsert.run({
        id: p.id,
        quoteInsuredName: p.quoteInsuredName,
        quoteCarrier: p.quoteCarrier,
        carrier: p.carrier,
        policyNumber: p.policyNumber,
        coveragesJson: JSON.stringify(p.coverages),
        premiumCents: p.premiumCents,
        issuingCarrier: p.issuingCarrier ?? null,
      });
    }
  });
  tx();
}

/**
 * Closed ISC 30-day-notice episodes — the desk's real pricing memory for the
 * certs@iscmga.com loop. Each thread is a complete exchange: certificate
 * emailed to the ISC certs desk, ISC quoting an endorsement charge, the desk
 * approving inside the $500 authority. Three samples is the price-guidance
 * minimum, so the desk can say "usually about $100" from history instead of
 * a hunch.
 */
function seedIscQuoteHistory(db: Database.Database) {
  const exists = db
    .prepare(`SELECT 1 FROM threads WHERE id = 'th-isc-noc-1'`)
    .get();
  if (exists) return;

  const episodes = [
    {
      id: "th-isc-noc-1",
      accountId: "acct-summit",
      policyId: "pol-summit-gl",
      policyNumber: "ISC-GL-551002",
      accountName: "Summit Window & Door Co",
      offeredCents: 100_00,
      sentAt: "2026-05-19T15:04:00.000Z",
      quotedAt: "2026-05-19T18:22:00.000Z",
    },
    {
      id: "th-isc-noc-2",
      accountId: "acct-metro",
      policyId: "pol-metro-gar",
      policyNumber: "ISC-GAR-112233",
      accountName: "Metro Towing Services Inc",
      offeredCents: 100_00,
      sentAt: "2026-06-24T14:41:00.000Z",
      quotedAt: "2026-06-24T19:03:00.000Z",
    },
    {
      id: "th-isc-noc-3",
      accountId: "acct-summit",
      policyId: "pol-summit-gl",
      policyNumber: "ISC-GL-551002",
      accountName: "Summit Window & Door Co",
      offeredCents: 125_00,
      sentAt: "2026-07-22T16:18:00.000Z",
      quotedAt: "2026-07-22T20:47:00.000Z",
    },
  ];

  const insertThread = db.prepare(
    `INSERT INTO threads (
      id, ticket_id, account_id, policy_id, underwriter_id, operator_id, request_type, subject, status,
      agent_name, offered_premium_cents, auto_approved, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, 'uw-isc-1', 'op-dakotah', 'notice_cancellation_30', ?, 'auto_approved', 'Dakotah Rice', ?, 1, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const e of episodes) {
      const subject = `[Harper] 30-Day Notice Of Cancellation — ${e.accountName} (${e.policyNumber})`;
      insertThread.run(
        e.id,
        e.accountId,
        e.policyId,
        subject,
        e.offeredCents,
        e.sentAt,
        e.quotedAt,
      );
      insertMessage(db, {
        threadId: e.id,
        role: "agent",
        body: `Hi ISC Certs Desk,\n\nPlease add a 30-Day Notice Of Cancellation endorsement in favor of the certificate holder on policy ${e.policyNumber} (${e.accountName}). The prepared certificate is attached for your file.\n\nPlease confirm any endorsement charge before issuing.\n\nDakotah Rice\nHarper Insurance`,
        subject,
        toName: "ISC Certs Desk",
        toEmail: "certs@iscmga.com",
        direction: "outbound",
        party: "underwriter",
        createdAt: e.sentAt,
      });
      const dollars = (e.offeredCents / 100).toFixed(2);
      insertMessage(db, {
        threadId: e.id,
        role: "underwriter",
        body: `Thanks for the request and the certificate. We can add the 30-Day Notice Of Cancellation endorsement to ${e.policyNumber} for an additional premium of $${dollars}. Please confirm and we will issue.`,
        premiumImpactCents: e.offeredCents,
        subject: `Re: ${subject}`,
        toName: "Dakotah Rice",
        toEmail: SERVICE_MAILBOX,
        direction: "inbound",
        party: "underwriter",
        createdAt: e.quotedAt,
      });
      insertMessage(db, {
        threadId: e.id,
        role: "agent",
        body: `Confirmed — please proceed with the endorsement at $${dollars}. Send the issued endorsement for our file when ready.`,
        subject: `Re: ${subject}`,
        toName: "ISC Certs Desk",
        toEmail: "certs@iscmga.com",
        direction: "outbound",
        party: "underwriter",
        createdAt: e.quotedAt,
      });
    }
  });
  tx();
}

function syncOperators(db: Database.Database) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO operators (
      id, display_name, email, title, phone, signature, default_template, role, team
    ) VALUES (
      @id, @displayName, @email, @title, @phone, @signature, @defaultTemplate, @role, @team
    )
  `);
  // Roles and teams are org structure, not operator-editable state — keep
  // seed rows in line even on databases created before roles existed.
  const setRole = db.prepare(
    `UPDATE operators SET role = @role, team = @team, title = @title WHERE id = @id`,
  );
  const grant = db.prepare(`
    INSERT OR IGNORE INTO operator_accounts (operator_id, account_id, granted_by, granted_at)
    VALUES (@operatorId, @accountId, 'op-dakotah', @grantedAt)
  `);
  const tx = db.transaction(() => {
    for (const o of SEED_OPERATORS) {
      insert.run({
        id: o.id,
        displayName: o.displayName,
        email: o.email,
        title: o.title,
        phone: o.phone,
        signature: o.signature,
        defaultTemplate: o.defaultTemplate,
        role: o.role,
        team: o.team,
      });
      setRole.run({ id: o.id, role: o.role, team: o.team, title: o.title });
    }
    const grantedAt = new Date().toISOString();
    for (const g of SEED_ACCOUNT_GRANTS) {
      for (const accountId of g.accountIds) {
        grant.run({ operatorId: g.operatorId, accountId, grantedAt });
      }
    }
  });
  tx();
}

/** Raw comm feed — inserted once; triage decisions survive restarts. */
function seedIntakeEvents(db: Database.Database) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO intake_events (
      id, channel, from_name, from_contact, account_id, received_at,
      subject, body, call_missed, call_duration_sec, status,
      ticket_id, ack_sent_at, ack_body
    ) VALUES (
      @id, @channel, @fromName, @fromContact, @accountId, @receivedAt,
      @subject, @body, @callMissed, @callDurationSec, 'pending',
      NULL, NULL, NULL
    )
  `);
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const e of SEED_INTAKE_EVENTS) {
      insert.run({
        id: e.id,
        channel: e.channel,
        fromName: e.fromName,
        fromContact: e.fromContact,
        accountId: e.accountId,
        receivedAt: new Date(now - e.minutesAgo * 60_000).toISOString(),
        subject: e.subject,
        body: e.body,
        callMissed: e.callMissed == null ? null : e.callMissed ? 1 : 0,
        callDurationSec: e.callDurationSec,
      });
    }
  });
  tx();
}

/** Intake feed — inserted once, then left alone so operator work survives restarts. */
function seedTickets(db: Database.Database) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tickets (
      id, account_id, request_type, title, subject, source,
      requested_by, requested_by_email, holder_name, holder_address,
      wording, status, operator_id, docs_json, created_at, updated_at, closed_at
    ) VALUES (
      @id, @accountId, @requestType, @title, @subject, @source,
      @requestedBy, @requestedByEmail, @holderName, @holderAddress,
      @wording, 'intake', NULL, @docsJson, @createdAt, @createdAt, NULL
    )
  `);
  const link = db.prepare(
    `INSERT OR IGNORE INTO ticket_policies (ticket_id, policy_id) VALUES (?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const t of SEED_TICKETS) {
      const account = db
        .prepare(`SELECT name FROM accounts WHERE id = ?`)
        .get(t.accountId) as { name: string } | undefined;
      if (!account) continue;

      insert.run({
        id: t.id,
        accountId: t.accountId,
        requestType: t.requestType,
        title: buildTicketTitle({
          requestType: t.requestType,
          holderName: t.holderName,
          accountName: account.name,
        }),
        subject: t.subject,
        source: t.source,
        requestedBy: t.requestedBy,
        requestedByEmail: t.requestedByEmail,
        holderName: t.holderName,
        holderAddress: t.holderAddress,
        wording: t.wording,
        docsJson: JSON.stringify(t.docs),
        createdAt: new Date(
          Date.now() - t.receivedMinutesAgo * 60_000,
        ).toISOString(),
      });
      for (const pid of t.policyIds) link.run(t.id, pid);
    }
  });
  tx();
}

/** Threads that predate tickets each get one, so no market email is orphaned. */
function backfillThreadTickets(db: Database.Database) {
  const orphans = db
    .prepare(`SELECT id FROM threads WHERE ticket_id IS NULL`)
    .all() as { id: string }[];
  if (orphans.length === 0) return;

  const insert = db.prepare(`
    INSERT INTO tickets (
      id, account_id, request_type, title, subject, source,
      requested_by, requested_by_email, holder_name, holder_address,
      wording, status, sr_number, operator_id, docs_json, created_at, updated_at, closed_at
    ) VALUES (
      @id, @accountId, @requestType, @title, @subject, 'internal',
      @requestedBy, NULL, @holderName, @holderAddress,
      @wording, @status, @srNumber, @operatorId, '[]', @createdAt, @updatedAt, NULL
    )
  `);
  const link = db.prepare(
    `INSERT OR IGNORE INTO ticket_policies (ticket_id, policy_id) VALUES (?, ?)`,
  );
  const stamp = db.prepare(`UPDATE threads SET ticket_id = ? WHERE id = ?`);

  const existing = db.prepare(`SELECT 1 FROM tickets WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const { id } of orphans) {
      const thread = getThreadDetail(id);
      if (!thread) continue;
      const request = summarizeRequest(thread);
      const ticketId = `tkt-${thread.id.slice(0, 8)}`;

      // A redeployed volume can already hold this ticket while the thread
      // lost its stamp (or predates stamping). Re-adopt the ticket instead
      // of re-inserting — a duplicate insert aborts the whole boot chain.
      if (existing.get(ticketId)) {
        stamp.run(ticketId, thread.id);
        continue;
      }

      insert.run({
        id: ticketId,
        accountId: thread.accountId,
        requestType: thread.requestType,
        title: buildTicketTitle({
          requestType: thread.requestType,
          holderName: request.holderName,
          accountName: thread.account.name,
        }),
        subject: thread.subject,
        requestedBy: thread.agentName,
        holderName: request.holderName || null,
        holderAddress: request.holderAddress || null,
        wording: request.wording,
        status: deriveTicketStatus("intake", [thread]),
        srNumber: allocateSrNumber(db),
        operatorId: thread.operatorId,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      });
      link.run(ticketId, thread.policyId);
      stamp.run(ticketId, thread.id);
    }
  });
  tx();
}

/** Older messages predate routing metadata — fill it in from the thread and role. */
function backfillMessageMetadata(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT m.id, m.role, t.subject, t.account_id, t.underwriter_id
       FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.direction IS NULL`,
    )
    .all() as {
    id: string;
    role: string;
    subject: string;
    account_id: string;
    underwriter_id: string;
  }[];
  if (rows.length === 0) return;

  const update = db.prepare(
    `UPDATE messages
     SET subject = @subject, to_name = @toName, to_email = @toEmail,
         direction = @direction, party = @party, channel = @channel
     WHERE id = @id`,
  );

  const tx = db.transaction(() => {
    for (const r of rows) {
      const inbound = r.role === "underwriter";
      const toClient = r.role === "client";
      const uw = inbound || !toClient ? getUnderwriter(r.underwriter_id) : null;
      const account = db
        .prepare(`SELECT name FROM accounts WHERE id = ?`)
        .get(r.account_id) as { name: string } | undefined;

      update.run({
        id: r.id,
        subject: r.subject,
        toName: toClient ? (account?.name ?? "Insured") : (uw?.name ?? "Market"),
        toEmail: toClient ? null : (uw?.email ?? null),
        direction: inbound ? "inbound" : "outbound",
        party: toClient ? "client" : "underwriter",
        channel: "email",
      });
    }
  });
  tx();
}

/**
 * Seeded and pre-trace threads have no reasoning attached. The rules are
 * deterministic, so replaying verify and route over the stored account and
 * policy reproduces the decision that was actually made at the time.
 */
function backfillDecisions(db: Database.Database) {
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM decisions`).get() as {
    c: number;
  };
  if (existing.c > 0) return;

  const desks = listUnderwriters();

  const tx = db.transaction(() => {
    for (const ticket of listTickets()) {
      const account = getAccountDetail(ticket.accountId);
      if (!account) continue;

      const ordered = ticket.threads
        .flatMap((thread) => thread.messages.map((message) => ({ message, thread })))
        .sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));

      ordered.forEach(({ message, thread }, i) => {
        const touch = i + 1;
        const operator = thread.operatorId ? getOperator(thread.operatorId) : null;

        if (message.direction === "inbound" && message.premiumImpactCents != null) {
          insertDecision(db, {
            ticketId: ticket.id,
            threadId: thread.id,
            messageId: message.id,
            kind: "reply",
            author: "ai",
            headline:
              message.premiumImpactCents === 0
                ? `No Charge From ${thread.underwriter.name}`
                : `${thread.underwriter.name} Quoted ${formatCents(message.premiumImpactCents)}`,
            summary: canAutoApprove(message.premiumImpactCents)
              ? "Inside agent authority — proceeded without asking a human."
              : "Over agent authority — parked for a human and a client relay.",
            steps: buildReplySteps({
              underwriter: thread.underwriter,
              premiumImpactCents: message.premiumImpactCents,
              autoApproved: canAutoApprove(message.premiumImpactCents),
            }),
            createdAt: message.createdAt,
          });
          return;
        }

        if (message.direction !== "outbound" || message.party !== "underwriter") {
          return;
        }

        const verify = verifyBeforeSend({
          account,
          policy: thread.policy,
          requestType: thread.requestType,
          carrierDesks: desks,
        });
        const uw = verify.matchedUw ?? thread.underwriter;
        const route = resolveChannel({
          carrier: thread.policy.carrier,
          requestType: thread.requestType,
          uwEmail: uw.email,
          uwPhone: uw.phone,
          uwPortal: uw.portal,
          serviceEmail: uw.serviceEmail,
        });

        insertDecision(db, {
          ticketId: ticket.id,
          threadId: thread.id,
          messageId: message.id,
          kind: "send",
          author: "operator",
          headline: `${route.sendEmail ? "Emailed" : "Routed To"} ${uw.name} — ${thread.policy.carrier}`,
          summary: `${getRequestType(ticket.requestType).label} on ${thread.policy.policyNumber}, ${channelLabel(route.primary).toLowerCase()}, touch ${touch}.`,
          steps: buildSendSteps({
            ticket,
            account,
            policy: thread.policy,
            candidatePolicies: ticket.policies.length
              ? ticket.policies
              : [thread.policy],
            verify,
            underwriter: uw,
            route,
            templateId: operator?.defaultTemplate ?? "standard",
            operator,
            attachments: [],
            edited: false,
            ackWarnings: verify.needsAck,
            auto: false,
            touch,
            loopReasonLabel: message.loopReason
              ? loopReasonLabel(message.loopReason)
              : null,
          }),
          createdAt: message.createdAt,
        });
      });
    }
  });
  tx();
}

/** One door for every message write, so routing metadata is never missing. */
function insertMessage(
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

/** The reasoning behind a write, recorded next to it in the same transaction. */
function insertDecision(
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

function mapUw(row: Record<string, unknown>): Underwriter {
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

function mapAccount(row: Record<string, unknown>): Account {
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

function mapPolicy(row: Record<string, unknown>): Policy {
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

function mapTicket(row: Record<string, unknown>): Ticket {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    requestType: row.request_type as RequestTypeId,
    title: row.title as string,
    subject: (row.subject as string) ?? "",
    source: row.source as TicketSource,
    requestedBy: row.requested_by as string,
    requestedByEmail: (row.requested_by_email as string | null) ?? null,
    holderName: (row.holder_name as string | null) ?? null,
    holderAddress: (row.holder_address as string | null) ?? null,
    wording: (row.wording as string) ?? "",
    namedOnPolicyRequired: Boolean(row.named_on_policy),
    fastPathBasis: (row.fast_path_basis as string | null) ?? null,
    escalatedToId: (row.escalated_to as string | null) ?? null,
    escalationNote: (row.escalation_note as string | null) ?? null,
    escalatedAt: (row.escalated_at as string | null) ?? null,
    escalationDueBy: (row.escalation_due_by as string | null) ?? null,
    escalationResolvedAt: (row.escalation_resolved_at as string | null) ?? null,
    status: row.status as TicketStatus,
    srNumber: (row.sr_number as string) || "",
    operatorId: (row.operator_id as string | null) ?? null,
    docs: JSON.parse((row.docs_json as string) ?? "[]") as AccountDoc[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
  };
}

function mapThread(row: Record<string, unknown>): Thread {
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

function mapOperator(row: Record<string, unknown>): Operator {
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

function mapMessage(row: Record<string, unknown>): Message {
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

export function searchAccounts(query: string): AccountDetail[] {
  const db = getDb();
  const q = `%${query.trim().toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT * FROM accounts
       WHERE lower(name) LIKE ? OR lower(coalesce(dba,'')) LIKE ? OR lower(industry) LIKE ?
       ORDER BY name LIMIT 25`,
    )
    .all(q, q, q) as Record<string, unknown>[];

  if (!query.trim()) {
    const all = db
      .prepare(`SELECT * FROM accounts ORDER BY name`)
      .all() as Record<string, unknown>[];
    return all.map((r) => getAccountDetail(r.id as string)!);
  }

  return rows.map((r) => getAccountDetail(r.id as string)!);
}

export function listAccounts(): AccountDetail[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id FROM accounts ORDER BY name`)
    .all() as { id: string }[];
  return rows.map((r) => getAccountDetail(r.id)!);
}

/** Payment landed — the account moves from pre-bind into active service. */
export function markAccountPaymentReceived(accountId: string): void {
  getDb()
    .prepare(
      `UPDATE accounts SET status = 'active', payment_received_at = ? WHERE id = ?`,
    )
    .run(new Date().toISOString(), accountId);
}

export function getUnderwriter(id: string): Underwriter | null {
  const row = getDb()
    .prepare(`SELECT * FROM underwriters WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapUw(row) : null;
}

export function getAccountDetail(id: string): AccountDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  const account = mapAccount(row);
  const primaryUw = getUnderwriter(account.primaryUwId)!;
  const backupUw = account.backupUwId
    ? getUnderwriter(account.backupUwId)
    : null;
  const policies = (
    db
      .prepare(`SELECT * FROM policies WHERE account_id = ? ORDER BY carrier, id`)
      .all(id) as Record<string, unknown>[]
  ).map(mapPolicy);
  const threads = (
    db
      .prepare(
        `SELECT * FROM threads WHERE account_id = ? ORDER BY updated_at DESC`,
      )
      .all(id) as Record<string, unknown>[]
  ).map(mapThread);

  return { ...account, primaryUw, backupUw, policies, threads };
}

export function updateUnderwriter(
  id: string,
  patch: Partial<Pick<Underwriter, "name" | "email" | "phone" | "portal" | "notes">>,
): Underwriter {
  const db = getDb();
  const current = getUnderwriter(id);
  if (!current) throw new Error("Underwriter not found");

  const next = { ...current, ...patch };
  db.prepare(
    `UPDATE underwriters SET name = ?, email = ?, phone = ?, portal = ?, notes = ? WHERE id = ?`,
  ).run(next.name, next.email, next.phone, next.portal, next.notes, id);
  return next;
}

export function listUnderwriters(): Underwriter[] {
  const rows = getDb()
    .prepare(`SELECT * FROM underwriters ORDER BY carrier, name`)
    .all() as Record<string, unknown>[];
  return rows.map(mapUw);
}

export function getOperator(id: string): Operator | null {
  const row = getDb()
    .prepare(`SELECT * FROM operators WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

export function getOperatorByClerkUserId(clerkUserId: string): Operator | null {
  const row = getDb()
    .prepare(`SELECT * FROM operators WHERE clerk_user_id = ?`)
    .get(clerkUserId) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

export function getOperatorByEmail(email: string): Operator | null {
  const row = getDb()
    .prepare(`SELECT * FROM operators WHERE lower(email) = lower(?)`)
    .get(email) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

/**
 * First Clerk sign-in creates (or links) a desk operator so drafts keep a
 * stable signature + streak history.
 */
export function ensureOperatorForClerkUser(input: {
  clerkUserId: string;
  email: string;
  displayName: string;
}): Operator {
  const existing = getOperatorByClerkUserId(input.clerkUserId);
  if (existing) return existing;

  const db = getDb();
  const byEmail = input.email ? getOperatorByEmail(input.email) : null;
  if (byEmail) {
    db.prepare(`UPDATE operators SET clerk_user_id = ? WHERE id = ?`).run(
      input.clerkUserId,
      byEmail.id,
    );
    return getOperator(byEmail.id)!;
  }

  const id = `op-${randomUUID().slice(0, 8)}`;
  const displayName = input.displayName.trim() || "Operator";
  const email = input.email.trim() || `${id}@harperinsure.com`;
  const title = "Commercial Lines Service";
  const signature = buildSignature({
    displayName,
    title,
    email,
    phone: null,
  });

  db.prepare(
    `INSERT INTO operators (
      id, clerk_user_id, display_name, email, title, phone, signature, default_template
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'standard')`,
  ).run(id, input.clerkUserId, displayName, email, title, signature);

  return getOperator(id)!;
}

export function listOperators(): Operator[] {
  return (
    getDb()
      .prepare(`SELECT * FROM operators ORDER BY display_name`)
      .all() as Record<string, unknown>[]
  ).map(mapOperator);
}

export function updateOperator(
  id: string,
  patch: {
    displayName: string;
    email: string;
    title: string;
    phone: string | null;
    signature: string;
    defaultTemplate: Operator["defaultTemplate"];
  },
): Operator {
  getDb()
    .prepare(
      `UPDATE operators SET
        display_name = ?, email = ?, title = ?, phone = ?,
        signature = ?, default_template = ?
       WHERE id = ?`,
    )
    .run(
      patch.displayName,
      patch.email,
      patch.title,
      patch.phone,
      patch.signature,
      patch.defaultTemplate,
      id,
    );
  const op = getOperator(id);
  if (!op) throw new Error("Operator not found");
  return op;
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

// ————————————————— Tickets —————————————————

export function getTicketDetail(idOrSr: string): TicketDetail | null {
  const db = getDb();
  let row = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(idOrSr) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    const sr = idOrSr.trim().toUpperCase().replace(/^#/, "");
    row = db
      .prepare(`SELECT * FROM tickets WHERE upper(sr_number) = ?`)
      .get(sr) as Record<string, unknown> | undefined;
  }
  if (!row) return null;

  const ticket = mapTicket(row);
  const id = ticket.id;
  const account = getAccountDetail(ticket.accountId);
  if (!account) return null;
  const policies = (
    db
      .prepare(
        `SELECT p.* FROM policies p
         JOIN ticket_policies tp ON tp.policy_id = p.id
         WHERE tp.ticket_id = ?
         ORDER BY p.effective_date DESC`,
      )
      .all(id) as Record<string, unknown>[]
  ).map(mapPolicy);
  const threadIds = db
    .prepare(`SELECT id FROM threads WHERE ticket_id = ? ORDER BY created_at ASC`)
    .all(id) as { id: string }[];
  const threads = threadIds
    .map((t) => getThreadDetail(t.id))
    .filter((t): t is ThreadDetail => t != null);

  return { ...ticket, account, policies, threads };
}

export function listTickets(filters?: {
  status?: TicketStatus | "all";
  requestType?: RequestTypeId | "all";
  source?: TicketSource | "all";
  operatorId?: string;
  /** Unassigned only — the grab pile */
  unclaimedOnly?: boolean;
  openOnly?: boolean;
  q?: string;
}): TicketDetail[] {
  const db = getDb();
  let sql = `SELECT t.id FROM tickets t
    JOIN accounts a ON a.id = t.account_id
    WHERE 1=1`;
  const params: string[] = [];

  if (filters?.status && filters.status !== "all") {
    sql += ` AND t.status = ?`;
    params.push(filters.status);
  }
  if (filters?.requestType && filters.requestType !== "all") {
    sql += ` AND t.request_type = ?`;
    params.push(filters.requestType);
  }
  if (filters?.source && filters.source !== "all") {
    sql += ` AND t.source = ?`;
    params.push(filters.source);
  }
  if (filters?.operatorId) {
    sql += ` AND t.operator_id = ?`;
    params.push(filters.operatorId);
  }
  if (filters?.unclaimedOnly) {
    sql += ` AND t.operator_id IS NULL`;
  }
  if (filters?.openOnly) {
    sql += ` AND t.status NOT IN ('delivered', 'closed')`;
  }
  if (filters?.q?.trim()) {
    const raw = filters.q.trim();
    const q = `%${raw.toLowerCase()}%`;
    const sr = raw.toUpperCase().replace(/^#/, "");
    sql += ` AND (
      lower(a.name) LIKE ? OR lower(coalesce(a.dba, '')) LIKE ?
      OR lower(t.title) LIKE ? OR lower(t.subject) LIKE ?
      OR lower(coalesce(t.holder_name, '')) LIKE ? OR lower(t.requested_by) LIKE ?
      OR upper(coalesce(t.sr_number, '')) = ? OR upper(coalesce(t.sr_number, '')) LIKE ?
    )`;
    params.push(q, q, q, q, q, q, sr, `%${sr}%`);
  }

  sql += ` ORDER BY t.created_at ASC`;
  const ids = db.prepare(sql).all(...params) as { id: string }[];
  return ids
    .map((r) => getTicketDetail(r.id))
    .filter((t): t is TicketDetail => t != null);
}

export function createTicket(input: {
  accountId: string;
  policyIds: string[];
  requestType: RequestTypeId;
  source: TicketSource;
  requestedBy: string;
  requestedByEmail?: string | null;
  subject?: string;
  holderName?: string | null;
  holderAddress?: string | null;
  wording: string;
  namedOnPolicyRequired?: boolean;
  operatorId: string | null;
}): TicketDetail {
  const db = getDb();
  const account = getAccountDetail(input.accountId);
  if (!account) throw new Error("Account not found");
  if (input.policyIds.length === 0) {
    throw new Error("Pick at least one policy for the ticket");
  }

  const id = `tkt-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const srNumber = allocateSrNumber(db);
  const title = buildTicketTitle({
    requestType: input.requestType,
    holderName: input.holderName,
    accountName: account.name,
  });

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tickets (
        id, account_id, request_type, title, subject, source,
        requested_by, requested_by_email, holder_name, holder_address,
        wording, named_on_policy, status, sr_number, operator_id, docs_json, created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?, '[]', ?, ?, NULL)`,
    ).run(
      id,
      input.accountId,
      input.requestType,
      title,
      input.subject?.trim() || title,
      input.source,
      input.requestedBy,
      input.requestedByEmail ?? null,
      input.holderName ?? null,
      input.holderAddress ?? null,
      input.wording,
      input.namedOnPolicyRequired ? 1 : 0,
      srNumber,
      input.operatorId,
      now,
      now,
    );
    const link = db.prepare(
      `INSERT OR IGNORE INTO ticket_policies (ticket_id, policy_id) VALUES (?, ?)`,
    );
    for (const pid of input.policyIds) link.run(id, pid);
  });
  tx();

  return getTicketDetail(id)!;
}

export function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
): TicketDetail {
  const db = getDb();
  const now = new Date().toISOString();
  const closed = status === "delivered" || status === "closed";
  db.prepare(
    `UPDATE tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
  ).run(status, now, closed ? now : null, ticketId);
  return getTicketDetail(ticketId)!;
}

/**
 * The blanket fast path: the schedule of record already grants this by
 * blanket endorsement and the holder accepts wording — the cert issues
 * without a market email. The reason and the exact form land in the trace.
 */
export function applyBlanketFastPath(
  ticketId: string,
  input: {
    basis: string;
    form: { form: string; edition: string; title: string };
    policyNumber: string;
    requestLabel: string;
  },
): TicketDetail {
  const db = getDb();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tickets SET status = 'ready_to_issue', fast_path_basis = ?, updated_at = ? WHERE id = ?`,
    ).run(input.basis, now, ticketId);

    insertDecision(db, {
      ticketId,
      kind: "certificate",
      author: "ai",
      headline: "Blanket Fast Path — No Market Touch",
      summary: `${input.requestLabel} satisfied by ${input.form.form} ${input.form.edition} already on ${input.policyNumber}. Certificate issues on wording alone; no quote needed.`,
      steps: [
        {
          id: "blanket-check",
          label: "Blanket Check",
          rule: "If the schedule of record carries a blanket endorsement of the requested kind and the holder accepts wording, skip the market and go straight to issue.",
          inputs: [
            { label: "Request", value: input.requestLabel },
            {
              label: "Form On Policy",
              value: `${input.form.form} ${input.form.edition} — ${input.form.title}`,
            },
            { label: "Policy", value: input.policyNumber },
            { label: "Holder Requires Named On Policy", value: "No" },
          ],
          outcome: "Ready To Issue — wording only, no quote needed.",
          verdict: "ok",
          source: "rule",
        },
      ],
      createdAt: now,
    });
  });
  tx();

  return getTicketDetail(ticketId)!;
}

export function claimTicket(ticketId: string, operatorId: string): TicketDetail {
  const db = getDb();
  db.prepare(
    `UPDATE tickets SET operator_id = ?, updated_at = ? WHERE id = ?`,
  ).run(operatorId, new Date().toISOString(), ticketId);
  return getTicketDetail(ticketId)!;
}

/** Pull ticket status back in line with the threads underneath it. */
export function syncTicketStatus(ticketId: string | null): void {
  if (!ticketId) return;
  const ticket = getTicketDetail(ticketId);
  if (!ticket) return;
  const next = deriveTicketStatus(ticket.status, ticket.threads);
  if (next === ticket.status) return;
  getDb()
    .prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`)
    .run(next, new Date().toISOString(), ticketId);
}

// ————————————————— Auto-Send Unlock —————————————————

export interface OperatorStreak {
  operatorId: string;
  requestType: RequestTypeId;
  cleanStreak: number;
  confirmedTotal: number;
  autoSend: boolean;
}

function mapStreak(row: Record<string, unknown>): OperatorStreak {
  return {
    operatorId: row.operator_id as string,
    requestType: row.request_type as RequestTypeId,
    cleanStreak: row.clean_streak as number,
    confirmedTotal: row.confirmed_total as number,
    autoSend: Boolean(row.auto_send),
  };
}

export function getStreak(
  operatorId: string,
  requestType: RequestTypeId,
): OperatorStreak {
  const row = getDb()
    .prepare(
      `SELECT * FROM operator_streaks WHERE operator_id = ? AND request_type = ?`,
    )
    .get(operatorId, requestType) as Record<string, unknown> | undefined;
  return row
    ? mapStreak(row)
    : {
        operatorId,
        requestType,
        cleanStreak: 0,
        confirmedTotal: 0,
        autoSend: false,
      };
}

export function listStreaks(operatorId: string): OperatorStreak[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM operator_streaks WHERE operator_id = ? ORDER BY confirmed_total DESC`,
      )
      .all(operatorId) as Record<string, unknown>[]
  ).map(mapStreak);
}

/**
 * A send with no edits and no overridden warnings is clean. Enough of those in
 * a row and this request type stops needing a human on the button.
 */
export function recordSendOutcome(input: {
  operatorId: string;
  requestType: RequestTypeId;
  clean: boolean;
}): OperatorStreak {
  const db = getDb();
  const prev = getStreak(input.operatorId, input.requestType);
  const cleanStreak = input.clean ? prev.cleanStreak + 1 : 0;
  const confirmedTotal = prev.confirmedTotal + 1;
  const autoSend = prev.autoSend || cleanStreak >= AUTO_SEND_UNLOCK_AT;

  db.prepare(
    `INSERT INTO operator_streaks (
       operator_id, request_type, clean_streak, confirmed_total, auto_send, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(operator_id, request_type) DO UPDATE SET
       clean_streak = excluded.clean_streak,
       confirmed_total = excluded.confirmed_total,
       auto_send = excluded.auto_send,
       updated_at = excluded.updated_at`,
  ).run(
    input.operatorId,
    input.requestType,
    cleanStreak,
    confirmedTotal,
    autoSend ? 1 : 0,
    new Date().toISOString(),
  );

  return { ...prev, cleanStreak, confirmedTotal, autoSend };
}

/** Revocable in one click — trust is granted, never permanent. */
export function setAutoSend(
  operatorId: string,
  requestType: RequestTypeId,
  on: boolean,
): OperatorStreak {
  const db = getDb();
  const prev = getStreak(operatorId, requestType);
  db.prepare(
    `INSERT INTO operator_streaks (
       operator_id, request_type, clean_streak, confirmed_total, auto_send, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(operator_id, request_type) DO UPDATE SET
       auto_send = excluded.auto_send,
       clean_streak = excluded.clean_streak,
       updated_at = excluded.updated_at`,
  ).run(
    operatorId,
    requestType,
    on ? prev.cleanStreak : 0,
    prev.confirmedTotal,
    on ? 1 : 0,
    new Date().toISOString(),
  );
  return { ...prev, autoSend: on, cleanStreak: on ? prev.cleanStreak : 0 };
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

function formatCents(cents: number | null): string {
  if (cents == null) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
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

/** Reset DB for demos — deletes file and reconnects. */
export function resetDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  getDb();
}

// ——— Policy intelligence public API ———

// ————————————————— Carrier Knowledge —————————————————

/** Operator-added knowledge entries for one carrier (never enforceable). */
export function listOperatorCarrierKnowledge(
  carrier?: string,
): CarrierKnowledgeEntry[] {
  return listOperatorKnowledgeEntries(getDb(), carrier);
}

/**
 * File a knowledge entry the desk just learned. Renders as a card on the
 * carrier page immediately; it can warn but never hard-block — enforcement
 * rules move into the committed registry through code review.
 */
export function addOperatorCarrierKnowledge(input: {
  carrier: string;
  writingCompany?: string | null;
  coverageLine?: string | null;
  industryVertical?: string | null;
  state?: string | null;
  kind: KnowledgeKind;
  severity: Extract<KnowledgeSeverity, "warning" | "note">;
  title: string;
  detail: string;
  consequence?: string | null;
  source: string;
  createdBy?: string | null;
}): CarrierKnowledgeEntry {
  return insertOperatorKnowledgeEntry(getDb(), input);
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

export function getCarrierDesk(slug: string): {
  carrier: CarrierRecord;
  forms: CarrierFormRecord[];
  policies: Policy[];
  documents: DeskDocument[];
} | null {
  const db = getDb();
  const carrier = getCarrierBySlug(db, slug);
  if (!carrier) return null;
  const forms = listCarrierForms(db, carrier.id);
  const policies = (
    db
      .prepare(`SELECT * FROM policies WHERE lower(carrier) = lower(?)`)
      .all(carrier.name) as Record<string, unknown>[]
  ).map(mapPolicy);
  const documents = listDocuments(db, { carrierId: carrier.id });
  return { carrier, forms, policies, documents };
}

export function getTicketDocuments(ticketId: string): DeskDocument[] {
  return listDocuments(getDb(), { ticketId });
}

export function getAccountDocuments(accountId: string): DeskDocument[] {
  return listDocuments(getDb(), { accountId });
}

export function getAccountAdditionalInsureds(
  accountId: string,
): AdditionalInsuredRecord[] {
  return listAdditionalInsureds(getDb(), accountId);
}

export function fileAccountDocument(input: {
  accountId: string;
  accountName: string;
  policyId?: string | null;
  ticketId?: string | null;
  originalName: string;
  bytes?: Buffer | null;
  trusted?: boolean;
  kindHint?: DeskDocument["kind"];
}): DeskDocument {
  return fileDocument(getDb(), input);
}

export function getCarrierSlugForName(name: string): string | null {
  return getCarrierByName(getDb(), name)?.slug ?? null;
}

/**
 * ISC portal intake: parse pasted dec/schedule text, file it as the source
 * document, and attach the extracted schedule of record to the policy.
 * Server-side re-parse — the client preview is advisory only. Throws when
 * the parse fails the accuracy gate (no writer, nothing recognized, or a
 * policy-number mismatch).
 */
export function ingestIscScheduleFromPaste(input: {
  policyId: string;
  text: string;
}): {
  writer: string | null;
  coverages: number;
  limits: number;
  endorsements: number;
  documentId: string;
} {
  const db = getDb();
  const policy = db
    .prepare(`SELECT * FROM policies WHERE id = ?`)
    .get(input.policyId) as Record<string, unknown> | undefined;
  if (!policy) throw new Error("Policy not found.");
  const mapped = mapPolicy(policy);
  if (mapped.carrier.trim().toLowerCase() !== "isc") {
    throw new Error("ISC intake only attaches to ISC (MGA) paper.");
  }
  const account = db
    .prepare(`SELECT id, name FROM accounts WHERE id = ?`)
    .get(mapped.accountId) as { id: string; name: string } | undefined;
  if (!account) throw new Error("Account not found.");

  const parsed = parseIscDec(input.text);
  const gate = iscParseAttachable(parsed, mapped.policyNumber);
  if (!gate.ok) throw new Error(gate.reason ?? "Parse failed.");

  const doc = fileDocument(db, {
    accountId: account.id,
    accountName: account.name,
    policyId: mapped.id,
    originalName: `ISC portal schedule ${mapped.policyNumber}.txt`,
    bytes: Buffer.from(input.text, "utf-8"),
    trusted: true,
    kindHint: "policy",
  });

  attachIscSchedule(db, {
    policyId: mapped.id,
    parsed,
    sourceDocumentId: doc.id,
  });

  return {
    writer: parsed.writer,
    coverages: parsed.coverages.length,
    limits: parsed.limits.length,
    endorsements: parsed.endorsements.length,
    documentId: doc.id,
  };
}

// ————————————————— Roles, Grants & Escalation —————————————————

/** Every grant on the desk — the manager's assignment board reads this. */
export function listAccountGrants(): AccountGrant[] {
  return (
    getDb()
      .prepare(`SELECT * FROM operator_accounts ORDER BY granted_at ASC`)
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    operatorId: row.operator_id as string,
    accountId: row.account_id as string,
    grantedBy: (row.granted_by as string | null) ?? null,
    grantedAt: row.granted_at as string,
  }));
}

/** Account ids this operator can see. Managers see the whole book — callers check role first. */
export function listOperatorAccountIds(operatorId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT account_id FROM operator_accounts WHERE operator_id = ? ORDER BY account_id`,
      )
      .all(operatorId) as { account_id: string }[]
  ).map((r) => r.account_id);
}

export function grantAccountAccess(input: {
  operatorId: string;
  accountId: string;
  grantedBy: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO operator_accounts (operator_id, account_id, granted_by, granted_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.operatorId,
      input.accountId,
      input.grantedBy,
      new Date().toISOString(),
    );
}

export function revokeAccountAccess(operatorId: string, accountId: string): void {
  getDb()
    .prepare(
      `DELETE FROM operator_accounts WHERE operator_id = ? AND account_id = ?`,
    )
    .run(operatorId, accountId);
}

export function setOperatorRole(
  operatorId: string,
  role: Operator["role"],
): void {
  getDb()
    .prepare(`UPDATE operators SET role = ? WHERE id = ?`)
    .run(role, operatorId);
}

/**
 * Flag a ticket up for help. The promise is explicit: unless the flagger
 * says otherwise, the manager gets to it by end of the flagging day.
 */
export function escalateTicket(input: {
  ticketId: string;
  toOperatorId: string;
  note: string;
  dueBy?: string | null;
}): TicketDetail {
  const now = new Date();
  // Default promise: the manager gets to it by end of the flagging day.
  const dueBy = input.dueBy ?? endOfLocalDayIso();
  getDb()
    .prepare(
      `UPDATE tickets SET
        escalated_to = ?, escalation_note = ?, escalated_at = ?,
        escalation_due_by = ?, escalation_resolved_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.toOperatorId,
      input.note,
      now.toISOString(),
      dueBy,
      now.toISOString(),
      input.ticketId,
    );
  return getTicketDetail(input.ticketId)!;
}

export function resolveEscalation(ticketId: string): TicketDetail {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE tickets SET escalation_resolved_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, ticketId);
  return getTicketDetail(ticketId)!;
}

/** Open escalations, oldest promise first — the manager's help inbox. */
export function listEscalatedTickets(toOperatorId?: string): TicketDetail[] {
  const db = getDb();
  const rows = (
    toOperatorId
      ? db
          .prepare(
            `SELECT id FROM tickets
             WHERE escalated_to = ? AND escalation_resolved_at IS NULL
             ORDER BY escalation_due_by ASC, escalated_at ASC`,
          )
          .all(toOperatorId)
      : db
          .prepare(
            `SELECT id FROM tickets
             WHERE escalated_to IS NOT NULL AND escalation_resolved_at IS NULL
             ORDER BY escalation_due_by ASC, escalated_at ASC`,
          )
          .all()
  ) as { id: string }[];
  return rows
    .map((r) => getTicketDetail(r.id))
    .filter((t): t is TicketDetail => t != null);
}

// ————————————————— Comm Intake —————————————————

function mapIntakeEvent(row: Record<string, unknown>): IntakeEvent {
  return {
    id: row.id as string,
    channel: row.channel as IntakeEvent["channel"],
    fromName: row.from_name as string,
    fromContact: row.from_contact as string,
    accountId: (row.account_id as string | null) ?? null,
    receivedAt: row.received_at as string,
    subject: (row.subject as string | null) ?? null,
    body: row.body as string,
    callMissed: row.call_missed == null ? null : Boolean(row.call_missed),
    callDurationSec: (row.call_duration_sec as number | null) ?? null,
    status: row.status as IntakeEvent["status"],
    ticketId: (row.ticket_id as string | null) ?? null,
    ackSentAt: (row.ack_sent_at as string | null) ?? null,
    ackBody: (row.ack_body as string | null) ?? null,
  };
}

export function listIntakeEvents(
  status?: IntakeEvent["status"],
): IntakeEvent[] {
  const db = getDb();
  const rows = (
    status
      ? db
          .prepare(
            `SELECT * FROM intake_events WHERE status = ? ORDER BY received_at DESC`,
          )
          .all(status)
      : db
          .prepare(`SELECT * FROM intake_events ORDER BY received_at DESC`)
          .all()
  ) as Record<string, unknown>[];
  return rows.map(mapIntakeEvent);
}

export function getIntakeEvent(id: string): IntakeEvent | null {
  const row = getDb()
    .prepare(`SELECT * FROM intake_events WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapIntakeEvent(row) : null;
}

export function dismissIntakeEvent(id: string): void {
  getDb()
    .prepare(`UPDATE intake_events SET status = 'dismissed' WHERE id = ?`)
    .run(id);
}

/** Link an intake event to a ticket — 'ticketed' created it, 'merged' joined it. */
export function attachIntakeToTicket(input: {
  intakeId: string;
  ticketId: string;
  merged: boolean;
}): void {
  getDb()
    .prepare(`UPDATE intake_events SET status = ?, ticket_id = ? WHERE id = ?`)
    .run(input.merged ? "merged" : "ticketed", input.ticketId, input.intakeId);
}

/** Record the service-inbox acknowledgment exactly as sent — the audit trail. */
export function recordIntakeAck(intakeId: string, ackBody: string): void {
  getDb()
    .prepare(`UPDATE intake_events SET ack_sent_at = ?, ack_body = ? WHERE id = ?`)
    .run(new Date().toISOString(), ackBody, intakeId);
}

// ————————————————— Address Verification Cache —————————————————

/**
 * Cached verdict for one (normalized address, provider) pair. Repeat
 * certificate opens read this instead of re-hitting the geocoder. The
 * provider is part of the key so a Census verdict is never re-labeled as
 * Google when a GOOGLE_MAPS_API_KEY appears later.
 */
export interface CachedAddressVerification {
  provider: string;
  status: string;
  reason: string;
  matchedAddress: string | null;
  standardizedJson: string | null;
  checkedAt: string;
}

export function getCachedAddressVerification(
  addressKey: string,
): CachedAddressVerification | null {
  const row = getDb()
    .prepare(`SELECT * FROM address_verifications WHERE address_key = ?`)
    .get(addressKey) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    provider: row.provider as string,
    status: row.status as string,
    reason: row.reason as string,
    matchedAddress: (row.matched_address as string | null) ?? null,
    standardizedJson: (row.standardized_json as string | null) ?? null,
    checkedAt: row.checked_at as string,
  };
}

export function saveAddressVerification(
  addressKey: string,
  v: Omit<CachedAddressVerification, "checkedAt">,
): void {
  getDb()
    .prepare(
      `INSERT INTO address_verifications
         (address_key, provider, status, reason, matched_address, standardized_json, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address_key) DO UPDATE SET
         provider = excluded.provider,
         status = excluded.status,
         reason = excluded.reason,
         matched_address = excluded.matched_address,
         standardized_json = excluded.standardized_json,
         checked_at = excluded.checked_at`,
    )
    .run(
      addressKey,
      v.provider,
      v.status,
      v.reason,
      v.matchedAddress,
      v.standardizedJson,
      new Date().toISOString(),
    );
}

export type {
  AdditionalInsuredRecord,
  CarrierFormRecord,
  CarrierRecord,
  DeskDocument,
};

/**
 * Replace the book in the open database with one fetched at runtime.
 *
 * Same write path as boot — the upsert, the prune of rows that fell out of
 * the book, and the schedules of record — so a refresh from Harper lands
 * exactly where an imported overlay does and cannot drift from it.
 */
export function applyBook(book: SupabaseBook): void {
  syncAccountsAndPolicies(getDb(), book);
}

// ————————————————— Retention Ledger —————————————————

/**
 * Persist a ledger derived from `lifecycle.signals` and carrier notices.
 * Idempotent on the derived window id, so a re-sync reconciles rather than
 * duplicating.
 */
export function applyRetentionLedger(derived: DerivedLedger): LedgerSyncResult {
  return syncDerivedLedger(getDb(), derived);
}

export function listRetentionWindows(
  filter: {
    accountId?: string;
    outcome?: AtRiskOutcome;
    openedFrom?: string;
    openedTo?: string;
  } = {},
): AtRiskWindow[] {
  return listAtRiskWindows(getDb(), filter);
}

export function listRetentionWindowEvents(windowId?: string): RetentionEvent[] {
  return listRetentionEvents(getDb(), windowId);
}

/** Attach premium and carrier rate so a save on this window can be valued. */
export function valueRetentionWindow(
  windowId: string,
  valuation: {
    premiumCents: number | null;
    commissionRateBps: number | null;
    commissionAtRiskCents: number | null;
    replacementCommissionCents?: number | null;
  },
): void {
  setWindowValuation(getDb(), windowId, valuation);
}

export function setRetentionWindowOwner(
  windowId: string,
  ownerAgentId: string | null,
): void {
  setWindowOwner(getDb(), windowId, ownerAgentId);
}

// ————————————————— Account Owner Of Record —————————————————

export function getAccountOwner(accountId: string): OwnerAssignment | null {
  return getCurrentOwner(getDb(), accountId);
}

export function listAccountOwnerHistory(accountId?: string): OwnerAssignment[] {
  return listOwnerHistory(getDb(), accountId);
}

/**
 * Move ownership of an account. Every move is recorded with a reason — an
 * unexplained reassignment is how ownership quietly evaporates under load.
 */
export function reassignAccountOwner(input: {
  accountId: string;
  ownerAgentId: string | null;
  ownerDisplayName: string | null;
  reason: OwnerAssignment["reason"];
  assignedBy?: string | null;
  note?: string | null;
}): OwnerAssignment {
  return assignOwner(getDb(), input);
}

export function seedAccountOwners(
  rows: {
    accountId: string;
    serviceOwnerAgentId: string | null;
    serviceOwnerName: string | null;
    since?: string;
  }[],
): { seeded: number; orphans: number } {
  return seedOwnershipFromServiceOwner(getDb(), rows);
}

/** No-orphan rule check: orphans, double owners, and overlapping history. */
export function auditAccountOwnership(): OwnershipViolation[] {
  return auditOwnership(getDb());
}
