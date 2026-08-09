import fs from "fs";
import path from "path";
import type { Account, Policy, Underwriter } from "./types";

/**
 * Loader for the real-book overlay: a curated slice of actual Harper
 * companies/policies exported from Supabase by
 * `scripts/sync-supabase-book.mjs` into `data/supabase-book.local.json`
 * (gitignored — same privacy class as the verified-contacts overlay).
 *
 * When the file exists, `syncAccountsAndPolicies` in db.ts upserts these
 * rows on boot instead of the fictional SEED_ACCOUNTS / SEED_POLICIES.
 * A clone without the file behaves exactly as before.
 */

export interface SupabaseBook {
  fetchedAt: string;
  accounts: Account[];
  policies: Policy[];
}

const BOOK_PATH = path.join(process.cwd(), "data", "supabase-book.local.json");

/**
 * Imported accounts whose carrier has no seeded market desk hang off this
 * placeholder. The `.example` address fails the deliverability gate by
 * design — nothing can be sent until a real desk is set on the account.
 */
export const UNASSIGNED_UNDERWRITER: Underwriter = {
  id: "uw-unassigned",
  name: "Unassigned Market Desk",
  email: "unassigned@middle-bro.example",
  phone: null,
  portal: null,
  carrier: "Unassigned",
  notes:
    "Placeholder for imported accounts — no verified market contact on file. Assign a real desk before sending.",
  channelPrimary: "email",
  serviceEmail: null,
  channelNote:
    "No verified contact on file — set one on the account before requesting anything.",
};

let cache: SupabaseBook | null | undefined;

export function loadSupabaseBook(): SupabaseBook | null {
  if (cache !== undefined) return cache;
  cache = readBook();
  return cache;
}

function readBook(): SupabaseBook | null {
  try {
    if (!fs.existsSync(BOOK_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(BOOK_PATH, "utf-8")) as {
      fetchedAt?: unknown;
      accounts?: unknown;
      policies?: unknown;
    };
    const accounts = Array.isArray(parsed.accounts)
      ? (parsed.accounts as Account[])
      : null;
    const policies = Array.isArray(parsed.policies)
      ? (parsed.policies as Policy[])
      : null;
    if (!accounts || !policies || accounts.length === 0) return null;

    const accountsOk = accounts.every(
      (a) =>
        a &&
        typeof a.id === "string" &&
        typeof a.name === "string" &&
        typeof a.primaryUwId === "string" &&
        (a.status === "pre_bind" || a.status === "active" || a.status === "cancelled"),
    );
    const policiesOk = policies.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.accountId === "string" &&
        typeof p.policyNumber === "string" &&
        typeof p.effectiveDate === "string" &&
        typeof p.expirationDate === "string" &&
        Number.isFinite(p.premiumCents) &&
        Array.isArray(p.coverages),
    );
    if (!accountsOk || !policiesOk) return null;

    return {
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
      accounts,
      policies,
    };
  } catch {
    // Unreadable/invalid book → behave like a clean clone: fictional seed.
    return null;
  }
}
