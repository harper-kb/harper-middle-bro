import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Boot-time sanity check on the Clerk keys.
 *
 * A publishable key can be perfectly well-formed and still name an instance
 * that no longer exists — a deleted app, a half-copied key, a stale keyless
 * instance. Clerk only reports that when the browser reaches its Frontend API
 * mid-handshake, which lands the operator on raw API JSON:
 *
 *   {"errors":[{"message":"Invalid host","code":"host_invalid"}]}
 *
 * There is no way back to the app from that page and nothing names the key as
 * the culprit, so check the key here instead, while someone is still looking at
 * the terminal.
 */

const PK_PREFIXES = ["pk_test_", "pk_live_"] as const;
const KEYLESS_FILE = join(process.cwd(), ".clerk", ".tmp", "keyless.json");
const PROBE_TIMEOUT_MS = 5_000;

type KeySource = "env" | "keyless";

/** Clerk encodes the Frontend API host in the key itself, base64 with a `$` terminator. */
function frontendApiFromPublishableKey(publishableKey: string): string | null {
  const prefix = PK_PREFIXES.find((candidate) =>
    publishableKey.startsWith(candidate),
  );
  if (!prefix) return null;

  try {
    const host = Buffer.from(publishableKey.slice(prefix.length), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

function readKeylessPublishableKey(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(KEYLESS_FILE, "utf8"));
    const key =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { publishableKey?: unknown }).publishableKey
        : undefined;
    return typeof key === "string" && key ? key : null;
  } catch {
    return null;
  }
}

function report(lines: string[]): void {
  console.error(`\n  Clerk keys — ${lines.join("\n  ")}\n`);
}

/**
 * Ask the Frontend API whether it recognises the instance. Returns null when the
 * question can't be answered (offline, DNS failure, Clerk down) — an unreachable
 * network is not a bad key, and boot must not hinge on it either way.
 */
async function instanceIsAttributable(
  frontendApi: string,
): Promise<boolean | null> {
  try {
    const response = await fetch(`https://${frontendApi}/v1/environment`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.ok) return true;
    const body = await response.text();
    return body.includes("host_invalid") ? false : null;
  } catch {
    return null;
  }
}

export async function verifyClerkKeys(): Promise<void> {
  const envPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;

  const publishableKey = envPublishableKey || readKeylessPublishableKey();
  const source: KeySource = envPublishableKey ? "env" : "keyless";

  // No key at all is a supported state: Clerk's keyless mode provisions one on
  // first page load. Nothing to check yet.
  if (!publishableKey) return;

  const frontendApi = frontendApiFromPublishableKey(publishableKey);
  if (!frontendApi) {
    report([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a usable publishable key.",
      "Expected it to start with pk_test_ or pk_live_ and to decode to a host.",
      "Copy it again from https://dashboard.clerk.com → API keys, or delete",
      ".env.local entirely to let keyless development mode provision its own.",
    ]);
    return;
  }

  if (source === "env" && secretKey) {
    const pkIsLive = publishableKey.startsWith("pk_live_");
    const skIsLive = secretKey.startsWith("sk_live_");
    if (pkIsLive !== skIsLive) {
      report([
        "the publishable and secret keys belong to different instances.",
        `Publishable key is ${pkIsLive ? "live" : "test"}, secret key is ${skIsLive ? "live" : "test"}.`,
        "Both must come from the same Clerk instance.",
      ]);
    }
  }

  if ((await instanceIsAttributable(frontendApi)) !== false) return;

  report(
    source === "env"
      ? [
          `Clerk does not recognise the instance this key points at (${frontendApi}).`,
          "The key is well-formed, so it is most likely from a deleted app, or",
          "was truncated when copied. Sign-in will dead-end on Clerk's",
          '"Invalid host" JSON until it is replaced.',
          "Fix: copy the key again from https://dashboard.clerk.com → API keys,",
          "or delete .env.local to fall back to keyless development mode.",
        ]
      : [
          `the keyless instance in .clerk/ is gone (${frontendApi}).`,
          "Sign-in will dead-end on Clerk's \"Invalid host\" JSON.",
          "Fix: delete .clerk/ and reload — a fresh instance is provisioned",
          "automatically. Clear this site's cookies too, since the old key is",
          "cached in a __clerk_keys_ cookie.",
        ],
  );
}
