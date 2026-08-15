/**
 * The insured's address is the INSURED box. A wrong one names the wrong
 * party on a document a third party relies on, and a blank one is the
 * certificate the desk cannot issue.
 */

import {
  industryFromCompany,
  prefillFromCompany,
  stateCode,
} from "../src/lib/adapters/harper/company";
import { mapAccount } from "../src/lib/adapters/harper/policy-state";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— States ————— */

// The export spells it both ways, and the ACORD cell is two characters.
check(stateCode("CA") === "CA", "A code passes through");
check(stateCode("ca") === "CA", "A lowercase code is upper-cased");
check(stateCode("California") === "CA", "A full name resolves to its code");
check(stateCode("new  york") === "NY", "Extra spacing in a name still resolves");
check(stateCode("District of Columbia") === "DC", "DC resolves");
check(stateCode("Puerto Rico") === "PR", "Territories resolve");
// Blank, not a guess: naming the wrong jurisdiction on a certificate is
// worse than leaving the desk to fill it.
check(stateCode("Ontario") === "", "A state this table cannot resolve stays blank");
check(stateCode(null) === "" && stateCode("") === "", "Absent stays blank");

/* ————— The address ————— */

const prefill = prefillFromCompany({
  address: {
    street1: "9419 South K14 Highway,",
    street2: "",
    city: "Hutchinson",
    state: "Kansas",
    postal_code: "67501",
  },
});
// Keyed addresses carry trailing punctuation, which would print verbatim.
check(
  prefill.NamedInsured_MailingAddress_LineOne_A === "9419 South K14 Highway",
  "A trailing comma is trimmed off the street line",
  prefill.NamedInsured_MailingAddress_LineOne_A,
);
check(
  prefill.NamedInsured_MailingAddress_StateOrProvinceCode_A === "KS",
  "The state is normalised on the way in",
);
check(
  !("NamedInsured_MailingAddress_LineTwo_A" in prefill),
  "An empty second line is omitted, not stored as an empty string",
);

const account = mapAccount({
  companyId: "5966",
  prefill,
  fallbackName: "Phoenix Recovery Of Kansas, LLC",
  underwriterId: "uw-unassigned",
  industry: "Auto Services · Towing Services - Tow Truck",
});
check(account.city === "Hutchinson" && account.state === "KS", "The account carries the address");
check(account.zip === "67501", "…and the postal code");
check(
  account.industry === "Auto Services · Towing Services - Tow Truck",
  "…and the industry, instead of an em dash",
);

/* ————— Nothing to say ————— */

const empty = mapAccount({
  companyId: "1",
  prefill: prefillFromCompany({}),
  fallbackName: "No Address Co",
  underwriterId: "uw-unassigned",
});
check(
  empty.addressLine1 === null && empty.city === null && empty.state === "",
  "A company with no address yields blanks the sheet prints as blank",
);
check(empty.industry === "—", "…and no industry rather than an invented one");
check(
  industryFromCompany({ industry: "Retail" }) === "Retail" &&
    industryFromCompany({ industry: "Retail", sub_industry: "Tire Dealers" }) ===
      "Retail · Tire Dealers",
  "Industry reads as one line whether or not a sub-industry is stated",
);

console.log(failed === 0 ? "\nAll company checks passed." : `\n${failed} FAILURE(S).`);
if (failed > 0) process.exit(1);
