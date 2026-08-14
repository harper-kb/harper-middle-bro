/**
 * Self-check for the desk allowlist (src/lib/access.ts).
 *
 * The gate is deny-by-default once configured, so the cases that matter are
 * the ones that must NOT pass: suffix lookalikes, subdomains, empty input,
 * and addresses that merely contain an allowed domain.
 */

import {
  isAllowlistConfigured,
  isEmailAllowed,
  parseAllowlist,
  type Allowlist,
} from "../src/lib/access";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("[1] Parsing");
const parsed = parseAllowlist({
  DESK_ALLOWED_DOMAINS: " @harperinsure.com , Harper.com ",
  DESK_ALLOWED_EMAILS: "Contractor@Example.com",
});
check("strips @, trims, lowercases domains", parsed.domains, [
  "harperinsure.com",
  "harper.com",
]);
check("lowercases emails", parsed.emails, ["contractor@example.com"]);
check("empty env yields empty lists", parseAllowlist({}), { domains: [], emails: [] });

console.log("\n[2] Unconfigured desk is open (local development)");
const open: Allowlist = { domains: [], emails: [] };
check("not configured", isAllowlistConfigured(open), false);
check("anyone allowed", isEmailAllowed("stranger@wherever.test", open), true);

console.log("\n[3] Configured desk is deny-by-default");
const list = parseAllowlist({
  DESK_ALLOWED_DOMAINS: "harperinsure.com",
  DESK_ALLOWED_EMAILS: "contractor@example.com",
});
check("configured", isAllowlistConfigured(list), true);
check("allowed domain", isEmailAllowed("dakotah@harperinsure.com", list), true);
check("allowed domain, mixed case", isEmailAllowed("Dakotah@HarperInsure.com", list), true);
check("explicitly allowed address", isEmailAllowed("contractor@example.com", list), true);
check("unlisted address", isEmailAllowed("stranger@gmail.com", list), false);
check("unlisted address on allowed-looking host", isEmailAllowed("x@example.com", list), false);

console.log("\n[4] Lookalikes must not pass");
check("suffix lookalike", isEmailAllowed("attacker@notharperinsure.com", list), false);
check("prefix lookalike", isEmailAllowed("attacker@harperinsure.com.evil.test", list), false);
check("subdomain is not implied", isEmailAllowed("attacker@mail.harperinsure.com", list), false);
check("domain in local part", isEmailAllowed("harperinsure.com@evil.test", list), false);
check("empty string", isEmailAllowed("", list), false);
check("no @", isEmailAllowed("harperinsure.com", list), false);
check("trailing @", isEmailAllowed("someone@", list), false);
check("leading @", isEmailAllowed("@harperinsure.com", list), false);

console.log("\n---");
if (failures === 0) {
  console.log("Access allowlist: all checks green.");
  process.exit(0);
}
console.error(`Access allowlist: ${failures} check(s) FAILED.`);
process.exit(1);
