import "server-only";
import {
  listHolderNotices,
  listIssuedCerts,
  listIssueAttempts,
  listPrepared,
  migrateCertLedger,
  type HolderNoticeRecord,
  type IssueAttemptRecord,
  type IssuedCertRecord,
  type PreparedCertRecord,
} from "./cert-ledger";
import { getIntelligenceDb } from "../carriers/policy-intelligence";

/** Server-side ledger reads for the account page. */

let migrated = false;

export interface AccountCertLedger {
  certs: IssuedCertRecord[];
  attempts: IssueAttemptRecord[];
  notices: HolderNoticeRecord[];
  prepared: PreparedCertRecord[];
}

export function getAccountCertLedger(accountId: string): AccountCertLedger {
  const db = getIntelligenceDb();
  if (!migrated) {
    migrateCertLedger(db);
    migrated = true;
  }
  return {
    certs: listIssuedCerts(db, accountId),
    attempts: listIssueAttempts(db, accountId),
    notices: listHolderNotices(db, accountId),
    prepared: listPrepared(db, accountId),
  };
}
