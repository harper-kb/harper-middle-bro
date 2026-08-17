/**
 * Import real bound accounts into the desk from data/real-isc/manifest.json.
 *
 * The manifest (and any document files next to it) live under data/, which is
 * gitignored — this script contains no client data and is safe to commit.
 *
 * Manifest shape: { accounts: [{ slug, companyId, name, state, city?,
 * industry, deals: [{ dealId, stage, boundAt, policyNumber, carrier,
 * premium, coverage, effectiveDate, expirationDate, ... }],
 * documents: [{ filename, category, sizeBytes?, ... }] }] }
 *
 * Behavior:
 *   - Idempotent: rows keyed acct-real-<companyId> / pol-real-<dealId> are
 *     replaced on re-run (documents filed for those accounts are re-filed).
 *   - Only bound deals (stage "bound" with dates) become policy rows; sold-
 *     but-unbound deals are recorded in the account notes instead.
 *   - issuing_carrier is NEVER set from deal metadata — the dec page governs.
 *     It is only recorded when a policy PDF is present locally, its text
 *     parses through parseIscDec, and the accuracy gate passes.
 *   - Documents: if data/real-isc/<slug>/<filename> exists the bytes are
 *     filed; otherwise a metadata-only document row is filed so the account
 *     page shows the real document inventory.
 *
 * Run: npx tsx --conditions react-server scripts/import-real-isc.ts
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { listAccounts } from "../src/lib/db";
import {
  classifyKind,
  classifyScope,
  iscParseAttachable,
  parseIscDec,
} from "../src/lib/intake/isc-intake";
import type { IscParseResult } from "../src/lib/intake/isc-intake";
import { attachIscSchedule, fileDocument } from "../src/lib/policy-intelligence";
import type { DocumentKind } from "../src/lib/documents";

interface ManifestDeal {
  dealId: number;
  stage: string;
  stageNote?: string;
  boundAt: string | null;
  policyNumber: string | null;
  policyNumberNote?: string;
  carrier: string;
  writerHint?: string;
  premium: number;
  coverage: string[];
  effectiveDate: string | null;
  expirationDate: string | null;
}

interface ManifestDocument {
  documentId: number;
  filename: string;
  category: string;
  sizeBytes: number | null;
  sharedWith?: string;
}

interface ManifestAccount {
  slug: string;
  companyId: number;
  name: string;
  nameNote?: string;
  state: string;
  city?: string;
  /** Street line from the production companies record, when captured. */
  address1?: string;
  zip?: string;
  industry: string;
  deals: ManifestDeal[];
  documents: ManifestDocument[];
}

interface Manifest {
  accounts: ManifestAccount[];
}

const ROOT = process.cwd();
const REAL_DIR = path.join(ROOT, "data", "real-isc");
const MANIFEST_PATH = path.join(REAL_DIR, "manifest.json");
const DB_PATH = path.join(ROOT, "data", "underwriter-desk.db");

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`No manifest at ${MANIFEST_PATH} — nothing to import.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;

// Initialize/migrate the desk DB through the app's own bootstrap.
listAccounts();

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const KIND_FOR_CATEGORY: Record<string, DocumentKind> = {
  POLICY_DOCUMENT: "policy",
  BINDER: "policy",
  QUOTE: "quote",
  APPLICATION_FORM: "other",
};

function accountUwId(deals: ManifestDeal[]): string {
  const bound = deals.find((d) => d.stage === "bound");
  const carrier = (bound ?? deals[0])?.carrier ?? "ISC";
  return carrier.trim().toLowerCase() === "hiscox" ? "uw-hiscox-1" : "uw-isc-1";
}

// ——— idempotent cleanup of a prior real import ———
const priorDocs = db
  .prepare(
    `SELECT id, storage_path FROM documents WHERE account_id LIKE 'acct-real-%'`,
  )
  .all() as { id: string; storage_path: string | null }[];
for (const doc of priorDocs) {
  if (doc.storage_path) {
    const abs = path.join(ROOT, doc.storage_path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
}
db.prepare(`DELETE FROM documents WHERE account_id LIKE 'acct-real-%'`).run();
for (const table of [
  "policy_coverage_parts",
  "policy_limits",
  "policy_endorsements",
]) {
  db.prepare(`DELETE FROM ${table} WHERE policy_id LIKE 'pol-real-%'`).run();
}
db.prepare(
  `DELETE FROM additional_insureds WHERE account_id LIKE 'acct-real-%'`,
).run();
db.prepare(`DELETE FROM policies WHERE id LIKE 'pol-real-%'`).run();
db.prepare(
  `DELETE FROM operator_accounts WHERE account_id LIKE 'acct-real-%'`,
).run();
db.prepare(`DELETE FROM accounts WHERE id LIKE 'acct-real-%'`).run();

const insertAccount = db.prepare(`
  INSERT INTO accounts (id, name, dba, industry, address1, city, state, zip, primary_uw_id, backup_uw_id, notes, status, payment_received_at)
  VALUES (@id, @name, NULL, @industry, @address1, @city, @state, @zip, @uw, NULL, @notes, @status, NULL)
`);
const insertPolicy = db.prepare(`
  INSERT INTO policies (id, account_id, policy_number, carrier, coverages_json, effective_date, expiration_date, premium_cents)
  VALUES (@id, @accountId, @policyNumber, @carrier, @coveragesJson, @effectiveDate, @expirationDate, @premiumCents)
`);

interface ParseScore {
  account: string;
  file: string;
  policyId: string;
  gate: string;
  writer: string | null;
  writerNaic: string | null;
  policyNumber: string | null;
  policyNumberMatches: boolean;
  coverages: number;
  limits: number;
  endorsements: number;
  blanketAdditionalInsured: boolean;
  blanketWaiverOfSubrogation: boolean;
  ignoredLines: number;
  warnings: string[];
  attached: boolean;
}

const parseScores: ParseScore[] = [];
let accountsImported = 0;
let policiesImported = 0;
let docsWithBytes = 0;
let docsMetadataOnly = 0;

/**
 * Extract PDF text as reading-order lines. pdf text streams come out in draw
 * order, which scatters a dec page's label/value pairs; grouping items into
 * rows by their Y coordinate (then sorting each row by X) reconstructs the
 * lines the way the page reads, so "Policy No." and its value land on one
 * line for parseIscDec.
 */
async function extractPdfLines(bytes: Buffer): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const items = (tc.items as { str?: string; transform?: number[] }[])
        .filter((i) => typeof i.str === "string" && i.str.trim() && i.transform)
        .map((i) => ({ str: i.str!.trim(), x: i.transform![4], y: i.transform![5] }));
      const rows: { y: number; cells: { str: string; x: number }[] }[] = [];
      for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
        if (row) row.cells.push(it);
        else rows.push({ y: it.y, cells: [it] });
      }
      for (const r of rows) {
        lines.push(
          r.cells
            .sort((a, b) => a.x - b.x)
            .map((c) => c.str)
            .join(" "),
        );
      }
      lines.push(""); // page boundary
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

/**
 * The writers' dec pages carry a "LIST OF ADDITIONAL ENDORSEMENTS:" section
 * whose entries are titles only — no form codes ("Additional Insured"). The
 * schedule of record still lists them: form stays blank (never invented),
 * kind/scope classified from the title alone, so an Additional Insured grant
 * with unstated scope stays conservative on the fast path.
 */
function additionalEndorsementTitles(lines: string[]): string[] {
  const start = lines.findIndex((l) =>
    /^LIST OF ADDITIONAL ENDORSEMENTS:?$/i.test(l.trim()),
  );
  if (start < 0) return [];
  const titles: string[] = [];
  for (const raw of lines.slice(start + 1, start + 12)) {
    const l = raw.trim();
    if (!l) break; // page boundary — the list ends with its dec page
    if (/\d+\s+of\s+\d+\s*$/.test(l)) break; // page footer
    // Boilerplate around the list is shouted; titles are mixed-case.
    if (!/[a-z]/.test(l) || /[$]/.test(l) || l.length > 120) continue;
    titles.push(l);
  }
  return titles;
}

async function run() {
  for (const acct of manifest.accounts) {
    const accountId = `acct-real-${acct.companyId}`;
    const bound = acct.deals.filter(
      (d) =>
        d.stage === "bound" &&
        d.boundAt &&
        d.effectiveDate &&
        d.expirationDate,
    );
    const unbound = acct.deals.filter((d) => !bound.includes(d));

    const noteParts: string[] = [
      `REAL account imported from Harper production (company ${acct.companyId}).`,
    ];
    if (acct.city) noteParts.push(`Location: ${acct.city}, ${acct.state}.`);
    for (const d of bound) {
      noteParts.push(
        `Deal ${d.dealId} bound ${d.boundAt} — ${d.carrier} ${d.coverage.join("/")} premium $${d.premium.toFixed(2)}.`,
      );
      if (d.policyNumberNote) noteParts.push(`Policy #: ${d.policyNumberNote}.`);
    }
    for (const d of unbound) {
      noteParts.push(
        `Deal ${d.dealId} (${d.stage}, NOT bound): ${d.carrier} ${d.coverage.join("/")} quoted $${d.premium.toFixed(2)}.${d.stageNote ? ` ${d.stageNote}` : ""}`,
      );
    }
    if (acct.nameNote) noteParts.push(acct.nameNote);

    // Address is copied exactly as the manifest carries it — street and ZIP
    // stay NULL when production never captured them. Blank beats wrong: the
    // certificate's INSURED box prints only what the record actually states.
    insertAccount.run({
      id: accountId,
      name: acct.name,
      industry: acct.industry,
      address1: acct.address1 ?? null,
      city: acct.city ?? null,
      state: acct.state,
      zip: acct.zip ?? null,
      uw: accountUwId(acct.deals),
      notes: noteParts.join(" "),
      status: bound.length > 0 ? "active" : "pre_bind",
    });
    accountsImported += 1;

    const policyIdByCarrier = new Map<string, string>();
    for (const d of bound) {
      const policyId = `pol-real-${d.dealId}`;
      insertPolicy.run({
        id: policyId,
        accountId,
        policyNumber: d.policyNumber ?? "",
        carrier: d.carrier,
        coveragesJson: JSON.stringify(d.coverage),
        effectiveDate: d.effectiveDate,
        expirationDate: d.expirationDate,
        premiumCents: Math.round(d.premium * 100),
      });
      policiesImported += 1;
      policyIdByCarrier.set(d.carrier.toLowerCase(), policyId);
    }

    for (const docMeta of acct.documents) {
      const localPath = path.join(REAL_DIR, acct.slug, docMeta.filename);
      const bytes = fs.existsSync(localPath) ? fs.readFileSync(localPath) : null;
      const kind = KIND_FOR_CATEGORY[docMeta.category] ?? "other";
      const isPolicyDoc =
        docMeta.category === "POLICY_DOCUMENT" || docMeta.category === "BINDER";
      const policyId = isPolicyDoc
        ? (policyIdByCarrier.get("isc") ??
          policyIdByCarrier.values().next().value ??
          null)
        : null;

      const filed = fileDocument(db, {
        accountId,
        accountName: acct.name,
        policyId,
        originalName: docMeta.filename,
        bytes,
        trusted: false,
        kindHint: kind,
      });
      if (bytes) docsWithBytes += 1;
      else docsMetadataOnly += 1;

      // Dec-page parse: only from actual bytes, only onto ISC paper.
      const iscPolicyId = policyIdByCarrier.get("isc");
      if (bytes && isPolicyDoc && iscPolicyId) {
        let pdfLines: string[] = [];
        try {
          pdfLines = await extractPdfLines(bytes);
        } catch (err) {
          console.warn(
            `  [${acct.slug}] PDF text extraction failed for ${docMeta.filename}: ${String(err)}`,
          );
          continue;
        }
        const parsed: IscParseResult = parseIscDec(pdfLines.join("\n"));
        for (const title of additionalEndorsementTitles(pdfLines)) {
          if (
            parsed.endorsements.some(
              (e) => e.title.toLowerCase() === title.toLowerCase(),
            )
          ) {
            continue;
          }
          parsed.endorsements.push({
            form: "",
            edition: "",
            title,
            kind: classifyKind(title),
            scope: classifyScope(title),
          });
          parsed.warnings.push(
            `Additional endorsement "${title}" listed by title only — form code and scope must be read off the endorsement page.`,
          );
        }
        const boundIsc = bound.find((d) => d.carrier.toLowerCase() === "isc");
        const gate = iscParseAttachable(parsed, boundIsc?.policyNumber ?? "");
        const score: ParseScore = {
          account: acct.slug,
          file: docMeta.filename,
          policyId: iscPolicyId,
          gate: gate.ok ? "pass" : (gate.reason ?? "fail"),
          writer: parsed.writer,
          writerNaic: parsed.writerNaic,
          policyNumber: parsed.policyNumber,
          policyNumberMatches:
            !!parsed.policyNumber &&
            !!boundIsc?.policyNumber &&
            parsed.policyNumber === boundIsc.policyNumber,
          coverages: parsed.coverages.length,
          limits: parsed.limits.length,
          endorsements: parsed.endorsements.length,
          blanketAdditionalInsured: parsed.endorsements.some(
            (e) => e.kind === "ai" && e.scope === "blanket",
          ),
          blanketWaiverOfSubrogation: parsed.endorsements.some(
            (e) => e.kind === "wos" && e.scope === "blanket",
          ),
          ignoredLines: parsed.ignoredLines,
          warnings: parsed.warnings,
          attached: false,
        };
        if (gate.ok) {
          attachIscSchedule(db, {
            policyId: iscPolicyId,
            parsed,
            sourceDocumentId: filed.id,
          });
          score.attached = true;
          // The dec page governs: when the deal record never carried a
          // policy number, the number printed on the attached dec fills it.
          if (!boundIsc?.policyNumber?.trim() && parsed.policyNumber) {
            db.prepare(`UPDATE policies SET policy_number = ? WHERE id = ?`).run(
              parsed.policyNumber,
              iscPolicyId,
            );
          }
        }
        parseScores.push(score);
      }
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    accountsImported,
    policiesImported,
    docsWithBytes,
    docsMetadataOnly,
    parseScores,
  };
  fs.writeFileSync(
    path.join(REAL_DIR, "import-report.json"),
    JSON.stringify(report, null, 2),
  );

  console.log(`\nImported ${accountsImported} accounts, ${policiesImported} policies.`);
  console.log(
    `Documents: ${docsWithBytes} with bytes, ${docsMetadataOnly} metadata-only (files not present locally).`,
  );
  if (parseScores.length > 0) {
    console.log(`\nDec parse results (${parseScores.length} documents):`);
    for (const s of parseScores) {
      console.log(
        `  ${s.account}/${s.file}: gate=${s.gate} writer=${s.writer ?? "—"} ` +
          `pol#=${s.policyNumber ?? "—"}${s.policyNumberMatches ? " (match)" : ""} ` +
          `cov=${s.coverages} lim=${s.limits} end=${s.endorsements} ` +
          `blanketAI=${s.blanketAdditionalInsured} blanketWOS=${s.blanketWaiverOfSubrogation} ` +
          `ignored=${s.ignoredLines}${s.attached ? " ATTACHED" : ""}`,
      );
    }
  } else {
    console.log("No policy PDFs present locally — no dec parses attempted.");
  }
}

run()
  .then(() => db.close())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
