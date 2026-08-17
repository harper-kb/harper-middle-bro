/**
 * Self-check: reading a certificate someone else issued.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/cert-upload-check.ts
 * (extractPdfText imports server-only; the render-check tsconfig stubs it)
 *
 * Builds real PDFs byte by byte — no fixture files, no new dependency — and
 * proves:
 *   1. A PDF's text layer comes back in READING ORDER, not content-stream
 *      order. The two differ, and a certificate parsed out of order reads as
 *      a different certificate.
 *   2. Text extracted from a PDF verifies against the schedule of record
 *      exactly as the same text pasted by hand — one verdict path, two doors.
 *   3. A page with no text layer (a scan) yields nothing, so the upload path
 *      can refuse it rather than verify an "empty" certificate as clean.
 *
 * (A fourth, source-text pass over cert-upload-actions.ts went away with that
 * module — it was only reachable from the old account-page CertVerifyPanel,
 * both removed in the dead-code sweep. CoiVerifier drives verification now.)
 */

import { parseCertificateText, verifyAgainstRecord } from "../src/lib/cert-verify";
import { bareFormSet, FORM_SETS, type PolicyFormSet } from "../src/lib/forms";
import { extractPdfText } from "../src/lib/pdf-text.server";
import { SEED_ACCOUNTS, SEED_POLICIES } from "../src/lib/seed";
import type { Account } from "../src/lib/types";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— A minimal, valid PDF with a positioned text layer ————— */

/**
 * `lines` are emitted BOTTOM-UP on the page and in shuffled order, so a
 * reader that trusts content-stream order produces the wrong text and the
 * reading-order grouping is actually under test.
 */
function buildPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/([\\()])/g, "\\$1");
  // Emit last line first at the lowest y — content order is the reverse of
  // reading order.
  const ops = lines
    .map((line, i) => ({ line, y: 700 - i * 14 }))
    .reverse()
    .map(({ line, y }) => `BT /F1 10 Tf 50 ${y} Td (${escape(line)}) Tj ET`)
    .join("\n");
  const stream = ops.length > 0 ? ops : "";

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${Buffer.byteLength(stream, "latin1")}>>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/* ————— Fixture: acct-oakridge, same policy cert-verify-check uses ————— */

const seedAccount = SEED_ACCOUNTS.find((a) => a.id === "acct-oakridge")!;
const account: Account = {
  ...seedAccount,
  status: "active",
  paymentReceivedAt: "2026-01-15T00:00:00.000Z",
} as Account;
const policies = SEED_POLICIES.filter((p) => p.accountId === "acct-oakridge");
const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
  policies.map((p) => [p.id, FORM_SETS[p.id] ?? bareFormSet(p.coverages)]),
);

const CERT_LINES = [
  "CERTIFICATE OF LIABILITY INSURANCE",
  "INSURED: Oakridge Property Mgmt LLC",
  "INSURER A: Next Insurance US Company",
  "COMMERCIAL GENERAL LIABILITY",
  "A NXT-GL-667788 12/01/2025 12/01/2026",
  "EACH OCCURRENCE $1,000,000",
  "GENERAL AGGREGATE $2,000,000",
  "CERTIFICATE HOLDER",
  "Desert Plaza Owners Association",
];

const TODAY = "2026-08-07";

async function main() {
  /* 1. Reading order out of a PDF whose content stream is reversed. */
  const text = await extractPdfText(buildPdf(CERT_LINES));
  const read = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  check(
    read.join("|") === CERT_LINES.join("|"),
    "PDF text comes back in reading order, not content-stream order",
    `read: ${read.join(" | ")}`,
  );

  /* 2. Same verdict through the file door as through the paste door. */
  const fromPdf = verifyAgainstRecord(
    parseCertificateText(text),
    { account, policies, formSets },
    TODAY,
  );
  const fromPaste = verifyAgainstRecord(
    parseCertificateText(CERT_LINES.join("\n")),
    { account, policies, formSets },
    TODAY,
  );
  check(
    fromPdf.recommendation === "Approve",
    "A faithful cert read out of a PDF recommends Approve",
    `got ${fromPdf.recommendation}: ${fromPdf.reasons.join("; ")}`,
  );
  check(
    JSON.stringify(fromPdf.rows) === JSON.stringify(fromPaste.rows),
    "Upload and paste produce identical verdict rows — one verdict path",
  );

  /* 3. A tampered cert still denies when it arrives as a PDF. */
  const tampered = await extractPdfText(
    buildPdf(
      CERT_LINES.map((l) =>
        l.startsWith("EACH OCCURRENCE") ? "EACH OCCURRENCE $2,000,000" : l,
      ),
    ),
  );
  const tamperedReport = verifyAgainstRecord(
    parseCertificateText(tampered),
    { account, policies, formSets },
    TODAY,
  );
  const limitRow = tamperedReport.rows.find((r) => /Each Occurrence/i.test(r.field));
  check(
    limitRow?.verdict === "Mismatch",
    "An inflated limit inside a PDF is caught as a Mismatch",
    limitRow ? `${limitRow.field}: ${limitRow.verdict}` : "row missing",
  );

  /* 4. A scan carries no text layer — nothing read is not a clean cert. */
  const blank = await extractPdfText(buildPdf([]));
  check(
    blank.replace(/\s/g, "") === "",
    "A page with no text layer yields no text at all",
    JSON.stringify(blank.slice(0, 40)),
  );

  console.log(failed === 0 ? "\nAll upload checks passed." : `\n${failed} FAILURE(S).`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
