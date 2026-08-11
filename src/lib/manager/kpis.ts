/**
 * Manager KPI definitions — Today / trailing 7 / MTD / custom.
 * Explicitly omits incoming-call KPI per product contract.
 */

export type KpiRange = "today" | "trailing_7" | "mtd" | "custom";

export type HeadlineKpis = {
  range: KpiRange;
  rangeLabel: string;
  from: string;
  to: string;
  docusignsSigned: number;
  bindsSent: number;
  bindBacklog: number;
  newOrders: number;
  boundPolicies: number;
  boundPoliciesToDate: number;
  coisSent: number;
  /** ISO when metrics were computed */
  computedAt: string;
  /** live | snapshot | sample — never silently mix definitions */
  source: "live" | "snapshot" | "sample";
  sourceNote: string;
};

export type QueueHealthKpis = {
  queueDepth: number;
  oldestTaskAgeHours: number;
  slaHitRate: number | null;
  throughput: number;
  reworkRate: number | null;
  handoffs: number;
  blockedReasonMix: { reason: string; count: number }[];
};

export function rangeWindow(
  range: KpiRange,
  now = new Date(),
  custom?: { from: string; to: string },
): { from: Date; to: Date; label: string } {
  const to = new Date(now);
  if (range === "custom" && custom) {
    return {
      from: new Date(custom.from),
      to: new Date(custom.to),
      label: "Custom",
    };
  }
  if (range === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: "Today" };
  }
  if (range === "trailing_7") {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: "Trailing 7 Days" };
  }
  // mtd
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from, to, label: "Month To Date" };
}

/** Sample headline KPIs — labeled until live BB operator-kpi adapters reconcile. */
export function sampleHeadlineKpis(range: KpiRange = "today"): HeadlineKpis {
  const { from, to, label } = rangeWindow(range);
  return {
    range,
    rangeLabel: label,
    from: from.toISOString(),
    to: to.toISOString(),
    docusignsSigned: 12,
    bindsSent: 8,
    bindBacklog: 23,
    newOrders: 15,
    boundPolicies: 6,
    boundPoliciesToDate: 140,
    coisSent: 31,
    computedAt: new Date().toISOString(),
    source: "sample",
    sourceNote:
      "Sample KPI snapshot — wire BigBrother operator-kpis / team-kpi-trends when credentials reconcile",
  };
}

export function sampleQueueHealth(): QueueHealthKpis {
  return {
    queueDepth: 48,
    oldestTaskAgeHours: 96,
    slaHitRate: 0.82,
    throughput: 37,
    reworkRate: 0.06,
    handoffs: 9,
    blockedReasonMix: [
      { reason: "Awaiting Signature", count: 11 },
      { reason: "Awaiting Payment", count: 8 },
      { reason: "Subjectivity Evidence", count: 5 },
      { reason: "Carrier Portal Access", count: 3 },
    ],
  };
}
