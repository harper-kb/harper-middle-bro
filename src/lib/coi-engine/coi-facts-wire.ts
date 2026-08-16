import "server-only";

import type {
  CoiDocumentFactStatus,
  CoiDocumentFacts,
  CoiFactsResponse,
} from "./coi-facts";

function normalizedStatus(value: unknown): CoiDocumentFactStatus {
  const status = String(value ?? "").toLowerCase();
  if (["analyzed", "cached", "reextracted", "hit"].includes(status)) {
    return "analyzed";
  }
  if (status === "error") return "error";
  return "needs_analysis";
}

export function normalizeCoiFactsResponse(raw: unknown): CoiFactsResponse {
  const answer =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const source = Array.isArray(answer.files)
    ? answer.files
    : Array.isArray(answer.documents)
      ? answer.documents
      : [];
  const documents: CoiDocumentFacts[] = source.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const file = value as Record<string, unknown>;
    const artifactId =
      typeof file.artifact_id === "string"
        ? file.artifact_id
        : typeof file.artifactId === "string"
          ? file.artifactId
          : null;
    if (!artifactId) return [];
    return [{
      artifactId,
      filename:
        typeof file.filename === "string" ? file.filename : artifactId,
      contentHash:
        typeof file.content_hash === "string"
          ? file.content_hash
          : typeof file.contentHash === "string"
            ? file.contentHash
            : null,
      status: normalizedStatus(file.status),
      promptVersion:
        typeof file.prompt_version === "string"
          ? file.prompt_version
          : typeof file.promptVersion === "string"
            ? file.promptVersion
            : null,
      facts:
        file.facts && typeof file.facts === "object"
          ? (file.facts as Record<string, unknown>)
          : null,
      error:
        typeof file.reason === "string"
          ? file.reason
          : typeof file.error === "string"
            ? file.error
            : null,
    }];
  });
  const known = new Set(documents.map((document) => document.artifactId));
  if (Array.isArray(answer.skipped_artifacts)) {
    for (const value of answer.skipped_artifacts) {
      if (!value || typeof value !== "object") continue;
      const skipped = value as Record<string, unknown>;
      const artifactId =
        typeof skipped.artifact_id === "string" ? skipped.artifact_id : null;
      if (!artifactId || known.has(artifactId)) continue;
      documents.push({
        artifactId,
        filename: artifactId,
        contentHash: null,
        status: "error",
        promptVersion: null,
        facts: null,
        error:
          typeof skipped.reason === "string"
            ? skipped.reason
            : "Document could not be read.",
      });
    }
  }
  return {
    documents,
    analyzed: documents.filter((document) => document.status === "analyzed").length,
    needsAnalysis: documents.filter(
      (document) => document.status === "needs_analysis",
    ).length,
    failed: documents.filter((document) => document.status === "error").length,
  };
}
