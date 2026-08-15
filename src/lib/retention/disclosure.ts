/**
 * The per-rep disclosure scan.
 *
 * A keyword query measuring how often subjectivities get raised on sales calls
 * was already run once across the full transcript corpus, and the results were
 * never shared with anyone. That is the cheapest signal in this entire system:
 * it needs no schema change and it converts "sales overpromises" from an
 * anecdote into a distribution with names on it.
 *
 * This is that query, written down so it can be re-run on a cadence rather than
 * once. It scans transcripts for the four things a sale is supposed to
 * surface — subjectivities, contract requirements, additional insured needs,
 * and payment structure — and reports coverage per rep.
 *
 * Two deliberate limits. It measures whether a topic was *raised*, not whether
 * it was raised well; and a low rate on a small denominator means nothing,
 * which is why `MIN_TRANSCRIPTS_FOR_RATE` gates the published rate rather than
 * the row. Both matter, because this output calibrates the defect taxonomy and
 * eventually touches somebody's accelerator.
 */

import type { OriginationDefectKind } from "./defects";

/** One sales call, reduced to what the scan needs. */
export interface TranscriptRecord {
  id: string;
  repCanonicalName: string;
  repAgentId: string | null;
  occurredAt: string;
  text: string;
  /** Present when the call is tied to a bound deal, so defects can be joined later. */
  companyId?: string | null;
}

/**
 * What a sale is supposed to surface. Each topic maps to the defect kind that
 * shows up downstream when it is skipped — that mapping is what makes this a
 * calibration input rather than just a report.
 */
export type DisclosureTopic =
  | "subjectivity"
  | "contract_requirements"
  | "additional_insured"
  | "payment_structure";

export const DISCLOSURE_TOPIC_LABELS: Record<DisclosureTopic, string> = {
  subjectivity: "Subjectivities",
  contract_requirements: "Contract Requirements",
  additional_insured: "Additional Insured Needs",
  payment_structure: "Payment Structure",
};

export const TOPIC_TO_DEFECT_KIND: Record<DisclosureTopic, OriginationDefectKind> = {
  subjectivity: "undisclosed_subjectivity",
  contract_requirements: "coverage_limit_mismatch",
  additional_insured: "coverage_limit_mismatch",
  payment_structure: "payment_structure_undisclosed",
};

const TOPIC_PATTERNS: Record<DisclosureTopic, RegExp[]> = {
  subjectivity: [
    /subjectivit/i,
    /\b(loss runs?|signed application|inspection|questionnaire|supplemental)\b/i,
    /\bbefore (we|the carrier) can (bind|issue)\b/i,
  ],
  contract_requirements: [
    /\b(contract|lease|agreement)\b.{0,40}\b(require|requirement|minimum)/i,
    /\bwhat (does|do) (your|the) (contract|client|gc|landlord) require\b/i,
    /\brequired limits?\b/i,
  ],
  additional_insured: [
    /\badditional insured\b/i,
    /\bwaiver of subrogation\b/i,
    /\b(name|list|add) (them|him|her|the \w+) on (the|your) policy\b/i,
  ],
  payment_structure: [
    /\b(premium )?financ(e|ed|ing)\b/i,
    /\b(down payment|installment|monthly payments?)\b/i,
    /\b(direct bill|agency bill|pay the carrier directly)\b/i,
  ],
};

export function topicsRaisedIn(text: string): DisclosureTopic[] {
  return (Object.keys(TOPIC_PATTERNS) as DisclosureTopic[]).filter((topic) =>
    TOPIC_PATTERNS[topic].some((p) => p.test(text)),
  );
}

/** Below this, a rate is noise. The row still publishes; the rate reads null. */
export const MIN_TRANSCRIPTS_FOR_RATE = 15;

export interface RepDisclosureRow {
  repCanonicalName: string;
  repAgentId: string | null;
  transcripts: number;
  /** Raise counts and rates per topic. Rate is null under the minimum. */
  topics: {
    topic: DisclosureTopic;
    raised: number;
    rate: number | null;
  }[];
  /** Share of transcripts that raised every topic. The strictest read. */
  fullDisclosureRate: number | null;
  /** Share that raised none. The one that predicts service load. */
  zeroDisclosureRate: number | null;
}

export interface DisclosureDistribution {
  corpusSize: number;
  reps: RepDisclosureRow[];
  /** Book-wide raise rate per topic — the headline number to publish. */
  overall: { topic: DisclosureTopic; raised: number; rate: number }[];
  scannedAt: string;
  /** live when scanning a real corpus, sample when demonstrating the shape. */
  source: "live" | "sample";
  sourceNote: string;
}

export function scanDisclosure(
  transcripts: TranscriptRecord[],
  opts: { source?: "live" | "sample"; sourceNote?: string; now?: Date } = {},
): DisclosureDistribution {
  const topics = Object.keys(TOPIC_PATTERNS) as DisclosureTopic[];
  const byRep = new Map<
    string,
    { agentId: string | null; total: number; raised: Map<DisclosureTopic, number>; full: number; zero: number }
  >();
  const overall = new Map<DisclosureTopic, number>();

  for (const t of transcripts) {
    const raised = topicsRaisedIn(t.text);
    const row =
      byRep.get(t.repCanonicalName) ??
      {
        agentId: t.repAgentId,
        total: 0,
        raised: new Map<DisclosureTopic, number>(),
        full: 0,
        zero: 0,
      };
    row.total += 1;
    for (const topic of raised) {
      row.raised.set(topic, (row.raised.get(topic) ?? 0) + 1);
      overall.set(topic, (overall.get(topic) ?? 0) + 1);
    }
    if (raised.length === topics.length) row.full += 1;
    if (raised.length === 0) row.zero += 1;
    byRep.set(t.repCanonicalName, row);
  }

  const reps: RepDisclosureRow[] = [...byRep.entries()]
    .map(([repCanonicalName, row]) => {
      const rated = row.total >= MIN_TRANSCRIPTS_FOR_RATE;
      return {
        repCanonicalName,
        repAgentId: row.agentId,
        transcripts: row.total,
        topics: topics.map((topic) => ({
          topic,
          raised: row.raised.get(topic) ?? 0,
          rate: rated ? round3((row.raised.get(topic) ?? 0) / row.total) : null,
        })),
        fullDisclosureRate: rated ? round3(row.full / row.total) : null,
        zeroDisclosureRate: rated ? round3(row.zero / row.total) : null,
      };
    })
    .sort((a, b) => (b.zeroDisclosureRate ?? -1) - (a.zeroDisclosureRate ?? -1));

  return {
    corpusSize: transcripts.length,
    reps,
    overall: topics.map((topic) => ({
      topic,
      raised: overall.get(topic) ?? 0,
      rate: transcripts.length
        ? round3((overall.get(topic) ?? 0) / transcripts.length)
        : 0,
    })),
    scannedAt: (opts.now ?? new Date()).toISOString(),
    source: opts.source ?? "sample",
    sourceNote:
      opts.sourceNote ??
      "Sample corpus — point the scan at the transcript source to publish live rates",
  };
}

/**
 * Calibration: which defect kinds should the ledger expect, and how many.
 *
 * The distribution predicts downstream volume — if a rep raises subjectivities
 * on one call in ten, the other nine are the collect-subjectivity tickets
 * service will open later. Comparing that prediction to the defects actually
 * raised is what tells you whether the taxonomy is catching reality or missing
 * most of it.
 */
export interface TaxonomyCalibration {
  kind: OriginationDefectKind;
  /** Transcripts where the topic went unraised. */
  expectedDefects: number;
  /** Defects of this kind actually in the ledger for the same period. */
  observedDefects: number;
  /** observed / expected. Well under 1 means the ledger is under-catching. */
  captureRate: number | null;
  note: string;
}

export function calibrateTaxonomy(
  distribution: DisclosureDistribution,
  observedByKind: Partial<Record<OriginationDefectKind, number>>,
): TaxonomyCalibration[] {
  const expected = new Map<OriginationDefectKind, number>();
  for (const row of distribution.overall) {
    const kind = TOPIC_TO_DEFECT_KIND[row.topic];
    const missed = distribution.corpusSize - row.raised;
    expected.set(kind, (expected.get(kind) ?? 0) + missed);
  }
  return [...expected.entries()]
    .map(([kind, expectedDefects]) => {
      const observedDefects = observedByKind[kind] ?? 0;
      const captureRate =
        expectedDefects > 0 ? round3(observedDefects / expectedDefects) : null;
      return {
        kind,
        expectedDefects,
        observedDefects,
        captureRate,
        note:
          captureRate == null
            ? "No undisclosed calls in the corpus for this kind"
            : captureRate < 0.25
              ? "Ledger is catching a small fraction of what the transcripts predict"
              : captureRate > 1.5
                ? "More defects than the transcripts predict — check for over-classification"
                : "Ledger volume is in the range the transcripts predict",
      };
    })
    .sort((a, b) => b.expectedDefects - a.expectedDefects);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
