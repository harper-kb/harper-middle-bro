/**
 * Report on every Clerk key this machine would use, and whether Clerk still
 * recognises the instance each one points at.
 *
 * Written for one specific dead end: sign-in navigating to Clerk's Frontend API
 * and returning `{"code":"host_invalid"}` as a bare JSON page. That means a key
 * names an instance Clerk cannot attribute, but not which key — a key can arrive
 * from .env.local, from .clerk/, or from a cookie left in one browser.
 *
 * Run: npx tsx scripts/clerk-keys-check.ts
 */
import { existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import {
  frontendApiFromPublishableKey,
  instanceIsAttributable,
  readKeylessPublishableKey,
} from "../src/lib/clerk-preflight";

const KEYLESS_FILE = ".clerk/.tmp/keyless.json";
const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.development",
  ".env",
];

/** Enough of a key to recognise, never enough to use. */
function mask(key: string): string {
  return key.length <= 16 ? key : `${key.slice(0, 12)}…${key.slice(-4)}`;
}

async function describe(label: string, publishableKey: string) {
  console.log(`\n${label}`);
  console.log(`  key   ${mask(publishableKey)}`);

  const frontendApi = frontendApiFromPublishableKey(publishableKey);
  if (!frontendApi) {
    console.log("  host  — cannot be decoded from this key");
    console.log(
      "  VERDICT  unusable. Expected pk_test_ or pk_live_ followed by an",
    );
    console.log("           encoded host. Copy the key again, whole.");
    return false;
  }

  console.log(`  host  ${frontendApi}`);

  const attributable = await instanceIsAttributable(frontendApi);
  if (attributable === null) {
    console.log("  VERDICT  could not reach Clerk, so this is unproven.");
    return true;
  }
  if (attributable) {
    console.log("  VERDICT  live. Clerk recognises this instance.");
    return true;
  }
  console.log(
    "  VERDICT  dead. Clerk does not recognise this instance, and any",
  );
  console.log("           sign-in using this key ends on host_invalid JSON.");
  return false;
}

async function main() {
  loadEnvConfig(process.cwd());

  console.log("Clerk keys on this machine");
  console.log("==========================");

  console.log("\nenv files present:");
  const present = ENV_FILES.filter((file) => existsSync(file));
  console.log(
    present.length ? `  ${present.join(", ")}` : "  none (keyless mode)",
  );
  console.log(
    `  ${KEYLESS_FILE} ${existsSync(KEYLESS_FILE) ? "present" : "absent"}`,
  );

  let checked = 0;
  let allLive = true;

  const envKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (envKey) {
    checked += 1;
    allLive = (await describe("From env (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)", envKey)) && allLive;

    const secret = process.env.CLERK_SECRET_KEY;
    if (secret && envKey.startsWith("pk_live_") !== secret.startsWith("sk_live_")) {
      console.log(
        "  NOTE  the secret key is from the other environment (test vs live).",
      );
      allLive = false;
    }
    if (!secret) {
      console.log("  NOTE  CLERK_SECRET_KEY is not set alongside it.");
    }
  }

  const keylessKey = readKeylessPublishableKey();
  if (keylessKey) {
    checked += 1;
    const live = await describe(`From ${KEYLESS_FILE}`, keylessKey);
    // The env key wins at runtime, so a dead keyless key is only a real problem
    // when nothing overrides it.
    if (!envKey) allLive = live && allLive;
    else if (!live) console.log("  (env key takes precedence, so this is inert)");
  }

  if (!checked) {
    console.log("\nNo key configured anywhere.");
    console.log(
      "That is a supported state: keyless development mode provisions one on",
    );
    console.log("first page load. Just run npm run dev and open the app.");
  }

  console.log("\n----");
  if (checked && allLive) {
    console.log("Every key found here is usable.");
    console.log(
      "If sign-in still ends on host_invalid, the key is coming from your",
    );
    console.log(
      "browser rather than this checkout: keyless mode caches it in a",
    );
    console.log("__clerk_keys_ cookie, which outlives deleting .clerk/.");
    console.log(
      "Confirm by opening the app in a new incognito window. If that works,",
    );
    console.log(
      "clear cookies for localhost:3000 (DevTools → Application → Cookies).",
    );
  } else if (checked) {
    console.log("Fix the key marked dead or unusable above, then restart.");
    console.log(
      "Fastest route back to a working desk: delete .env.local and .clerk/,",
    );
    console.log(
      "clear cookies for localhost:3000, and let keyless mode start over.",
    );
  }

  // Reporting a bad key is a successful run; don't fail a diagnostic.
  process.exit(0);
}

void main();
