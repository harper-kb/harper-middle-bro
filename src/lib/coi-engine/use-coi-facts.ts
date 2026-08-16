"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_COI_FACTS,
  factsByArtifact,
  type CoiFactsResponse,
} from "@/lib/coi-engine/coi-facts";

async function readCoiFacts(
  companyId: string,
  artifactKey: string,
): Promise<CoiFactsResponse> {
  if (!companyId || !artifactKey) return EMPTY_COI_FACTS;
  const artifactIds = artifactKey.split(",");
  const chunks = Array.from(
    { length: Math.ceil(artifactIds.length / 20) },
    (_, index) => artifactIds.slice(index * 20, index * 20 + 20),
  );
  const answers = await Promise.all(
    chunks.map(async (chunk) => {
      const query = new URLSearchParams();
      for (const id of chunk) query.append("artifactId", id);
      const response = await fetch(
        `/api/coi/facts/${encodeURIComponent(companyId)}?${query}`,
        {
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as CoiFactsResponse;
    }),
  );
  const documents = answers.flatMap((answer) => answer.documents ?? []);
  return {
    documents,
    analyzed: documents.filter((doc) => doc.status === "analyzed").length,
    needsAnalysis: documents.filter(
      (doc) => doc.status === "needs_analysis",
    ).length,
    failed: documents.filter((doc) => doc.status === "error").length,
  };
}

export function useCoiFacts(companyId: string, artifactIds: string[]) {
  const artifactKey = [...new Set(artifactIds)].sort().join(",");
  const key = companyId && artifactKey ? `${companyId}:${artifactKey}` : "";
  const activeRequest = useRef({});
  const [state, setState] = useState<{
    key: string;
    status: "loading" | "done" | "error";
    answer: CoiFactsResponse;
  } | null>(null);

  useEffect(() => {
    activeRequest.current = {};
  }, [key]);

  useEffect(() => {
    if (!companyId || !key) return;
    let cancelled = false;
    readCoiFacts(companyId, artifactKey)
      .then((answer) => {
        if (!cancelled) setState({ key, status: "done", answer });
      })
      .catch(() => {
        if (!cancelled) setState({ key, status: "error", answer: EMPTY_COI_FACTS });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactKey, companyId, key]);

  const current = state?.key === key ? state : null;
  const answer = current?.answer ?? EMPTY_COI_FACTS;
  return {
    status: key ? (current?.status ?? "loading") : ("done" as const),
    answer,
    byArtifact: useMemo(() => factsByArtifact(answer), [answer]),
    reload: async () => {
      const request = activeRequest.current;
      const reloadKey = key;
      const reloaded = await readCoiFacts(companyId, artifactKey);
      if (activeRequest.current === request) {
        setState({ key: reloadKey, status: "done", answer: reloaded });
      }
      return reloaded;
    },
    refresh: async (ids: string[]) => {
      const request = activeRequest.current;
      const refreshKey = key;
      const response = await fetch(`/api/coi/facts/${encodeURIComponent(companyId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactIds: ids }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      const refreshed = (await response.json()) as CoiFactsResponse;
      const refreshedIds = new Set(refreshed.documents.map((doc) => doc.artifactId));
      const mergedDocuments = [
        ...answer.documents.filter((doc) => !refreshedIds.has(doc.artifactId)),
        ...refreshed.documents,
      ];
      const merged: CoiFactsResponse = {
        documents: mergedDocuments,
        analyzed: mergedDocuments.filter((doc) => doc.status === "analyzed").length,
        needsAnalysis: mergedDocuments.filter(
          (doc) => doc.status === "needs_analysis",
        ).length,
        failed: mergedDocuments.filter((doc) => doc.status === "error").length,
      };
      if (activeRequest.current === request) {
        setState({ key: refreshKey, status: "done", answer: merged });
      }
      return merged;
    },
  };
}
