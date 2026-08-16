import "server-only";

import fs from "fs";
import path from "path";

export type BookRefreshAttemptStatus = "success" | "failed";

export interface BookRefreshStatus {
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: BookRefreshAttemptStatus | null;
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

export function recordBookRefreshSuccess(completedAt: string): void {
  writeBookRefreshStatus({
    lastSuccessfulAt: completedAt,
    lastAttemptAt: completedAt,
    lastAttemptStatus: "success",
  });
}

export function recordBookRefreshFailure(failedAt: string): void {
  const previous = readBookRefreshStatus();
  writeBookRefreshStatus({
    lastSuccessfulAt: previous.lastSuccessfulAt,
    lastAttemptAt: failedAt,
    lastAttemptStatus: "failed",
  });
}
