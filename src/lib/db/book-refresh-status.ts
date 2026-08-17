import "server-only";

import fs from "fs";
import path from "path";

export type BookRefreshAttemptStatus = "success" | "failed";

export interface BookRefreshStatus {
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: BookRefreshAttemptStatus | null;
  /**
   * Last whole-book pull, as opposed to an incremental tick. Persisted so a
   * restart resumes the reconcile schedule instead of spending a full pull on
   * every process start — in dev that is every hot restart.
   */
  lastFullRefreshAt: string | null;
}

const STATUS_PATH = path.join(
  process.cwd(),
  "data",
  "book-refresh-status.local.json",
);

const EMPTY_STATUS: BookRefreshStatus = {
  lastSuccessfulAt: null,
  lastAttemptAt: null,
  lastAttemptStatus: null,
  lastFullRefreshAt: null,
};

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

export function readBookRefreshStatus(): BookRefreshStatus {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as {
      lastSuccessfulAt?: unknown;
      lastAttemptAt?: unknown;
      lastAttemptStatus?: unknown;
      lastFullRefreshAt?: unknown;
    };
    const attemptStatus =
      parsed.lastAttemptStatus === "success" ||
      parsed.lastAttemptStatus === "failed"
        ? parsed.lastAttemptStatus
        : null;
    return {
      lastSuccessfulAt: validTimestamp(parsed.lastSuccessfulAt),
      lastAttemptAt: validTimestamp(parsed.lastAttemptAt),
      lastAttemptStatus: attemptStatus,
      lastFullRefreshAt: validTimestamp(parsed.lastFullRefreshAt),
    };
  } catch {
    return EMPTY_STATUS;
  }
}

function writeBookRefreshStatus(status: BookRefreshStatus): void {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  const tempPath = `${STATUS_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(status)}\n`);
  fs.renameSync(tempPath, STATUS_PATH);
}

export function recordBookRefreshSuccess(
  completedAt: string,
  options: { full?: boolean } = {},
): void {
  const previous = readBookRefreshStatus();
  writeBookRefreshStatus({
    lastSuccessfulAt: completedAt,
    lastAttemptAt: completedAt,
    lastAttemptStatus: "success",
    lastFullRefreshAt: options.full
      ? completedAt
      : previous.lastFullRefreshAt,
  });
}

export function recordBookRefreshFailure(failedAt: string): void {
  const previous = readBookRefreshStatus();
  writeBookRefreshStatus({
    lastSuccessfulAt: previous.lastSuccessfulAt,
    lastAttemptAt: failedAt,
    lastAttemptStatus: "failed",
    lastFullRefreshAt: previous.lastFullRefreshAt,
  });
}
