import fs from "fs";
import path from "path";
import { gunzipSync } from "node:zlib";
import { BOOK_SNAPSHOT_B64 } from "./book-snapshot";
import type { PolicyFormSet } from "./forms";
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
  /**
   * Schedule of record per policy id, when the export carried the coverage
   * lines. Without it every imported policy resolves `unscheduled` and its
   * certificate prints identity and nothing else — accounts and policies
   * alone cannot fill an ACORD form. Optional so an older export still
   * loads, minus the limits.
   */
  schedules?: Record<string, PolicyFormSet>;
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

export type BookSource = "overlay" | "env" | "snapshot" | "seed";

let source: BookSource = "seed";

/** Where the serving book came from. Answers "is this real?" for an operator. */
export function bookSource(): BookSource {
  loadSupabaseBook();
  return source;
}

/**
 * The book as an environment variable: gzipped JSON, base64, optionally
 * split across numbered parts because a whole book of real policies is
 * larger than some platforms allow in one value.
 *
 * A deployed instance has no `data/` — the directory is gitignored, which
 * is the right call for customer data and also the reason production has
 * only ever booted the fictional seed. This is how the real book reaches a
 * running instance without ever entering the repository.
 */
function readBookFromEnv(): string | null {
  const parts: string[] = [];
  if (process.env.HARPER_BOOK_B64) parts.push(process.env.HARPER_BOOK_B64);
  for (let i = 1; i <= 40; i++) {
    const part = process.env[`HARPER_BOOK_B64_${i}`];
    if (!part) break;
    parts.push(part);
  }
  if (parts.length === 0) return null;
  return inflate(parts.join(""), "HARPER_BOOK_B64");
}

/**
 * The book committed to the repository. Last in line, so a real overlay or
 * a configured deployment always wins, and an instance with neither still
 * serves real accounts rather than the fictional seed.
 */
function readBookFromSnapshot(): string | null {
  if (!BOOK_SNAPSHOT_B64) return null;
  return inflate(BOOK_SNAPSHOT_B64, "book-snapshot.ts");
}

function inflate(b64: string, source: string): string | null {
  try {
    return gunzipSync(Buffer.from(b64, "base64")).toString("utf-8");
  } catch {
    // A truncated or mis-pasted value must not look like an empty book:
    // returning null falls through to the next source and ultimately to the
    // seed, which is visibly fictional, rather than to a half-book that
    // reads as real.
    console.error(
      `[supabase-book] ${source} present but unreadable — falling through.`,
    );
    return null;
  }
}

function readBook(): SupabaseBook | null {
  try {
    // Order matters: a local overlay beats a deployment's variables, which
    // beat the committed snapshot. Each is a more deliberate statement than
    // the one after it.
    let raw: string | null = null;
    if (fs.existsSync(BOOK_PATH)) {
      raw = fs.readFileSync(BOOK_PATH, "utf-8");
      source = "overlay";
    }
    if (!raw && (raw = readBookFromEnv())) source = "env";
    if (!raw && (raw = readBookFromSnapshot())) source = "snapshot";
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
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

    // A malformed schedule block drops rather than failing the whole book:
    // the accounts and policies are still worth having, and a policy
    // without a schedule already has an honest rendering.
    const rawSchedules = (parsed as { schedules?: unknown }).schedules;
    const schedules =
      rawSchedules && typeof rawSchedules === "object" && !Array.isArray(rawSchedules)
        ? Object.fromEntries(
            Object.entries(rawSchedules as Record<string, PolicyFormSet>).filter(
              ([, set]) =>
                set &&
                Array.isArray(set.coverages) &&
                Array.isArray(set.limits) &&
                Array.isArray(set.endorsements),
            ),
          )
        : undefined;

    return {
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
      accounts,
      policies,
      schedules,
    };
  } catch {
    // Unreadable/invalid book → behave like a clean clone: fictional seed.
    return null;
  }
}
