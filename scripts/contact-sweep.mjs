/**
 * Data hygiene sweep — runs every seed/demo email and address through the
 * live validation routes (/api/validate/email, /api/validate/address) and
 * prints the verdicts. Requires the dev server on :3000.
 *
 *   node scripts/contact-sweep.mjs
 */
import { readFile } from "node:fs/promises";

const BASE = process.env.SWEEP_BASE ?? "http://localhost:3000";

async function extract(file, regex) {
  const text = await readFile(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
  const out = [];
  for (const m of text.matchAll(regex)) out.push(m[1]);
  return out;
}

const emails = new Set([
  ...(await extract("seed.ts", /(?:email|serviceEmail):\s*"([^"]+@[^"]+)"/g)),
  ...(await extract("tickets-seed.ts", /requestedByEmail:\s*"([^"]+)"/g)),
  ...(await extract("operators-seed.ts", /email:\s*"([^"]+@[^"]+)"/g)),
]);
const addresses = new Set(
  await extract("tickets-seed.ts", /holderAddress:\s*"([^"]+)"/g),
);

async function check(kind, value) {
  const res = await fetch(`${BASE}/api/validate/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [kind === "email" ? "email" : "address"]: value }),
  });
  return res.json();
}

console.log(`— Emails (${emails.size}) —`);
for (const e of emails) {
  const v = await check("email", e);
  const flag = v.status === "deliverable_domain" ? "PASS" : "FAIL";
  console.log(
    `${flag}  ${e}  →  ${v.status}${v.suggestion ? ` (suggest ${v.suggestion})` : ""}`,
  );
}

console.log(`\n— Addresses (${addresses.size}) —`);
for (const a of addresses) {
  const v = await check("address", a);
  const flag = v.status === "verified" || v.status === "corrected" ? "PASS" : "FAIL";
  console.log(
    `${flag}  ${a}  →  ${v.status}${v.matchedAddress ? `  [${v.matchedAddress}]` : ""}`,
  );
}
