import "server-only";
import type Database from "better-sqlite3";
import { CARRIER_INTEL, carrierSlug } from "./carriers";
import { COTERIE_FORMS } from "./carrier-forms-coterie";
import {
  documentKindFromConvention,
  renameIncomingDoc,
  sizeLabelFromBytes,
  type DeskDocument,
  type DocumentFolder,
  type DocumentKind,
} from "./documents";
import { FORM_SETS } from "./forms";
import {
  endorsementKindLabel,
  limitMode,
  type EndorsementForm,
  type EndorsementKind,
  type LimitMode,
  type LimitSlot,
  type PolicyFormSet,
  type PolicyLimit,
  type CoveragePart,
} from "./forms";
import type { IscParseResult } from "./isc-intake";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { dataPath } from "./data-dir";

const FILES_DIR = dataPath("files");

export interface CarrierRecord {
  id: string;
  slug: string;
  name: string;
  kind: string;
  linesJson: string;
  portal: string | null;
  channel: string;
  serviceEmail: string | null;
  knownJson: string;
  whenOut: string | null;
}

export interface CarrierFormRecord {
  id: string;
  carrierId: string;
  form: string;
  edition: string;
  title: string;
  kind: string;
  verbatim: string;
  notes: string | null;
}

/**
 * A desk placement correction: an operator said "this policy belongs in that
 * ACORD section", and every future render of the account's certificate honors
 * it. One rule per policy (the latest correction wins); rules are visible in
 * the studio with provenance and revocable — silent learned behavior is how
 * trust dies.
 */
export interface PlacementRuleRecord {
  id: string;
  accountId: string;
  policyId: string;
  /** SectionDef key the desk assigned, e.g. "gl" */
  sectionKey: string;
  /** Where the sheet had put the policy when the desk corrected it */
  movedFrom: string | null;
  /** Operator name — provenance for the studio chip */
  correctedBy: string;
  createdAt: string;
}

/**
 * A certificate holder on the desk's rail for an account: name + address,
 * added by an operator (or saved off a ticket) so a multi-holder ask never
 * means retyping. Nothing here is invented — every row was typed or carried
 * verbatim from a request on file.
 */
export interface CertHolderRecord {
  id: string;
  accountId: string;
  /** The ticket that carried this holder, when saved from one */
  ticketId: string | null;
  name: string;
  address: string;
  createdAt: string;
}

export interface AdditionalInsuredRecord {
  id: string;
  accountId: string;
  policyId: string | null;
  ticketId: string | null;
  srNumber: string | null;
  name: string;
  address: string | null;
  formUsed: string | null;
  effectiveAt: string | null;
  premiumCents: number | null;
  status: "requested" | "quoted" | "bound" | "declined";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Limit lines mirror the dec page: a dollar amount, "Included", or
 * "Excluded". `amount_cents` is NULL exactly when `mode` isn't 'amount'.
 */
const POLICY_LIMITS_DDL = `
    CREATE TABLE IF NOT EXISTS policy_limits (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(id),
      slot TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'amount',
      amount_cents INTEGER,
      loc TEXT,
      UNIQUE(policy_id, slot)
    );
`;

export function migrateIntelligenceTables(db: Database.Database) {
  // Pre-mode databases have policy_limits with NOT NULL amount_cents and no
  // mode column. The table is fully derived from FORM_SETS and re-synced on
  // every boot (syncPolicySchedules deletes + reinserts per policy), so the
  // safe migration is a rebuild in place — no data to preserve.
  const limitCols = db
    .prepare(`PRAGMA table_info(policy_limits)`)
    .all() as { name: string }[];
  const missing = (col: string) => !limitCols.some((c) => c.name === col);
  // "loc" (per-location garagekeepers limits) rebuilds the same way.
  if (limitCols.length > 0 && (missing("mode") || missing("loc"))) {
    db.exec(`DROP TABLE policy_limits;`);
  }

  // policy_endorsements is likewise fully re-synced from FORM_SETS every boot;
  // pre-scope databases just need the column added.
  const endtCols = db
    .prepare(`PRAGMA table_info(policy_endorsements)`)
    .all() as { name: string }[];
  if (endtCols.length > 0 && !endtCols.some((c) => c.name === "scope")) {
    db.exec(`ALTER TABLE policy_endorsements ADD COLUMN scope TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS carriers (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      lines_json TEXT NOT NULL DEFAULT '[]',
      portal TEXT,
      channel TEXT NOT NULL,
      service_email TEXT,
      known_json TEXT NOT NULL DEFAULT '[]',
      when_out TEXT
    );

    CREATE TABLE IF NOT EXISTS carrier_forms (
      id TEXT PRIMARY KEY,
      carrier_id TEXT NOT NULL REFERENCES carriers(id),
      form TEXT NOT NULL,
      edition TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      verbatim TEXT NOT NULL DEFAULT '',
      notes TEXT,
      UNIQUE(carrier_id, form, edition)
    );

    CREATE TABLE IF NOT EXISTS policy_coverage_parts (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(id),
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      form TEXT NOT NULL,
      edition TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    ${POLICY_LIMITS_DDL}

    CREATE TABLE IF NOT EXISTS policy_endorsements (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policies(id),
      form TEXT NOT NULL,
      edition TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope TEXT,
      note TEXT,
      verbatim TEXT,
      source_document_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      policy_id TEXT,
      ticket_id TEXT,
      carrier_id TEXT,
      folder TEXT NOT NULL,
      kind TEXT NOT NULL,
      original_name TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      storage_path TEXT,
      trusted INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER,
      size_label TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS additional_insureds (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      policy_id TEXT,
      ticket_id TEXT,
      sr_number TEXT,
      name TEXT NOT NULL,
      address TEXT,
      form_used TEXT,
      effective_at TEXT,
      premium_cents INTEGER,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS desk_placement_rules (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      policy_id TEXT NOT NULL UNIQUE,
      section_key TEXT NOT NULL,
      moved_from TEXT,
      corrected_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS desk_cert_holders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      ticket_id TEXT,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS documents_account ON documents(account_id);
    CREATE INDEX IF NOT EXISTS documents_ticket ON documents(ticket_id);
    CREATE INDEX IF NOT EXISTS documents_policy ON documents(policy_id);
    CREATE INDEX IF NOT EXISTS ai_registry_account ON additional_insureds(account_id);
    CREATE INDEX IF NOT EXISTS policy_endorsements_policy ON policy_endorsements(policy_id);
    CREATE INDEX IF NOT EXISTS placement_rules_account ON desk_placement_rules(account_id);
    CREATE INDEX IF NOT EXISTS cert_holders_account ON desk_cert_holders(account_id);
  `);

  // Cert-domain persistence keeps its own handle so cert modules can read and
  // write placement rules without reaching into db.ts's private singleton.
  intelligenceDb = db;
}

let intelligenceDb: Database.Database | null = null;

/**
 * The migrated database handle for cert-domain reads/writes. db.ts boots the
 * singleton (and runs migrateIntelligenceTables) the first time any of its
 * query helpers run; a server action arriving on a cold process kicks that
 * boot here via a lazy import, so the handle is always migrated.
 */
export function getIntelligenceDb(): Database.Database {
  if (intelligenceDb) return intelligenceDb;
  // Lazy import avoids circular init (db.ts imports this module). Any db.ts
  // query helper runs getDb(), which calls migrateIntelligenceTables above.
  const { listUnderwriters } = require("./db") as {
    listUnderwriters: () => unknown;
  };
  listUnderwriters();
  if (!intelligenceDb) throw new Error("intelligence tables not migrated");
  return intelligenceDb;
}

/* ————————————————— Desk placement rules ————————————————— */

function mapPlacementRule(row: Record<string, unknown>): PlacementRuleRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    policyId: row.policy_id as string,
    sectionKey: row.section_key as string,
    movedFrom: (row.moved_from as string | null) ?? null,
    correctedBy: row.corrected_by as string,
    createdAt: row.created_at as string,
  };
}

export function listPlacementRules(
  db: Database.Database,
  accountId: string,
): PlacementRuleRecord[] {
  return (
    db
      .prepare(
        `SELECT * FROM desk_placement_rules WHERE account_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(accountId) as Record<string, unknown>[]
  ).map(mapPlacementRule);
}

/** One rule per policy — a re-correction replaces the earlier rule. */
export function upsertPlacementRule(
  db: Database.Database,
  input: {
    accountId: string;
    policyId: string;
    sectionKey: string;
    movedFrom: string | null;
    correctedBy: string;
  },
): PlacementRuleRecord {
  const id = `dpr-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO desk_placement_rules (
      id, account_id, policy_id, section_key, moved_from, corrected_by, created_at
    ) VALUES (@id, @accountId, @policyId, @sectionKey, @movedFrom, @correctedBy, @createdAt)
    ON CONFLICT(policy_id) DO UPDATE SET
      section_key = excluded.section_key,
      moved_from = excluded.moved_from,
      corrected_by = excluded.corrected_by,
      created_at = excluded.created_at`,
  ).run({ id, ...input, createdAt: new Date().toISOString() });
  const row = db
    .prepare(`SELECT * FROM desk_placement_rules WHERE policy_id = ?`)
    .get(input.policyId) as Record<string, unknown>;
  return mapPlacementRule(row);
}

export function deletePlacementRule(db: Database.Database, ruleId: string) {
  db.prepare(`DELETE FROM desk_placement_rules WHERE id = ?`).run(ruleId);
}

/* ————————————————— Desk cert holders ————————————————— */

function mapCertHolder(row: Record<string, unknown>): CertHolderRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    ticketId: (row.ticket_id as string | null) ?? null,
    name: row.name as string,
    address: row.address as string,
    createdAt: row.created_at as string,
  };
}

export function listCertHolders(
  db: Database.Database,
  accountId: string,
): CertHolderRecord[] {
  return (
    db
      .prepare(
        `SELECT * FROM desk_cert_holders WHERE account_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(accountId) as Record<string, unknown>[]
  ).map(mapCertHolder);
}

export function insertCertHolder(
  db: Database.Database,
  input: {
    accountId: string;
    ticketId: string | null;
    name: string;
    address: string;
  },
): CertHolderRecord {
  const id = `dch-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO desk_cert_holders (id, account_id, ticket_id, name, address, created_at)
     VALUES (@id, @accountId, @ticketId, @name, @address, @createdAt)`,
  ).run({ id, ...input, createdAt: new Date().toISOString() });
  const row = db
    .prepare(`SELECT * FROM desk_cert_holders WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  return mapCertHolder(row);
}

export function updateCertHolder(
  db: Database.Database,
  input: { id: string; name: string; address: string },
) {
  db.prepare(
    `UPDATE desk_cert_holders SET name = @name, address = @address WHERE id = @id`,
  ).run(input);
}

export function deleteCertHolder(db: Database.Database, holderId: string) {
  db.prepare(`DELETE FROM desk_cert_holders WHERE id = ?`).run(holderId);
}

export function syncPolicyIntelligence(db: Database.Database) {
  syncCarriers(db);
  syncCoterieForms(db);
  syncPolicySchedules(db);
  seedDocumentsFromTickets(db);
  seedAdditionalInsureds(db);
}

function syncCarriers(db: Database.Database) {
  const upsert = db.prepare(`
    INSERT INTO carriers (
      id, slug, name, kind, lines_json, portal, channel, service_email, known_json, when_out
    ) VALUES (
      @id, @slug, @name, @kind, @linesJson, @portal, @channel, @serviceEmail, @knownJson, @whenOut
    )
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      name = excluded.name,
      kind = excluded.kind,
      lines_json = excluded.lines_json,
      portal = excluded.portal,
      channel = excluded.channel,
      service_email = excluded.service_email,
      known_json = excluded.known_json,
      when_out = excluded.when_out
  `);

  const tx = db.transaction(() => {
    for (const c of CARRIER_INTEL) {
      const slug = carrierSlug(c.name);
      upsert.run({
        id: `car-${slug}`,
        slug,
        name: c.name,
        kind: c.kind,
        linesJson: JSON.stringify(c.lines),
        portal: c.portal ?? null,
        channel: c.channel,
        serviceEmail: c.serviceEmail ?? null,
        knownJson: JSON.stringify(c.known),
        whenOut: c.whenOut ?? null,
      });
    }
  });
  tx();
}

function syncCoterieForms(db: Database.Database) {
  const carrier = db
    .prepare(`SELECT id FROM carriers WHERE slug = 'coterie'`)
    .get() as { id: string } | undefined;
  if (!carrier) return;

  const upsert = db.prepare(`
    INSERT INTO carrier_forms (
      id, carrier_id, form, edition, title, kind, verbatim, notes
    ) VALUES (
      @id, @carrierId, @form, @edition, @title, @kind, @verbatim, @notes
    )
    ON CONFLICT(carrier_id, form, edition) DO UPDATE SET
      title = excluded.title,
      kind = excluded.kind,
      verbatim = excluded.verbatim,
      notes = excluded.notes
  `);

  const tx = db.transaction(() => {
    for (const f of COTERIE_FORMS) {
      const id = `cf-coterie-${f.form.replace(/\s+/g, "-").toLowerCase()}-${f.edition.replace(/\s+/g, "")}`;
      upsert.run({
        id,
        carrierId: carrier.id,
        form: f.form,
        edition: f.edition,
        title: f.title,
        kind: f.kind,
        verbatim: f.verbatim,
        notes: f.notes ?? null,
      });
    }
  });
  tx();
}

function syncPolicySchedules(db: Database.Database) {
  const delParts = db.prepare(`DELETE FROM policy_coverage_parts WHERE policy_id = ?`);
  const delLimits = db.prepare(`DELETE FROM policy_limits WHERE policy_id = ?`);
  const delEndt = db.prepare(`DELETE FROM policy_endorsements WHERE policy_id = ?`);

  const insPart = db.prepare(`
    INSERT INTO policy_coverage_parts (id, policy_id, code, label, form, edition, sort_order)
    VALUES (@id, @policyId, @code, @label, @form, @edition, @sortOrder)
  `);
  const insLimit = db.prepare(`
    INSERT INTO policy_limits (id, policy_id, slot, mode, amount_cents, loc)
    VALUES (@id, @policyId, @slot, @mode, @amountCents, @loc)
  `);
  const insEndt = db.prepare(`
    INSERT INTO policy_endorsements (
      id, policy_id, form, edition, title, kind, scope, note, verbatim, source_document_id, sort_order
    ) VALUES (
      @id, @policyId, @form, @edition, @title, @kind, @scope, @note, @verbatim, NULL, @sortOrder
    )
  `);

  const coterieForms = db
    .prepare(
      `SELECT form, edition, verbatim FROM carrier_forms WHERE carrier_id = 'car-coterie'`,
    )
    .all() as { form: string; edition: string; verbatim: string }[];
  const verbatimByKey = new Map(
    coterieForms.map((f) => [`${f.form}::${f.edition}`, f.verbatim]),
  );

  const hasFiledSchedule = db.prepare(
    `SELECT 1 FROM policy_endorsements
     WHERE policy_id = ? AND source_document_id IS NOT NULL LIMIT 1`,
  );

  const tx = db.transaction(() => {
    for (const [policyId, set] of Object.entries(FORM_SETS)) {
      const exists = db
        .prepare(`SELECT id FROM policies WHERE id = ?`)
        .get(policyId);
      if (!exists) continue;

      // A schedule attached from a filed document (ISC dec intake, Coterie
      // library attach) is the operator's record — the seed library never
      // overwrites it on boot.
      if (hasFiledSchedule.get(policyId)) continue;

      delParts.run(policyId);
      delLimits.run(policyId);
      delEndt.run(policyId);

      set.coverages.forEach((c, i) => {
        insPart.run({
          id: `pcp-${policyId}-${i}`,
          policyId,
          code: c.code,
          label: c.label,
          form: c.form,
          edition: c.edition,
          sortOrder: i,
        });
      });
      for (const l of set.limits) {
        insLimit.run({
          id: `pl-${policyId}-${l.slot}`,
          policyId,
          slot: l.slot,
          mode: limitMode(l),
          amountCents: l.amountCents ?? null,
          loc: l.loc ?? null,
        });
      }
      set.endorsements.forEach((e, i) => {
        const key = `${e.form}::${e.edition}`;
        insEndt.run({
          id: `pe-${policyId}-${i}`,
          policyId,
          form: e.form,
          edition: e.edition,
          title: e.title,
          kind: e.kind,
          scope: e.scope ?? null,
          note: e.note ?? null,
          verbatim: verbatimByKey.get(key) ?? null,
          sortOrder: i,
        });
      });
    }
  });
  tx();
}

function seedDocumentsFromTickets(db: Database.Database) {
  const tickets = db
    .prepare(`SELECT id, account_id, docs_json FROM tickets`)
    .all() as { id: string; account_id: string; docs_json: string }[];

  const existing = db
    .prepare(`SELECT COUNT(*) AS c FROM documents`)
    .get() as { c: number };
  if (existing.c > 0) return;

  const policiesByAccount = new Map<string, string>();
  for (const row of db
    .prepare(`SELECT id, account_id, carrier FROM policies`)
    .all() as { id: string; account_id: string; carrier: string }[]) {
    if (!policiesByAccount.has(row.account_id)) {
      policiesByAccount.set(row.account_id, row.id);
    }
  }

  const accountNames = new Map(
    (
      db.prepare(`SELECT id, name FROM accounts`).all() as {
        id: string;
        name: string;
      }[]
    ).map((a) => [a.id, a.name]),
  );

  const carrierByName = new Map(
    (
      db.prepare(`SELECT id, name FROM carriers`).all() as {
        id: string;
        name: string;
      }[]
    ).map((c) => [c.name.toLowerCase(), c.id]),
  );

  const insert = db.prepare(`
    INSERT INTO documents (
      id, account_id, policy_id, ticket_id, carrier_id, folder, kind,
      original_name, canonical_name, storage_path, trusted, size_bytes, size_label, created_at
    ) VALUES (
      @id, @accountId, @policyId, @ticketId, @carrierId, @folder, @kind,
      @originalName, @canonicalName, NULL, @trusted, NULL, @sizeLabel, @createdAt
    )
  `);

  const tx = db.transaction(() => {
    for (const t of tickets) {
      let docs: {
        id: string;
        name: string;
        kind: string;
        sizeLabel: string;
        trusted: boolean;
      }[] = [];
      try {
        docs = JSON.parse(t.docs_json || "[]");
      } catch {
        docs = [];
      }
      const entity = accountNames.get(t.account_id) ?? "Insured";
      const taken: string[] = [];
      const policyId = policiesByAccount.get(t.account_id) ?? null;
      const pol = policyId
        ? (db
            .prepare(`SELECT carrier FROM policies WHERE id = ?`)
            .get(policyId) as { carrier: string } | undefined)
        : undefined;
      const carrierId = pol
        ? (carrierByName.get(pol.carrier.toLowerCase()) ?? null)
        : null;

      for (const d of docs) {
        const renamed = renameIncomingDoc({
          entity:
            d.kind === "quote" || d.kind === "policy" || d.kind === "endorsement"
              ? entity
              : d.name.replace(/\.[^.]+$/, "").slice(0, 40) || entity,
          originalName: d.name,
          kind:
            d.kind === "quote"
              ? "quote"
              : d.kind === "policy"
                ? "policy"
                : d.kind === "endorsement"
                  ? "endorsement"
                  : d.kind === "customer_upload"
                    ? "contract"
                    : undefined,
          taken,
        });
        taken.push(renamed.canonicalName);
        insert.run({
          id: d.id || `doc-${randomUUID().slice(0, 8)}`,
          accountId: t.account_id,
          policyId:
            renamed.folder === "policy" || renamed.folder === "endorsement"
              ? policyId
              : null,
          ticketId: t.id,
          carrierId,
          folder: renamed.folder,
          kind: documentKindFromConvention(renamed.kind),
          originalName: d.name,
          canonicalName: renamed.canonicalName,
          trusted: d.trusted ? 1 : 0,
          sizeLabel: d.sizeLabel ?? null,
          createdAt: new Date().toISOString(),
        });
      }
    }
  });
  tx();
}

function seedAdditionalInsureds(db: Database.Database) {
  const count = db
    .prepare(`SELECT COUNT(*) AS c FROM additional_insureds`)
    .get() as { c: number };
  if (count.c > 0) return;

  const seeds: Omit<AdditionalInsuredRecord, "createdAt" | "updatedAt">[] = [
    {
      id: "ai-apex-oak",
      accountId: "acct-apex",
      policyId: "pol-apex-gl",
      ticketId: "tkt-apex-oak",
      srNumber: null,
      name: "Oak Street Builders LLC",
      address: "500 Market St, San Francisco, CA 94105",
      formUsed: "CG 20 10",
      effectiveAt: "2026-07-01",
      premiumCents: 0,
      status: "bound",
      notes: "Ongoing ops — construction GC",
    },
    {
      id: "ai-greenleaf-hoa",
      accountId: "acct-greenleaf",
      policyId: "pol-greenleaf-bop",
      ticketId: "tkt-greenleaf-hoa",
      srNumber: null,
      name: "Palm Court HOA",
      address: null,
      formUsed: "BP 04 48",
      effectiveAt: "2026-06-15",
      premiumCents: 0,
      status: "bound",
      notes: "Blanket AI already on Coterie — scheduled party for cert",
    },
    {
      id: "ai-harbor-landlord",
      accountId: "acct-harbor",
      policyId: "pol-harbor-pkg",
      ticketId: "tkt-harbor-landlord",
      srNumber: null,
      name: "Bayview Property Partners LP",
      address: "2210 Shoreline Dr, Alameda, CA 94501",
      formUsed: "CG 20 11",
      effectiveAt: "2026-08-01",
      premiumCents: 15000,
      status: "quoted",
      notes: "Landlord premises AI",
    },
    {
      id: "ai-redwood-gc",
      accountId: "acct-redwood",
      policyId: "pol-redwood-gl",
      ticketId: null,
      srNumber: null,
      name: "Bay Area General Contractors Inc",
      address: "1200 Mission St, San Francisco, CA 94103",
      formUsed: "CG 20 10",
      effectiveAt: "2026-05-01",
      premiumCents: 25000,
      status: "bound",
      notes: "Historical AI — book pricing sample",
    },
  ];

  const insert = db.prepare(`
    INSERT INTO additional_insureds (
      id, account_id, policy_id, ticket_id, sr_number, name, address,
      form_used, effective_at, premium_cents, status, notes, created_at, updated_at
    ) VALUES (
      @id, @accountId, @policyId, @ticketId, @srNumber, @name, @address,
      @formUsed, @effectiveAt, @premiumCents, @status, @notes, @createdAt, @updatedAt
    )
  `);

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const s of seeds) {
      const sr = s.ticketId
        ? (
            db
              .prepare(`SELECT sr_number FROM tickets WHERE id = ?`)
              .get(s.ticketId) as { sr_number: string } | undefined
          )?.sr_number ?? null
        : null;
      insert.run({
        ...s,
        srNumber: sr,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  tx();
}

export function loadPolicyFormSetFromDb(
  db: Database.Database,
  policyId: string,
): PolicyFormSet | null {
  const parts = db
    .prepare(
      `SELECT code, label, form, edition FROM policy_coverage_parts
       WHERE policy_id = ? ORDER BY sort_order ASC`,
    )
    .all(policyId) as CoveragePart[];
  if (parts.length === 0) return null;

  const limits = (
    db
      .prepare(
        `SELECT slot, mode, amount_cents AS amountCents, loc FROM policy_limits WHERE policy_id = ?`,
      )
      .all(policyId) as {
      slot: LimitSlot;
      mode: LimitMode | null;
      amountCents: number | null;
      loc: string | null;
    }[]
  ).map(
    (l) =>
      ({
        slot: l.slot,
        mode: l.mode ?? "amount",
        amountCents: l.amountCents ?? undefined,
        loc: l.loc ?? undefined,
      }) as PolicyLimit,
  );

  const endorsements = (
    db
      .prepare(
        `SELECT form, edition, title, kind, scope, note FROM policy_endorsements
         WHERE policy_id = ? ORDER BY sort_order ASC`,
      )
      .all(policyId) as {
      form: string;
      edition: string;
      title: string;
      kind: EndorsementKind;
      scope: string | null;
      note: string | null;
    }[]
  ).map(
    (e) =>
      ({
        form: e.form,
        edition: e.edition,
        title: e.title,
        kind: e.kind,
        scope: (e.scope as EndorsementForm["scope"]) ?? undefined,
        note: e.note ?? undefined,
      }) as EndorsementForm,
  );

  return { coverages: parts, limits, endorsements };
}

export function getCarrierBySlug(
  db: Database.Database,
  slug: string,
): CarrierRecord | null {
  const row = db
    .prepare(`SELECT * FROM carriers WHERE slug = ?`)
    .get(slug) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapCarrier(row);
}

export function getCarrierByName(
  db: Database.Database,
  name: string,
): CarrierRecord | null {
  const row = db
    .prepare(`SELECT * FROM carriers WHERE lower(name) = lower(?)`)
    .get(name) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapCarrier(row);
}

function mapCarrier(row: Record<string, unknown>): CarrierRecord {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    kind: row.kind as string,
    linesJson: row.lines_json as string,
    portal: (row.portal as string | null) ?? null,
    channel: row.channel as string,
    serviceEmail: (row.service_email as string | null) ?? null,
    knownJson: row.known_json as string,
    whenOut: (row.when_out as string | null) ?? null,
  };
}

export function listCarrierForms(
  db: Database.Database,
  carrierId: string,
): CarrierFormRecord[] {
  return (
    db
      .prepare(
        `SELECT * FROM carrier_forms WHERE carrier_id = ? ORDER BY form ASC`,
      )
      .all(carrierId) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    carrierId: row.carrier_id as string,
    form: row.form as string,
    edition: row.edition as string,
    title: row.title as string,
    kind: row.kind as string,
    verbatim: row.verbatim as string,
    notes: (row.notes as string | null) ?? null,
  }));
}

export function listDocuments(
  db: Database.Database,
  filters: {
    accountId?: string;
    ticketId?: string;
    policyId?: string;
    carrierId?: string;
    folder?: DocumentFolder | DocumentFolder[];
  },
): DeskDocument[] {
  let sql = `SELECT * FROM documents WHERE 1=1`;
  const params: (string | number)[] = [];
  if (filters.accountId) {
    sql += ` AND account_id = ?`;
    params.push(filters.accountId);
  }
  if (filters.ticketId) {
    sql += ` AND ticket_id = ?`;
    params.push(filters.ticketId);
  }
  if (filters.policyId) {
    sql += ` AND policy_id = ?`;
    params.push(filters.policyId);
  }
  if (filters.carrierId) {
    sql += ` AND carrier_id = ?`;
    params.push(filters.carrierId);
  }
  if (filters.folder) {
    const folders = Array.isArray(filters.folder)
      ? filters.folder
      : [filters.folder];
    sql += ` AND folder IN (${folders.map(() => "?").join(",")})`;
    params.push(...folders);
  }
  sql += ` ORDER BY created_at DESC`;
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
    mapDocument,
  );
}

function mapDocument(row: Record<string, unknown>): DeskDocument {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    policyId: (row.policy_id as string | null) ?? null,
    ticketId: (row.ticket_id as string | null) ?? null,
    carrierId: (row.carrier_id as string | null) ?? null,
    folder: row.folder as DocumentFolder,
    kind: row.kind as DocumentKind,
    originalName: row.original_name as string,
    canonicalName: row.canonical_name as string,
    storagePath: (row.storage_path as string | null) ?? null,
    trusted: Boolean(row.trusted),
    sizeBytes: (row.size_bytes as number | null) ?? null,
    sizeLabel: (row.size_label as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function listAdditionalInsureds(
  db: Database.Database,
  accountId: string,
): AdditionalInsuredRecord[] {
  return (
    db
      .prepare(
        `SELECT * FROM additional_insureds WHERE account_id = ? ORDER BY datetime(coalesce(effective_at, created_at)) DESC`,
      )
      .all(accountId) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    accountId: row.account_id as string,
    policyId: (row.policy_id as string | null) ?? null,
    ticketId: (row.ticket_id as string | null) ?? null,
    srNumber: (row.sr_number as string | null) ?? null,
    name: row.name as string,
    address: (row.address as string | null) ?? null,
    formUsed: (row.form_used as string | null) ?? null,
    effectiveAt: (row.effective_at as string | null) ?? null,
    premiumCents: (row.premium_cents as number | null) ?? null,
    status: row.status as AdditionalInsuredRecord["status"],
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export function upsertAdditionalInsured(
  db: Database.Database,
  input: {
    accountId: string;
    policyId: string | null;
    ticketId: string | null;
    srNumber: string | null;
    name: string;
    address: string | null;
    formUsed: string | null;
    effectiveAt: string | null;
    premiumCents: number | null;
    status: AdditionalInsuredRecord["status"];
    notes: string | null;
  },
): AdditionalInsuredRecord {
  const now = new Date().toISOString();
  const existing = input.ticketId
    ? (db
        .prepare(
          `SELECT id FROM additional_insureds WHERE ticket_id = ? AND lower(name) = lower(?)`,
        )
        .get(input.ticketId, input.name) as { id: string } | undefined)
    : undefined;

  if (existing) {
    db.prepare(
      `UPDATE additional_insureds SET
        policy_id = @policyId, sr_number = @srNumber, address = @address,
        form_used = @formUsed, effective_at = @effectiveAt,
        premium_cents = @premiumCents, status = @status, notes = @notes,
        updated_at = @updatedAt
       WHERE id = @id`,
    ).run({
      id: existing.id,
      ...input,
      updatedAt: now,
    });
    return listAdditionalInsureds(db, input.accountId).find(
      (a) => a.id === existing.id,
    )!;
  }

  const id = `ai-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO additional_insureds (
      id, account_id, policy_id, ticket_id, sr_number, name, address,
      form_used, effective_at, premium_cents, status, notes, created_at, updated_at
    ) VALUES (
      @id, @accountId, @policyId, @ticketId, @srNumber, @name, @address,
      @formUsed, @effectiveAt, @premiumCents, @status, @notes, @createdAt, @updatedAt
    )`,
  ).run({
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  });
  return listAdditionalInsureds(db, input.accountId).find((a) => a.id === id)!;
}

/**
 * File a document with convention rename. Policy kind on a Coterie policy
 * attaches the carrier form library schedule (no fake OCR).
 */
export function fileDocument(
  db: Database.Database,
  input: {
    accountId: string;
    accountName: string;
    policyId?: string | null;
    ticketId?: string | null;
    originalName: string;
    bytes?: Buffer | null;
    trusted?: boolean;
    kindHint?: DocumentKind;
  },
): DeskDocument {
  const taken = (
    db
      .prepare(
        `SELECT canonical_name FROM documents WHERE account_id = ?`,
      )
      .all(input.accountId) as { canonical_name: string }[]
  ).map((r) => r.canonical_name);

  const conventionKind =
    input.kindHint === "policy"
      ? "policy"
      : input.kindHint === "endorsement"
        ? "endorsement"
        : input.kindHint === "quote"
          ? "quote"
          : input.kindHint === "coi"
            ? "coi"
            : input.kindHint === "contract"
              ? "contract"
              : undefined;

  const renamed = renameIncomingDoc({
    entity: input.accountName,
    originalName: input.originalName,
    kind: conventionKind,
    taken,
  });

  let storagePath: string | null = null;
  if (input.bytes && input.bytes.length > 0) {
    const dir = path.join(FILES_DIR, input.accountId);
    fs.mkdirSync(dir, { recursive: true });
    const safe = renamed.canonicalName.replace(/[\\/]/g, "-");
    storagePath = path.join(dir, `${randomUUID().slice(0, 8)}-${safe}`);
    fs.writeFileSync(storagePath, input.bytes);
  }

  const policy = input.policyId
    ? (db
        .prepare(`SELECT carrier FROM policies WHERE id = ?`)
        .get(input.policyId) as { carrier: string } | undefined)
    : undefined;
  const carrier = policy
    ? getCarrierByName(db, policy.carrier)
    : null;

  const id = `doc-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const sizeBytes = input.bytes?.length ?? null;

  db.prepare(
    `INSERT INTO documents (
      id, account_id, policy_id, ticket_id, carrier_id, folder, kind,
      original_name, canonical_name, storage_path, trusted, size_bytes, size_label, created_at
    ) VALUES (
      @id, @accountId, @policyId, @ticketId, @carrierId, @folder, @kind,
      @originalName, @canonicalName, @storagePath, @trusted, @sizeBytes, @sizeLabel, @createdAt
    )`,
  ).run({
    id,
    accountId: input.accountId,
    policyId: input.policyId ?? null,
    ticketId: input.ticketId ?? null,
    carrierId: carrier?.id ?? null,
    folder: renamed.folder,
    kind: documentKindFromConvention(renamed.kind),
    originalName: input.originalName,
    canonicalName: renamed.canonicalName,
    storagePath,
    trusted: input.trusted ? 1 : 0,
    sizeBytes,
    sizeLabel: sizeLabelFromBytes(sizeBytes),
    createdAt: now,
  });

  if (
    renamed.kind === "policy" &&
    input.policyId &&
    carrier?.slug === "coterie"
  ) {
    attachCoterieScheduleFromLibrary(db, input.policyId, id);
  }

  return listDocuments(db, { accountId: input.accountId }).find(
    (d) => d.id === id,
  )!;
}

/** Attach / refresh schedule from Coterie carrier library onto the policy. */
export function attachCoterieScheduleFromLibrary(
  db: Database.Database,
  policyId: string,
  sourceDocumentId: string | null,
) {
  const forms = listCarrierForms(db, "car-coterie");
  if (forms.length === 0) return;

  const set = FORM_SETS[policyId];
  if (!set) {
    // Still stamp verbatim onto any existing endorsement rows that match library
    const update = db.prepare(
      `UPDATE policy_endorsements SET verbatim = ?, source_document_id = ?
       WHERE policy_id = ? AND form = ? AND edition = ?`,
    );
    for (const f of forms) {
      if (f.kind === "coverage") continue;
      update.run(f.verbatim, sourceDocumentId, policyId, f.form, f.edition);
    }
    return;
  }

  // Re-sync schedule and attach verbatim + source doc
  const delEndt = db.prepare(
    `DELETE FROM policy_endorsements WHERE policy_id = ?`,
  );
  const ins = db.prepare(`
    INSERT INTO policy_endorsements (
      id, policy_id, form, edition, title, kind, scope, note, verbatim, source_document_id, sort_order
    ) VALUES (
      @id, @policyId, @form, @edition, @title, @kind, @scope, @note, @verbatim, @sourceDocumentId, @sortOrder
    )
  `);
  const verbatimByKey = new Map(
    forms.map((f) => [`${f.form}::${f.edition}`, f.verbatim]),
  );

  const tx = db.transaction(() => {
    delEndt.run(policyId);
    set.endorsements.forEach((e, i) => {
      const key = `${e.form}::${e.edition}`;
      ins.run({
        id: `pe-${policyId}-${i}`,
        policyId,
        form: e.form,
        edition: e.edition,
        title: e.title,
        kind: e.kind,
        scope: e.scope ?? null,
        note: e.note ?? null,
        verbatim: verbatimByKey.get(key) ?? null,
        sourceDocumentId,
        sortOrder: i,
      });
    });
  });
  tx();
}

/**
 * Attach an ISC portal schedule parsed from pasted dec text. Replaces the
 * policy's coverage parts, limits, and endorsement schedule with exactly what
 * the document stated, records the writing company on the policy, and points
 * every row at the filed source document. This is the one-time extraction:
 * from here on, certificates and the fast path read this record.
 */
export function attachIscSchedule(
  db: Database.Database,
  input: {
    policyId: string;
    parsed: IscParseResult;
    sourceDocumentId: string | null;
  },
) {
  const { policyId, parsed, sourceDocumentId } = input;

  const delParts = db.prepare(
    `DELETE FROM policy_coverage_parts WHERE policy_id = ?`,
  );
  const delLimits = db.prepare(`DELETE FROM policy_limits WHERE policy_id = ?`);
  const delEndt = db.prepare(
    `DELETE FROM policy_endorsements WHERE policy_id = ?`,
  );
  const insPart = db.prepare(`
    INSERT INTO policy_coverage_parts (id, policy_id, code, label, form, edition, sort_order)
    VALUES (@id, @policyId, @code, @label, @form, @edition, @sortOrder)
  `);
  const insLimit = db.prepare(`
    INSERT INTO policy_limits (id, policy_id, slot, mode, amount_cents, loc)
    VALUES (@id, @policyId, @slot, @mode, @amountCents, NULL)
  `);
  const insEndt = db.prepare(`
    INSERT INTO policy_endorsements (
      id, policy_id, form, edition, title, kind, scope, note, verbatim, source_document_id, sort_order
    ) VALUES (
      @id, @policyId, @form, @edition, @title, @kind, @scope, NULL, NULL, @sourceDocumentId, @sortOrder
    )
  `);
  const setWriter = db.prepare(
    `UPDATE policies SET issuing_carrier = ? WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    delParts.run(policyId);
    delLimits.run(policyId);
    delEndt.run(policyId);
    parsed.coverages.forEach((c, i) => {
      insPart.run({
        id: `pcp-${policyId}-${i}`,
        policyId,
        code: c.code,
        label: c.label,
        form: c.form,
        edition: c.edition,
        sortOrder: i,
      });
    });
    parsed.limits.forEach((l, i) => {
      insLimit.run({
        id: `pl-${policyId}-${l.slot}-${i}`,
        policyId,
        slot: l.slot,
        mode: l.mode,
        amountCents: l.amountCents,
      });
    });
    parsed.endorsements.forEach((e, i) => {
      insEndt.run({
        id: `pe-${policyId}-${i}`,
        policyId,
        form: e.form,
        edition: e.edition,
        title: e.title,
        kind: e.kind,
        scope: e.scope ?? null,
        sourceDocumentId,
        sortOrder: i,
      });
    });
    if (parsed.writer) setWriter.run(parsed.writer, policyId);
  });
  tx();
}

export { carrierSlug, endorsementKindLabel };
