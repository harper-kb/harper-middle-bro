import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import {
  frontendApiFromPublishableKey,
  instanceIsAttributable,
  readKeylessPublishableKey,
} from "@/lib/clerk-preflight";

/**
 * Escape hatch for a Clerk instance that no longer exists.
 *
 * A dead publishable key sends the browser to Clerk's Frontend API, which
 * answers with bare `{"code":"host_invalid"}` JSON — no app shell, no way back,
 * and no indication of which of the three key sources is at fault. Two of those
 * sources are ours to clear: the keyless credentials cached in `.clerk/`, and
 * the `__clerk_keys_` cookie that outlives deleting them. Clearing both lets
 * keyless mode provision a fresh instance on the next page load.
 *
 * The third source, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, is compiled into the
 * client bundle and cannot be cleared from here, so it is reported instead.
 *
 * Development only — nothing here should be reachable on a deployed instance.
 */

const KEYLESS_DIR = join(process.cwd(), ".clerk");
const CLEARABLE_COOKIE_PREFIXES = [
  "__clerk",
  "__client_uat",
  "__session",
  "__dev_session",
];

function page(title: string, bodyHtml: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light }
  body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 34rem;
         margin: 12vh auto; padding: 0 1.5rem; color: #1c1917 }
  h1 { font-size: 1.35rem; margin: 0 0 1rem }
  h2 { font-size: 1rem; margin: 1.75rem 0 .5rem }
  code { background: #f5f5f4; padding: .1rem .3rem; border-radius: 3px;
         font: 13px ui-monospace, monospace }
  pre { background: #f5f5f4; padding: .75rem; border-radius: 6px; overflow-x: auto;
        font: 13px ui-monospace, monospace }
  ul { padding-left: 1.1rem } li { margin: .25rem 0 }
  a.cta { display: inline-block; margin-top: 1.5rem; background: #1c1917;
          color: #fff; text-decoration: none; padding: .55rem 1.1rem;
          border-radius: 6px; font-weight: 600 }
  .muted { color: #78716c; font-size: .9rem }
</style></head>
<body>${bodyHtml}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not found", { status: 404 });
  }

  const cleared: string[] = [];

  const keylessKey = readKeylessPublishableKey();
  if (existsSync(KEYLESS_DIR)) {
    await rm(KEYLESS_DIR, { recursive: true, force: true });
    cleared.push(
      keylessKey
        ? `deleted <code>.clerk/</code>, which held a key for <code>${frontendApiFromPublishableKey(keylessKey) ?? "an unreadable host"}</code>`
        : "deleted <code>.clerk/</code>",
    );
  }

  const staleCookies = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) =>
      CLEARABLE_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
  if (staleCookies.length) {
    cleared.push(
      `cleared ${staleCookies.length} Clerk cookie${staleCookies.length === 1 ? "" : "s"} (<code>${staleCookies.join("</code>, <code>")}</code>)`,
    );
  }

  // An env key is compiled into the client bundle, so clearing it here would not
  // reach the browser. Say so plainly instead of pretending the reset was total.
  const envKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  let envWarning = "";
  if (envKey) {
    const host = frontendApiFromPublishableKey(envKey);
    const attributable = host ? await instanceIsAttributable(host) : false;
    if (attributable === false) {
      envWarning = `
      <h2>One Thing This Could Not Fix</h2>
      <p><code>.env.local</code> sets a publishable key for
      <code>${host ?? "an undecodable host"}</code>, and Clerk does not recognise
      that instance. That key is compiled into the browser bundle, so clearing it
      from here would not reach your browser.</p>
      <p>Delete these two lines from <code>.env.local</code> and restart the dev
      server, which drops you back into keyless mode:</p>
      <pre>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...</pre>`;
    } else if (attributable) {
      envWarning = `
      <h2>Your Env Key Is Fine</h2>
      <p class="muted"><code>.env.local</code> points at
      <code>${host}</code>, which Clerk recognises, so it was left alone.</p>`;
    }
  }

  const summary = cleared.length
    ? `<ul><li>${cleared.join("</li><li>")}</li></ul>`
    : "<p>There was nothing cached to clear — no <code>.clerk/</code> directory and no Clerk cookies.</p>";

  const response = page(
    "Clerk State Cleared",
    `<h1>Clerk State Cleared</h1>
     ${summary}
     ${envWarning}
     <h2>Next Step</h2>
     <p>Open the desk again. With no cached credentials, Clerk's keyless mode
     provisions a fresh instance on the next page load.</p>
     <a class="cta" href="/sign-in">Continue To Sign In</a>`,
  );

  // A bare IP or `localhost` is not a legal cookie domain, so the Domain variant
  // is only worth sending for a real dotted host, where Clerk may have set the
  // cookie on the parent domain.
  const { hostname } = request.nextUrl;
  const domainWorthClearing =
    hostname.includes(".") && !/^\d+(\.\d+){3}$/.test(hostname)
      ? hostname
      : null;

  for (const name of staleCookies) {
    response.headers.append(
      "set-cookie",
      `${name}=; Path=/; Max-Age=0; SameSite=Lax`,
    );
    if (domainWorthClearing) {
      response.headers.append(
        "set-cookie",
        `${name}=; Path=/; Max-Age=0; SameSite=Lax; Domain=${domainWorthClearing}`,
      );
    }
  }

  return response;
}
