import "server-only";
import fs from "fs";
import path from "path";
import committed from "./verified-contacts.data.json";
import type { VerifiedContact } from "./verified-contacts";

/**
 * Server-side loader for verified underwriter contacts.
 *
 * Base: the committed `verified-contacts.data.json` (empty in the public
 * repository). Overlay: `data/verified-contacts.local.json` — the desk's
 * private contact export, gitignored, present only on desk machines. A
 * clone without the local file simply shows no named contacts; the desk
 * never pads the list.
 */

const LOCAL_PATH = path.join(
  process.cwd(),
  "data",
  "verified-contacts.local.json",
);

let cache: VerifiedContact[] | null = null;

export function listVerifiedContacts(): VerifiedContact[] {
  if (cache) return cache;
  const base = committed as VerifiedContact[];
  let local: VerifiedContact[] = [];
  try {
    if (fs.existsSync(LOCAL_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
      if (Array.isArray(parsed)) local = parsed as VerifiedContact[];
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

export function verifiedContactsForCarrier(
  carrier: string,
): VerifiedContact[] {
  const needle = carrier.toLowerCase();
  return listVerifiedContacts().filter(
    (c) => c.carrier.toLowerCase() === needle,
  );
}
