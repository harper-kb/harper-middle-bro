/**
 * Self-check: the ISC intake and certs-desk loop.
 *
 *   1. Writer identity — naicForPolicy resolves the four verified ISC
 *      writers off the recorded dec-page name; bare "ISC" stays blank.
 *   2. parseIscDec — the sample garage dec extracts writer, policy number,
 *      coverage forms, stated limits, and the endorsement schedule with
 *      correct kinds and scopes; unknown lines are counted, never invented.
 *   3. Accuracy gate — a policy-number mismatch blocks attach.
 *   4. attachIscSchedule — an in-memory database gets the parsed schedule
 *      and the writer lands on the policy row.
 *   5. Certificate insurer block — two ISC policies on different writers
 *      carry different letters, each with its verified NAIC code.
 *   6. Price guidance — three $100-ish quote samples clear MIN_QUOTE_SAMPLES
 *      and produce a $100 median for ISC 30-day notices.
 *
 * Run: npx tsx --conditions react-server scripts/isc-intake-check.ts
 */

import Database from "better-sqlite3";
import { buildCertificatePacket } from "../src/lib/certificate";
import {
  ISC_SAMPLE_DEC,
  iscParseAttachable,
  parseIscDec,
} from "../src/lib/isc-intake";
import { naicForPolicy } from "../src/lib/naic";
import {
  attachIscSchedule,
  migrateIntelligenceTables,
} from "../src/lib/policy-intelligence";
import {
  MIN_QUOTE_SAMPLES,
  summarizeQuotes,
  type QuoteSample,
} from "../src/lib/price-guidance";
import type { Policy } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ——— 1. Writer identity ———
console.log("\n[1] Writer identity");
const sutton = naicForPolicy("ISC", [], "Sutton National Insurance Company");
check("Sutton National → 25798", sutton?.naic === "25798", JSON.stringify(sutton));
const hadron = naicForPolicy("ISC", [], "Hadron Specialty Insurance Company");
check("Hadron Specialty → 17534", hadron?.naic === "17534");
const sirius = naicForPolicy("ISC", [], "SiriusPoint America Insurance Company");
check("SiriusPoint America → 38776", sirius?.naic === "38776");
const thirdCoast = naicForPolicy("ISC", [], "Third Coast Insurance Company");
check("Third Coast → 10713", thirdCoast?.naic === "10713");
check("bare ISC stays blank", naicForPolicy("ISC") === null);
check(
  "unknown writer stays blank",
  naicForPolicy("ISC", [], "Some Other Insurance Company") === null,
);

// ——— 2. Parse the sample dec ———
console.log("\n[2] parseIscDec on the sample garage dec");
const parsed = parseIscDec(ISC_SAMPLE_DEC);
check(
  "writer = Third Coast / 10713",
  parsed.writer === "Third Coast Insurance Company" && parsed.writerNaic === "10713",
  JSON.stringify({ writer: parsed.writer, naic: parsed.writerNaic }),
);
check("policy number ISC-GAR-112233", parsed.policyNumber === "ISC-GAR-112233");
check(
  "2 coverage forms (garage + garagekeepers)",
  parsed.coverages.length === 2 &&
    parsed.coverages.some((c) => c.code === "Garage") &&
    parsed.coverages.some((c) => c.code === "GK"),
  JSON.stringify(parsed.coverages),
);
check("5 stated limits", parsed.limits.length === 5, JSON.stringify(parsed.limits));
check(
  "other-than-auto aggregate = $2M",
  parsed.limits.some(
    (l) => l.slot === "gar_other_than_auto_aggregate" && l.amountCents === 200_000_000,
  ),
);
check(
  "garagekeepers collision = $250K",
  parsed.limits.some((l) => l.slot === "gk_collision" && l.amountCents === 25_000_000),
);
check(
  "4 endorsements",
  parsed.endorsements.length === 4,
  JSON.stringify(parsed.endorsements.map((e) => e.form)),
);
check(
  "blanket AI classified",
  parsed.endorsements.some((e) => e.kind === "ai" && e.scope === "blanket"),
);
check(
  "waiver classified",
  parsed.endorsements.some((e) => e.kind === "wos"),
);
check(
  "primary & noncontributory classified",
  parsed.endorsements.some((e) => e.kind === "pnc"),
);
check(
  "no 30-day NOC on the sample (must be requested via certs@iscmga.com)",
  !parsed.endorsements.some((e) => /notice of cancellation/i.test(e.title)),
);

// ——— 3. Accuracy gate ———
console.log("\n[3] Accuracy gate");
check("matching policy number attaches", iscParseAttachable(parsed, "ISC-GAR-112233").ok);
const mismatch = iscParseAttachable(parsed, "ISC-GL-551002");
check(
  "policy-number mismatch blocks",
  !mismatch.ok && /does not match/i.test(mismatch.reason ?? ""),
  mismatch.reason ?? "",
);
const empty = parseIscDec("nothing recognizable here\njust prose");
check("empty parse blocks", !iscParseAttachable(empty, "ISC-GAR-112233").ok);

// ——— 4. Attach into an in-memory database ———
console.log("\n[4] attachIscSchedule");
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE policies (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    policy_number TEXT,
    carrier TEXT,
    coverages_json TEXT,
    effective_date TEXT,
    expiration_date TEXT,
    premium_cents INTEGER,
    issuing_carrier TEXT
  );
`);
migrateIntelligenceTables(db);
db.prepare(
  `INSERT INTO policies (id, account_id, policy_number, carrier, coverages_json, effective_date, expiration_date, premium_cents, issuing_carrier)
   VALUES ('pol-metro-gar', 'acct-metro', 'ISC-GAR-112233', 'ISC', '["Garage","CA"]', '2026-05-01', '2027-05-01', 720000, NULL)`,
).run();
attachIscSchedule(db, {
  policyId: "pol-metro-gar",
  parsed,
  sourceDocumentId: "doc-test",
});
const parts = db
  .prepare(`SELECT COUNT(*) c FROM policy_coverage_parts WHERE policy_id = 'pol-metro-gar'`)
  .get() as { c: number };
const limits = db
  .prepare(`SELECT COUNT(*) c FROM policy_limits WHERE policy_id = 'pol-metro-gar'`)
  .get() as { c: number };
const endts = db
  .prepare(
    `SELECT COUNT(*) c FROM policy_endorsements WHERE policy_id = 'pol-metro-gar' AND source_document_id = 'doc-test'`,
  )
  .get() as { c: number };
const writerRow = db
  .prepare(`SELECT issuing_carrier FROM policies WHERE id = 'pol-metro-gar'`)
  .get() as { issuing_carrier: string | null };
check("coverage parts persisted", parts.c === 2, String(parts.c));
check("limits persisted", limits.c === 5, String(limits.c));
check("endorsements persisted with source document", endts.c === 4, String(endts.c));
check(
  "writer recorded on the policy",
  writerRow.issuing_carrier === "Third Coast Insurance Company",
  String(writerRow.issuing_carrier),
);

// ——— 5. Certificate insurer block across two ISC writers ———
console.log("\n[5] Certificate insurer letters per writer");
const basePolicy = {
  accountId: "acct-x",
  effectiveDate: "2026-02-10",
  expirationDate: "2027-02-10",
  premiumCents: 100000,
  quoteInsuredName: null,
  quoteCarrier: null,
};
const summitGl: Policy = {
  ...basePolicy,
  id: "pol-a",
  policyNumber: "ISC-GL-551002",
  carrier: "ISC",
  coverages: ["GL"],
  issuingCarrier: "Sutton National Insurance Company",
};
const metroGar: Policy = {
  ...basePolicy,
  id: "pol-b",
  policyNumber: "ISC-GAR-112233",
  carrier: "ISC",
  coverages: ["Garage"],
  issuingCarrier: "Third Coast Insurance Company",
};
const packet = buildCertificatePacket({
  account: {
    id: "acct-x",
    name: "Two Writer Test Co",
    dba: null,
    industry: "Testing",
    addressLine1: null,
    city: null,
    state: "TX",
    zip: null,
    primaryUwId: "uw-isc-1",
    backupUwId: null,
    notes: "",
    status: "active",
    paymentReceivedAt: null,
  },
  policies: [summitGl, metroGar],
  formSets: {},
  holderName: "Holder LLC",
  holderAddress: "1 Main St, Austin, TX 78701",
});
check(
  "two insurers, letters A and B",
  packet.insurers.length === 2 &&
    packet.insurers[0].letter === "A" &&
    packet.insurers[1].letter === "B",
  JSON.stringify(packet.insurers.map((i) => [i.letter, i.issuingCompany, i.naic])),
);
check(
  "Sutton prints 25798 / Third Coast prints 10713",
  packet.insurers.some((i) => i.issuingCompany?.includes("Sutton") && i.naic === "25798") &&
    packet.insurers.some((i) => i.issuingCompany?.includes("Third Coast") && i.naic === "10713"),
);
const sameWriterPacket = buildCertificatePacket({
  account: packet.account,
  policies: [
    summitGl,
    { ...metroGar, issuingCarrier: "Sutton National Insurance Company" },
  ],
  formSets: {},
  holderName: "Holder LLC",
  holderAddress: "1 Main St, Austin, TX 78701",
});
check(
  "same writer shares one letter",
  sameWriterPacket.insurers.length === 1 && sameWriterPacket.insurers[0].letter === "A",
);

// ——— 6. Price guidance from the certs-desk loop ———
console.log("\n[6] Price guidance for ISC 30-day notices");
const samples: QuoteSample[] = [
  { threadId: "th-isc-noc-1", carrier: "ISC", requestType: "notice_cancellation_30", offeredPremiumCents: 10000, accountName: "Summit", subject: "s", createdAt: "2026-05-19" },
  { threadId: "th-isc-noc-2", carrier: "ISC", requestType: "notice_cancellation_30", offeredPremiumCents: 10000, accountName: "Metro", subject: "s", createdAt: "2026-06-24" },
  { threadId: "th-isc-noc-3", carrier: "ISC", requestType: "notice_cancellation_30", offeredPremiumCents: 12500, accountName: "Summit", subject: "s", createdAt: "2026-07-22" },
];
const guidance = summarizeQuotes(samples)["ISC::notice_cancellation_30"];
check("sample count clears the minimum", guidance.sampleCount >= MIN_QUOTE_SAMPLES);
check(
  "median $100, range $100–$125",
  guidance.priced?.medianCents === 10000 &&
    guidance.priced.minCents === 10000 &&
    guidance.priced.maxCents === 12500,
  JSON.stringify(guidance.priced),
);

console.log(
  failures === 0
    ? "\nAll ISC intake checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
