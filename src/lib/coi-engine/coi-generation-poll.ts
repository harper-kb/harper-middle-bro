export interface CompletedCoiGeneration {
  certificateId: number;
  formType: "acord25" | "acord30";
  updatedAt: string | null;
  fieldValues: Record<string, string>;
  sourceWarnings: string[];
}

export interface CoiGenerationProgress {
  status: string;
  percent: number;
  label: string;
}

interface CertificatePollResponse {
  certificateId?: unknown;
  formType?: unknown;
  status?: unknown;
  updatedAt?: unknown;
  fieldValues?: unknown;
  generation?: {
    error?: { message?: unknown; stage?: unknown };
    source_warnings?: unknown;
    missing_fields?: unknown;
  } | null;
  error?: unknown;
}

const COMPLETE = new Set(["draft", "final"]);
const FAILED = new Set(["failed", "canceled"]);
const SUPERSEDED = "superseded";
const COMPOSING_PHASE = new Set(["composing", "validating", "draft", "final"]);

const PROGRESS_BY_STATUS: Record<string, Omit<CoiGenerationProgress, "status">> = {
  queued: { percent: 8, label: "Queued" },
  resolving_sources: { percent: 22, label: "Checking selected documents" },
  extracting: { percent: 55, label: "Extracting policy facts" },
  composing: { percent: 82, label: "Composing certificate" },
  validating: { percent: 94, label: "Validating certificate" },
  draft: { percent: 100, label: "Certificate ready" },
  final: { percent: 100, label: "Certificate ready" },
};

export function coiGenerationProgress(status: unknown): CoiGenerationProgress {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "queued";
  return {
    status: normalized,
    ...(PROGRESS_BY_STATUS[normalized] ?? PROGRESS_BY_STATUS.queued),
  };
}

/** Keep the coarse modal phase aligned with every post-extraction stage. */
export function coiGenerationWorkPhase(
  status: unknown,
): "reading" | "composing" {
  const normalized =
    typeof status === "string" ? status.trim().toLowerCase() : "queued";
  return COMPOSING_PHASE.has(normalized) ? "composing" : "reading";
}

export function coiGenerationFailureMessage(
  _message: unknown,
  stage: unknown,
): string {
  const normalizedStage =
    typeof stage === "string" ? stage.trim().toLowerCase() : "";
  const progress = coiGenerationProgress(normalizedStage);
  if (
    normalizedStage in PROGRESS_BY_STATUS &&
    !COMPLETE.has(normalizedStage)
  ) {
    return `Certificate generation failed while ${progress.label.toLowerCase()}.`;
  }
  return "Certificate generation failed. Try again or choose different source documents.";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Poll the existing certificate resource; Temporal remains the status source. */
export async function waitForCoiGeneration(args: {
  companyId: string;
  certificateId: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: CoiGenerationProgress) => void;
}): Promise<CompletedCoiGeneration> {
  const deadline = Date.now() + (args.timeoutMs ?? 10 * 60_000);
  while (Date.now() < deadline) {
    const response = await fetch(
      `/api/coi/certificate/${encodeURIComponent(args.companyId)}?certificateId=${args.certificateId}`,
      { cache: "no-store", signal: args.signal },
    );
    const body = (await response.json().catch(() => null)) as CertificatePollResponse | null;
    if (response.ok && Number(body?.certificateId) === args.certificateId) {
      const status = typeof body?.status === "string" ? body.status : "";
      args.onProgress?.(coiGenerationProgress(status));
      if (COMPLETE.has(status)) {
        const sourceWarnings = Array.isArray(body?.generation?.source_warnings)
          ? body.generation.source_warnings.filter(
              (warning): warning is string =>
                typeof warning === "string" && warning.trim().length > 0,
            )
          : [];
        const missingFields = Array.isArray(body?.generation?.missing_fields)
          ? body.generation.missing_fields.filter(
              (field): field is string =>
                typeof field === "string" && field.trim().length > 0,
            )
          : [];
        return {
          certificateId: args.certificateId,
          formType: body?.formType === "acord30" ? "acord30" : "acord25",
          updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : null,
          fieldValues:
            body?.fieldValues && typeof body.fieldValues === "object"
              ? (body.fieldValues as Record<string, string>)
              : {},
          sourceWarnings: [
            ...sourceWarnings,
            ...(missingFields.length
              ? [
                  `${missingFields.length} certificate ${
                    missingFields.length === 1 ? "value was" : "values were"
                  } not found. Review the blank fields before sending.`,
                ]
              : []),
          ],
        };
      }
      if (FAILED.has(status)) {
        throw new Error(
          coiGenerationFailureMessage(
            body?.generation?.error?.message,
            body?.generation?.error?.stage,
          ),
        );
      }
      if (status === SUPERSEDED) {
        throw new Error(
          "This certificate was replaced by a newer generation request. Review the newer certificate instead.",
        );
      }
    }
    await delay(1_000, args.signal);
  }
  throw new Error("Certificate generation is still running. You can leave this page and return later.");
}
