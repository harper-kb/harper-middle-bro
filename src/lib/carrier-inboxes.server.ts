import "server-only";
import fs from "fs";
import path from "path";
import committed from "./carrier-inboxes.data.json";
import type { CarrierServiceInbox } from "./carrier-inboxes";

/**
 * Server-side loader for carrier service inboxes.
 *
 * Base: the committed `carrier-inboxes.data.json` (empty in the public
 * repository). Overlay: `data/carrier-inboxes.local.json` — the desk's
 * private export of functional carrier mailboxes, gitignored, present only
 * on desk machines. A clone without the local file simply shows no service
 * inboxes; the desk never pads the list.
 */

const LOCAL_PATH = path.join(
  process.cwd(),
  "data",
  "carrier-inboxes.local.json",
);

let cache: CarrierServiceInbox[] | null = null;

export function listCarrierServiceInboxes(): CarrierServiceInbox[] {
  if (cache) return cache;
  const base = committed as CarrierServiceInbox[];
  let local: CarrierServiceInbox[] = [];
  try {
    if (fs.existsSync(LOCAL_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
      if (Array.isArray(parsed)) local = parsed as CarrierServiceInbox[];
    }
  } catch {
    // Unreadable local file → behave like a clean clone: base only.
  }
  const seen = new Set(base.map((c) => c.email.toLowerCase()));
  cache = [
    ...base,
    ...local.filter((c) => !seen.has(c.email.toLowerCase())),
  ];
  return cache;
}

export function serviceInboxesForCarrier(
  carrier: string,
): CarrierServiceInbox[] {
  const needle = carrier.toLowerCase();
  return listCarrierServiceInboxes().filter(
    (c) => c.carrier.toLowerCase() === needle,
  );
}
