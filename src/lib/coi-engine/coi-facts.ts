export type CoiDocumentFactStatus = "analyzed" | "needs_analysis" | "error";

export type CoiDocumentFacts = {
  artifactId: string;
  filename: string;
  contentHash: string | null;
  status: CoiDocumentFactStatus;
  promptVersion: string | null;
  facts: Record<string, unknown> | null;
  error?: string | null;
};

export type CoiFactsResponse = {
  documents: CoiDocumentFacts[];
  analyzed: number;
  needsAnalysis: number;
  failed: number;
};

// One update point while the matching harper-tools branch settles command
// registration. Routes never duplicate these wire names.
export const COI_FACTS_COMMAND = {
  read: "service coi-facts get",
  refresh: "service coi-facts refresh",
} as const;

export const EMPTY_COI_FACTS: CoiFactsResponse = {
  documents: [],
  analyzed: 0,
  needsAnalysis: 0,
  failed: 0,
};

export function factsByArtifact(
  answer: CoiFactsResponse | null | undefined,
): Map<string, CoiDocumentFacts> {
  return new Map((answer?.documents ?? []).map((d) => [d.artifactId, d]));
}

export function coiGenerationPhase(
  artifactIds: string[],
  byArtifact: Map<string, CoiDocumentFacts>,
): "reading" | "composing" {
  return artifactIds.every((id) => byArtifact.get(id)?.status === "analyzed")
    ? "composing"
    : "reading";
}

export function flattenCompanyFacts(
  docs: CoiDocumentFacts[],
): Array<{ group: string; label: string; value: string; source: string }> {
  const rows: Array<{ group: string; label: string; value: string; source: string }> = [];
  const add = (group: string, label: string, value: unknown, source: string) => {
    if (value == null || value === "" || typeof value === "object") return;
    rows.push({ group, label, value: String(value), source });
  };
  for (const doc of docs) {
    if (!doc.facts) continue;
    const source = doc.filename;
    const insured = doc.facts.named_insured;
    if (insured && typeof insured === "object") {
      for (const [k, v] of Object.entries(insured as Record<string, unknown>)) {
        add("Named insured", k.replace(/_/g, " "), v, source);
      }
    }
    const carrier = doc.facts.carrier;
    if (carrier && typeof carrier === "object") {
      for (const [k, v] of Object.entries(carrier as Record<string, unknown>)) {
        add("Carrier", k.replace(/_/g, " "), v, source);
      }
    }
    const lines = Array.isArray(doc.facts.coverage_lines) ? doc.facts.coverage_lines : [];
    for (const line of lines) {
      if (!line || typeof line !== "object") continue;
      const record = line as Record<string, unknown>;
      const lineName = String(record.line_label_as_printed ?? record.line ?? "Coverage");
      const evidence = Array.isArray(record.evidence)
        ? (record.evidence[0] as Record<string, unknown> | undefined)
        : undefined;
      const page = record.page ?? evidence?.page;
      const lineSource =
        typeof page === "number" || (typeof page === "string" && page.trim())
          ? `${source} p.${String(page)}`
          : source;
      for (const key of ["policy_number", "effective_date", "expiration_date", "form"]) {
        add(lineName, key.replace(/_/g, " "), record[key], lineSource);
      }
      if (Array.isArray(record.limits)) {
        for (const limit of record.limits) {
          if (!limit || typeof limit !== "object") continue;
          const l = limit as Record<string, unknown>;
          add(
            lineName,
            String(l.label_as_printed ?? "limit"),
            l.amount_as_printed,
            lineSource,
          );
        }
      }
    }
  }
  return rows.slice(0, 80);
}
