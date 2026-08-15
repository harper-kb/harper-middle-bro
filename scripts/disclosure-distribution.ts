/**
 * Publish the per-rep disclosure distribution.
 *
 * This is the transcript keyword query that was run once and never shared. It
 * costs nothing to re-run and it settles the argument about whether the
 * problem is real, so it is a script rather than a dashboard: point it at a
 * corpus, publish the table, let both sides argue with it.
 *
 * Run: npx tsx scripts/disclosure-distribution.ts [--corpus <path.json>]
 *
 * The corpus file is a JSON array of TranscriptRecord. With no --corpus the
 * scan runs against the labeled sample corpus and says so in every heading.
 */
import fs from "fs";
import {
  calibrateTaxonomy,
  DISCLOSURE_TOPIC_LABELS,
  scanDisclosure,
  type TranscriptRecord,
} from "../src/lib/retention/disclosure";
import { DEFECT_KIND_LABELS, type OriginationDefectKind } from "../src/lib/retention/defects";
import { buildSampleTranscripts, SAMPLE_DEFECTS } from "../src/lib/retention/sample";

const corpusFlag = process.argv.indexOf("--corpus");
const corpusPath = corpusFlag >= 0 ? process.argv[corpusFlag + 1] : null;

let transcripts: TranscriptRecord[];
let source: "live" | "sample";
let sourceNote: string;

if (corpusPath) {
  transcripts = JSON.parse(fs.readFileSync(corpusPath, "utf8")) as TranscriptRecord[];
  source = "live";
  sourceNote = `Corpus: ${corpusPath} (${transcripts.length} transcripts)`;
} else {
  transcripts = buildSampleTranscripts();
  source = "sample";
  sourceNote =
    "Sample corpus — pass --corpus <path.json> to publish live rates from the transcript store";
}

const distribution = scanDisclosure(transcripts, { source, sourceNote });

console.log(`\nDisclosure Distribution — ${distribution.source.toUpperCase()}`);
console.log(distribution.sourceNote);
console.log(`Transcripts scanned: ${distribution.corpusSize}\n`);

console.log("Book-Wide Raise Rate");
for (const row of distribution.overall) {
  console.log(
    `  ${DISCLOSURE_TOPIC_LABELS[row.topic].padEnd(24)} ${String(row.raised).padStart(4)} / ${distribution.corpusSize}  ${pct(row.rate)}`,
  );
}

console.log("\nPer Rep");
const header = [
  "Rep".padEnd(16),
  "Calls".padStart(6),
  ...distribution.overall.map((r) => short(r.topic).padStart(9)),
  "Zero".padStart(7),
];
console.log(`  ${header.join(" ")}`);
for (const rep of distribution.reps) {
  const cells = [
    rep.repCanonicalName.padEnd(16),
    String(rep.transcripts).padStart(6),
    ...rep.topics.map((t) => (t.rate == null ? "—" : pct(t.rate)).padStart(9)),
    (rep.zeroDisclosureRate == null ? "—" : pct(rep.zeroDisclosureRate)).padStart(7),
  ];
  console.log(`  ${cells.join(" ")}`);
}

const observed: Partial<Record<OriginationDefectKind, number>> = {};
for (const d of SAMPLE_DEFECTS) {
  observed[d.kind] = (observed[d.kind] ?? 0) + 1;
}

console.log("\nTaxonomy Calibration — Predicted Defects vs Ledger");
for (const row of calibrateTaxonomy(distribution, observed)) {
  console.log(
    `  ${DEFECT_KIND_LABELS[row.kind].padEnd(38)} expected ${String(row.expectedDefects).padStart(4)}  observed ${String(row.observedDefects).padStart(3)}  capture ${
      row.captureRate == null ? "—" : pct(row.captureRate)
    }`,
  );
  console.log(`    ${row.note}`);
}

console.log(
  "\nRates below the 15-transcript minimum read as — rather than as a number.\n",
);

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function short(topic: string): string {
  return topic === "contract_requirements"
    ? "Contract"
    : topic === "additional_insured"
      ? "AI/WOS"
      : topic === "payment_structure"
        ? "Payment"
        : "Subject";
}
