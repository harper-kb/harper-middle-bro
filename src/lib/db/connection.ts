import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  loadPolicyFormSetFromDb,
  migrateIntelligenceTables,
  syncPolicyIntelligence,
} from "../carriers/policy-intelligence";
import { registerPolicyFormLoader } from "../carriers/policy-store";
import { migrateCarrierKnowledgeTable } from "../carriers/carrier-knowledge-store";
import { scheduleBookRefresh } from "./book-refresh";
import { backfillSrNumbers, ensureColumn, migrate } from "./migrate";
import {
  backfillDecisions,
  backfillMessageMetadata,
  backfillThreadTickets,
  seedIfEmpty,
  seedIntakeEvents,
  seedIscQuoteHistory,
  seedTickets,
  syncAccountsAndPolicies,
  syncOperators,
  syncPolicyQuoteFields,
  syncUnderwriterChannels,
} from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "underwriter-desk.db");

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  ensureColumn(db, "operators", "clerk_user_id", "clerk_user_id TEXT");
  migrateIntelligenceTables(db);
  migrateCarrierKnowledgeTable(db);
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
  scheduleBookRefresh(db);
  return db;
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
