import type Database from "better-sqlite3";
import { canAutoApprove } from "../threads/agent";
import { SERVICE_MAILBOX } from "../brand";
import { getRequestType } from "../catalog";
import { channelLabel, resolveChannel } from "../threads/channels";
import { SEED_INTAKE_EVENTS } from "../intake/intake-seed";
import { SEED_ACCOUNT_GRANTS, SEED_OPERATORS } from "../session/operators-seed";
import { summarizeRequest } from "../threads/request-summary";
import { SEED_ACCOUNTS, SEED_POLICIES, SEED_UNDERWRITERS } from "../seed";
import {
  loadSupabaseBook,
  UNASSIGNED_UNDERWRITER,
  type BookContactKey,
  type BookOrder,
  type BookServiceNoteEntry,
} from "../supabase-book.server";
import {
  META_COMPANY_DETAILS_SYNCED_AT,
  META_SERVICE_NOTES_SYNCED_AT,
  writeBookMeta,
} from "./book-meta";
import { carrierKeyFromName } from "../carrier-filter";
import { SEED_TICKETS } from "../tickets/tickets-seed";
import { buildTicketTitle, deriveTicketStatus } from "../tickets/tickets";
import { buildReplySteps, buildSendSteps } from "../threads/trace";
import { loopReasonLabel } from "../types";
import type { Account, Policy } from "../types";
import { verifyBeforeSend } from "../threads/verify";
import { formatCents } from "./mappers";
import { allocateSrNumber } from "./migrate";
import {
  getAccountDetail,
  getUnderwriter,
  listUnderwriters,
} from "./queries/accounts";
import { insertDecision } from "./queries/decisions";
import { getOperator } from "./queries/operators";
import { listTickets } from "./queries/tickets";
import { getThreadDetail, insertMessage } from "./queries/threads";

/** Re-apply channel + contact assignments from seed (portal markets keep exception emails). */
export function syncUnderwriterChannels(db: Database.Database) {
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

export function seedIfEmpty(db: Database.Database) {
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
export function syncAccountsAndPolicies(db: Database.Database) {
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
  const upsertOrder = db.prepare(`
    INSERT INTO book_orders (
      id, account_id, harper_order_id, created_at, ordered_at, event_at,
      bind_status, revenue_cents, revenue_micros, rich_json,
      policy_numbers_json, inconsistency, source,
      iq_stage_tag, broker_gate, broker_gate_at,
      producer_id, producer_name
    )
    VALUES (
      @id, @accountId, @harperOrderId, @createdAt, @orderedAt, @eventAt,
      @bindStatus, @revenueCents, @revenueMicros, @richJson,
      @policyNumbersJson, @inconsistency, @source,
      @iqStageTag, @brokerGate, @brokerGateAt,
      @producerId, @producerName
    )
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      harper_order_id = excluded.harper_order_id,
      -- orders_temp.created_at never changes, so a snapshot that predates the
      -- field (or a boot from an older one) must not blank a known timestamp
      -- and leave the previews reading "Age unavailable".
      created_at = COALESCE(excluded.created_at, book_orders.created_at),
      ordered_at = excluded.ordered_at,
      event_at = excluded.event_at,
      bind_status = excluded.bind_status,
      revenue_cents = excluded.revenue_cents,
      revenue_micros = excluded.revenue_micros,
      rich_json = excluded.rich_json,
      policy_numbers_json = excluded.policy_numbers_json,
      inconsistency = excluded.inconsistency,
      source = excluded.source,
      iq_stage_tag = excluded.iq_stage_tag,
      broker_gate = excluded.broker_gate,
      broker_gate_at = excluded.broker_gate_at,
      producer_id = excluded.producer_id,
      producer_name = excluded.producer_name
  `);
  const insertSearchKey = db.prepare(`
    INSERT OR IGNORE INTO account_search_keys (account_id, kind, value)
    VALUES (@accountId, @kind, @value)
  `);
  // Carrier read-model rows travel with their order: replaced wholesale on
  // every upsert so a deal's carrier change (or removal) lands on the same
  // sync tick as the order payload it belongs to.
  const deleteOrderCarriers = db.prepare(
    `DELETE FROM book_order_carriers WHERE order_id = ?`,
  );
  const insertOrderCarrier = db.prepare(
    `INSERT OR IGNORE INTO book_order_carriers (order_id, carrier_key, carrier_name)
     VALUES (?, ?, ?)`,
  );

  // Real-book overlay: when data/supabase-book.local.json exists, the boot
  // upsert carries the real Harper slice instead of the fictional seed.
  // Fictional rows already in the DB stay put (seeded tickets/threads
  // reference them); stale co-*/deal-*/order-* rows from older syncs are pruned.
  const book = loadSupabaseBook();
  const accounts = book ? book.accounts : SEED_ACCOUNTS;
  const policies = book ? book.policies : SEED_POLICIES;
  const orders: BookOrder[] = book ? book.orders : [];
  const contactKeys: BookContactKey[] = book ? book.contactKeys : [];

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
    for (const o of orders) {
      upsertOrder.run({
        id: o.id,
        accountId: o.accountId,
        harperOrderId: o.harperOrderId,
        createdAt: o.createdAt,
        orderedAt: o.orderedAt,
        eventAt: o.eventAt,
        bindStatus: o.bindStatus,
        revenueCents: o.revenueCents,
        revenueMicros: o.revenueMicros,
        richJson: JSON.stringify(o.rich),
        policyNumbersJson: JSON.stringify(o.policyNumbers),
        inconsistency: o.inconsistency,
        source: o.source,
        iqStageTag: o.iqStageTag,
        brokerGate: o.brokerGate,
        brokerGateAt: o.brokerGateAt,
        producerId: o.producerId,
        producerName: o.producerName,
      });
      deleteOrderCarriers.run(o.id);
      for (const deal of o.rich.deals) {
        const key = carrierKeyFromName(deal.carrierName);
        if (!key) continue;
        // First spelling per key wins within an order (deals arrive in
        // stable deal-id order); the facet elects the book-wide label.
        insertOrderCarrier.run(o.id, key, deal.carrierName!.trim());
      }
    }
    if (book) {
      // Contacts are replaced wholesale rather than upserted: a customer who
      // changes their email must stop matching the old one immediately, and
      // the whole set arrives in every snapshot. Cleared before the prune so
      // a search key can never be the reference that keeps a dropped account
      // alive, and refilled after it so every row points at a surviving one.
      db.prepare(`DELETE FROM account_search_keys`).run();
      pruneStaleBookRows(db, book.accounts, book.policies, orders);
      // Carrier rows for orders the prune removed (per-order deletes above
      // only cover orders still in the book).
      db.prepare(
        `DELETE FROM book_order_carriers
         WHERE order_id NOT IN (SELECT id FROM book_orders)`,
      ).run();
      const knownAccounts = new Set(accounts.map((a) => a.id));
      for (const key of contactKeys) {
        if (!knownAccounts.has(key.accountId)) continue;
        insertSearchKey.run(key);
      }
      // Service Note thread mirror — replaced wholesale like search keys: the
      // snapshot carries the complete visible set (~4.6k rows book-wide), and
      // a deleted note must stop being served immediately. Skipped entirely
      // for snapshots from before the mirror shipped, so a boot from an old
      // file keeps the previously synced notes instead of wiping them while
      // the forced full refresh is still in flight.
      if (book.noteThreadsPresent === true) {
        db.prepare(`DELETE FROM book_service_notes`).run();
        const insertNote = db.prepare(
          `INSERT OR REPLACE INTO book_service_notes
             (id, account_id, order_id, body, author, created_at)
           VALUES (@id, @accountId, @orderId, @body, @author, @createdAt)`,
        );
        for (const entry of book.serviceNoteEntries ?? []) {
          if (!knownAccounts.has(entry.accountId)) continue;
          insertNote.run(entry);
        }
        writeBookMeta(
          db,
          META_SERVICE_NOTES_SYNCED_AT,
          book.fetchedAt || new Date().toISOString(),
        );
      }
      // Company-page overview mirror — same lifecycle and same reasoning.
      if (book.companyDetailsPresent === true) {
        db.prepare(`DELETE FROM book_company_details`).run();
        db.prepare(`DELETE FROM book_contacts`).run();
        const insertDetail = db.prepare(
          `INSERT OR REPLACE INTO book_company_details
             (account_id, address1, address2, city, state, state_code,
              postal_code, time_zone, producer_id, producer_name)
           VALUES (@accountId, @address1, @address2, @city, @state,
                   @stateCode, @postalCode, @timeZone, @producerId,
                   @producerName)`,
        );
        const insertContact = db.prepare(
          `INSERT OR REPLACE INTO book_contacts
             (account_id, contact_id, name, email, phone, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const detail of book.companyDetails ?? []) {
          if (!knownAccounts.has(detail.accountId)) continue;
          insertDetail.run({
            accountId: detail.accountId,
            address1: detail.address1,
            address2: detail.address2,
            city: detail.city,
            state: detail.state,
            stateCode: detail.stateCode,
            postalCode: detail.postalCode,
            timeZone: detail.timeZone,
            producerId: detail.producerId,
            producerName: detail.producerName,
          });
          detail.contacts.forEach((contact, index) => {
            insertContact.run(
              detail.accountId,
              contact.id,
              contact.name,
              contact.email,
              contact.phone,
              index,
            );
          });
        }
        writeBookMeta(
          db,
          META_COMPANY_DETAILS_SYNCED_AT,
          book.fetchedAt || new Date().toISOString(),
        );
      }
    }
  });
  tx();
}

/**
 * Replace one account's mirrored Service Note thread — the write-through the
 * service-note POST uses so the author sees their note on the next read
 * instead of the next refresh tick. One transaction: the thread is only ever
 * observed whole.
 */
export function replaceAccountServiceNotes(
  db: Database.Database,
  accountId: string,
  entries: readonly BookServiceNoteEntry[],
): void {
  const remove = db.prepare(
    `DELETE FROM book_service_notes WHERE account_id = ?`,
  );
  const insert = db.prepare(
    `INSERT OR REPLACE INTO book_service_notes
       (id, account_id, order_id, body, author, created_at)
     VALUES (@id, @accountId, @orderId, @body, @author, @createdAt)`,
  );
  const tx = db.transaction(() => {
    remove.run(accountId);
    for (const entry of entries) {
      if (entry.accountId !== accountId) continue;
      insert.run(entry);
    }
  });
  tx();
}

/**
 * Remove `co-` / `deal-` / `order-` rows that fell out of the refreshed book.
 * Rows with desk history (threads, tickets, schedules…) are kept — the
 * per-row delete simply skips anything a foreign key still references.
 */
function pruneStaleBookRows(
  db: Database.Database,
  accounts: Account[],
  policies: Policy[],
  orders: BookOrder[],
) {
  const keepOrders = new Set(orders.map((o) => o.id));
  const staleOrders = (
    db.prepare(`SELECT id FROM book_orders WHERE id LIKE 'order-%'`).all() as {
      id: string;
    }[]
  ).filter((r) => !keepOrders.has(r.id));
  const deleteOrder = db.prepare(`DELETE FROM book_orders WHERE id = ?`);
  for (const row of staleOrders) {
    try {
      deleteOrder.run(row.id);
    } catch {
      // Unexpected FK — keep it.
    }
  }

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
export function syncPolicyQuoteFields(db: Database.Database) {
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
export function seedIscQuoteHistory(db: Database.Database) {
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

export function syncOperators(db: Database.Database) {
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
export function seedIntakeEvents(db: Database.Database) {
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
export function seedTickets(db: Database.Database) {
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
export function backfillThreadTickets(db: Database.Database) {
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
export function backfillMessageMetadata(db: Database.Database) {
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
export function backfillDecisions(db: Database.Database) {
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
