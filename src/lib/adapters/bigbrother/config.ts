import "server-only";

/**
 * BigBrother live-read credentials. When either value is missing, every
 * lane adapter must return labeled sample mode — never fabricate live counts.
 *
 * Env:
 *   BIGBROTHER_BASE_URL  — e.g. https://bigbrother.example.com (no trailing slash)
 *   BIGBROTHER_API_TOKEN — bearer token for service-workbench internal APIs
 */
export type BigBrotherCredentials = {
  baseUrl: string;
  apiToken: string;
};

export function readBigBrotherCredentials(): BigBrotherCredentials | null {
  const baseUrl = process.env.BIGBROTHER_BASE_URL?.trim().replace(/\/+$/, "");
  const apiToken = process.env.BIGBROTHER_API_TOKEN?.trim();
  if (!baseUrl || !apiToken) return null;
  return { baseUrl, apiToken };
}

export function bigBrotherConfigured(): boolean {
  return readBigBrotherCredentials() != null;
}

export const BIGBROTHER_SOURCE = {
  swimLanes: "bigbrother://api/service-workbench/swim-lanes",
  unboundAccounts: "bigbrother://api/service-workbench/unbound-accounts",
  account: "bigbrother://api/crm/service-dashboard/company",
} as const;
