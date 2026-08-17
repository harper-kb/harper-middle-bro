import type Database from "better-sqlite3";
import { carrierKeyFromName } from "../carrier-filter";

export function ensureColumn(
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

export function migrate(db: Database.Database) {
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

    -- The live Harper book runs to ~10k accounts / ~11k policies — account
    -- detail lookups need these to stay indexed instead of scanning.
    CREATE INDEX IF NOT EXISTS policies_account ON policies(account_id);

    -- Order grain from orders_temp (All Accounts accordion). Lifecycle status
    -- (bound / pending / lost) and policy numbers are derived from linked
    -- deals_v2 rows at refresh time. Pending = actively awaiting bind
    -- (a sold/confirmed/paid deal) — a lost deal is not pending work.
    -- Deal-less order shells never enter the book.
    CREATE TABLE IF NOT EXISTS book_orders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      harper_order_id INTEGER NOT NULL,
      -- orders_temp.created_at: the authoritative creation moment deal age is
      -- measured from. ordered_at is the producer-entered business date.
      created_at TEXT,
      ordered_at TEXT,
      event_at TEXT,
      bind_status TEXT NOT NULL DEFAULT 'lost',
      revenue_cents INTEGER,
      revenue_micros INTEGER,
      rich_json TEXT NOT NULL DEFAULT '{}',
      policy_numbers_json TEXT NOT NULL DEFAULT '[]',
      inconsistency TEXT,
      -- Order source from deals_v2.is_instant_quote: 'iq' (every deal instant),
      -- 'broker' (none), 'mixed' (both). NULL when the order carries no deals.
      source TEXT,
      -- orders_temp.tag — IQ Stage / BB Step (null = No status).
      iq_stage_tag TEXT,
      -- Newest service_workbench_gate_overrides.current_gate (Broker Gate view).
      broker_gate TEXT,
      broker_gate_at TEXT,
      -- orders_temp.producer → producers. The id is the dedupe key for the
      -- account-level producer summary; names are not unique.
      producer_id INTEGER,
      producer_name TEXT
    );

    CREATE INDEX IF NOT EXISTS book_orders_account ON book_orders(account_id);

    -- Carrier-entity keys per order, derived at sync time from the order's
    -- deal payload (rich_json deals[].carrierName — the same values the
    -- cards display) via carrierKeyFromName. A read-model table for the
    -- Accounts carrier filter/facet: filtering and option derivation stay
    -- indexed SQL instead of re-parsing ~12k rich JSON blobs per request.
    -- carrier_name keeps the verified display spelling per order so the
    -- facet can pick the most common variant as the label.
    -- Deliberately no FK: rows are replaced wholesale with their order by
    -- the sync and swept when orders are pruned, and an FK would abort the
    -- prune path that deliberately skips referenced rows.
    CREATE TABLE IF NOT EXISTS book_order_carriers (
      order_id TEXT NOT NULL,
      carrier_key TEXT NOT NULL,
      carrier_name TEXT NOT NULL,
      PRIMARY KEY (order_id, carrier_key)
    );

    -- Facet grouping and label election scan by key, not by order.
    CREATE INDEX IF NOT EXISTS book_order_carriers_key
      ON book_order_carriers(carrier_key, carrier_name);

    -- Normalized customer identifiers for global company search: lowercased
    -- emails and digit-only phones from the synced Harper book. Search-only —
    -- the formatted value is deliberately never cached, so no surface built on
    -- this table can leak a customer email or phone number.
    -- Every lookup is correlated on account_id, so the primary key's own
    -- autoindex already covers it. A measured secondary index on (kind, value)
    -- changed nothing, so none is carried.
    CREATE TABLE IF NOT EXISTS account_search_keys (
      account_id TEXT NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (account_id, kind, value)
    );

    -- Full Service Note threads mirrored from public.service_note_entries
    -- (~4.6k rows book-wide, measured live) so the expanded note thread is a
    -- local read instead of a live Management API query per interaction.
    -- Account grain: the thread spans every order on the company; order_id is
    -- each entry's display anchor. Author is the resolved display name
    -- (renames land with the periodic full reconcile, like carrier names).
    -- Deliberately no FK: rows are replaced wholesale by the sync, and an FK
    -- would abort the account prune path that skips referenced rows.
    CREATE TABLE IF NOT EXISTS book_service_notes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- The thread reads one account's entries newest-first.
    CREATE INDEX IF NOT EXISTS book_service_notes_account
      ON book_service_notes(account_id, created_at DESC);

    -- Small sync/bookkeeping flags (e.g. when the note mirror last synced),
    -- kept in SQLite rather than process memory so request paths can decide
    -- local-vs-live without re-reading the 20MB snapshot.
    CREATE TABLE IF NOT EXISTS book_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Company-page overview mirror: location, stored timezone, and the
    -- company-level producer, synced with the book so /accounts/[id] renders
    -- without a live Management API round-trip. Replaced wholesale by the
    -- sync; deliberately no FK (see book_service_notes).
    CREATE TABLE IF NOT EXISTS book_company_details (
      account_id TEXT PRIMARY KEY,
      address1 TEXT,
      address2 TEXT,
      city TEXT,
      state TEXT,
      state_code TEXT,
      postal_code TEXT,
      time_zone TEXT,
      producer_id INTEGER,
      producer_name TEXT
    );

    -- Display contacts for the company page's Contacts card, same sync
    -- lifecycle as book_company_details. position preserves the source
    -- ordering (created_at, then id).
    CREATE TABLE IF NOT EXISTS book_contacts (
      account_id TEXT NOT NULL,
      contact_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      position INTEGER NOT NULL,
      PRIMARY KEY (account_id, contact_id)
    );

    -- Durable cache for heavy per-entity reads that stay live (payment
    -- history pages, order-detail payloads): JSON payload keyed by a
    -- caller-namespaced key, stamped with the fetch time so each caller
    -- applies its own freshness policy. This is what lets a page the
    -- operator saw before a restart answer instantly after one.
    CREATE TABLE IF NOT EXISTS remote_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    -- AI note-thread summaries. The key content-hashes the visible thread
    -- (visibleNoteThreadVersion), so this is a content-addressed cache: each
    -- thread version costs at most one LLM generation, ever — including
    -- across restarts, which the old in-memory map lost. expires_at bounds
    -- retention and sweeps rows for threads that stopped changing long ago.
    CREATE TABLE IF NOT EXISTS note_summaries (
      cache_key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Change digests for the incremental book refresh: one short hash per
    -- Harper order / company covering every field the book persists. Harper
    -- carries no updated_at on orders_temp or deals_v2 (verified against the
    -- live schema), so a watermark cannot see an untimestamped stage move such
    -- as sold -> lost. Comparing digests needs no timestamps at all: a row
    -- whose hash matches is provably unchanged, and one that has disappeared
    -- from the sweep has left the book.
    --
    -- Deliberately not a column on book_orders/accounts: those tables are
    -- shared with the fictional seed and with preserved desk history, and a
    -- digest is refresh bookkeeping rather than book data.
    CREATE TABLE IF NOT EXISTS book_sync_digests (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (kind, id)
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

    CREATE INDEX IF NOT EXISTS threads_account ON threads(account_id);

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

    -- Generated ACORD certificates (the COI engine's store): one row per
    -- generation, field values keyed by the ACORD schema's field_id contract.
    -- updated_at doubles as the CAS token for the save door — compared
    -- byte-for-byte, so it is only ever written as one ISO string.
    CREATE TABLE IF NOT EXISTS generated_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      form_type TEXT NOT NULL DEFAULT 'acord25',
      status TEXT NOT NULL DEFAULT 'draft',
      field_values_json TEXT NOT NULL DEFAULT '{}',
      generation_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS generated_certificates_account
      ON generated_certificates(account_id, id DESC);

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
  ensureColumn(db, "book_orders", "created_at", "created_at TEXT");
  ensureColumn(db, "book_orders", "event_at", "event_at TEXT");
  ensureColumn(db, "book_orders", "revenue_cents", "revenue_cents INTEGER");
  ensureColumn(db, "book_orders", "revenue_micros", "revenue_micros INTEGER");
  ensureColumn(db, "book_orders", "source", "source TEXT");
  ensureColumn(db, "book_orders", "iq_stage_tag", "iq_stage_tag TEXT");
  ensureColumn(db, "book_orders", "broker_gate", "broker_gate TEXT");
  ensureColumn(db, "book_orders", "broker_gate_at", "broker_gate_at TEXT");
  ensureColumn(db, "book_orders", "producer_id", "producer_id INTEGER");
  ensureColumn(db, "book_orders", "producer_name", "producer_name TEXT");
  ensureColumn(
    db,
    "book_orders",
    "rich_json",
    "rich_json TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(db, "tickets", "escalated_to", "escalated_to TEXT");
  ensureColumn(db, "tickets", "escalation_note", "escalation_note TEXT");
  ensureColumn(db, "tickets", "escalated_at", "escalated_at TEXT");
  ensureColumn(db, "tickets", "escalation_due_by", "escalation_due_by TEXT");
  ensureColumn(db, "tickets", "escalation_resolved_at", "escalation_resolved_at TEXT");
  migrateBookOrderStatus(db);
  backfillBookOrderCarriers(db);
  db.exec(
    `CREATE INDEX IF NOT EXISTS book_orders_status_event
       ON book_orders(bind_status, event_at, account_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS book_orders_source
       ON book_orders(account_id, source, bind_status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS book_orders_iq_stage
       ON book_orders(account_id, source, iq_stage_tag, bind_status)`,
  );
  // Order visibility checks look up one (account, harper order) pair on every
  // note/detail request — keep that a point lookup on multi-order accounts.
  db.exec(
    `CREATE INDEX IF NOT EXISTS book_orders_account_harper
       ON book_orders(account_id, harper_order_id)`,
  );
  backfillSrNumbers(db);
}

/**
 * Upgrade of book_orders from the boolean is_bound era to the three-state
 * bind_status. Legacy rows map bound→bound / not-bound→pending; the next
 * refresh tick replaces them with the real pending/lost split. The
 * column ALTER runs only while it is missing so refreshed statuses are never
 * clobbered on later boots; the delete of retired 'inactive' rows (deal-less
 * order shells no longer allowed in the book) is idempotent.
 */
function migrateBookOrderStatus(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(book_orders)`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "bind_status")) {
    db.exec(
      `ALTER TABLE book_orders ADD COLUMN bind_status TEXT NOT NULL DEFAULT 'lost'`,
    );
    if (cols.some((c) => c.name === "is_bound")) {
      db.exec(
        `UPDATE book_orders
         SET bind_status = CASE WHEN is_bound = 1 THEN 'bound' ELSE 'pending' END`,
      );
    }
  }
  db.exec(`DELETE FROM book_orders WHERE bind_status = 'inactive'`);
}

/**
 * Populate book_order_carriers for a database that already carries synced
 * book_orders from before the table existed. Runs only while the table is
 * completely empty — the book sync owns it from the first sync onward, so a
 * boot that never syncs (stale clone with a deleted snapshot) still filters.
 */
export function backfillBookOrderCarriers(db: Database.Database) {
  const empty =
    (
      db.prepare(`SELECT count(*) AS c FROM book_order_carriers`).get() as {
        c: number;
      }
    ).c === 0;
  if (!empty) return;

  const orders = db
    .prepare(`SELECT id, rich_json FROM book_orders`)
    .all() as { id: string; rich_json: string }[];
  if (orders.length === 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO book_order_carriers (order_id, carrier_key, carrier_name)
     VALUES (?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const order of orders) {
      let deals: unknown;
      try {
        deals = (JSON.parse(order.rich_json) as { deals?: unknown }).deals;
      } catch {
        continue;
      }
      if (!Array.isArray(deals)) continue;
      for (const deal of deals) {
        const name =
          deal && typeof deal === "object"
            ? (deal as { carrierName?: unknown }).carrierName
            : null;
        if (typeof name !== "string") continue;
        const key = carrierKeyFromName(name);
        if (!key) continue;
        insert.run(order.id, key, name.trim());
      }
    }
  });
  tx();
}

/** Assign sequential SR-##### to any ticket missing one. */
export function backfillSrNumbers(db: Database.Database) {
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

export function allocateSrNumber(db: Database.Database): string {
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
