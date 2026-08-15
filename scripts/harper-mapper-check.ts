/**
 * Self-check: the Harper `data.policy-state.v1` → desk mapping.
 *
 * Run: npx tsx scripts/harper-mapper-check.ts
 *
 * Fixtures are the real contract's shape with invented names and numbers —
 * the production book is customer data and does not belong in the repo.
 *
 * The mapping's whole job is to not repeat the mistake this codebase keeps
 * making: reading a value without the context that gives it meaning. The
 * same canonical limit type means a different ACORD box on a different
 * coverage line, and getting that wrong files a professional each-claim
 * limit in the general liability occurrence box.
 */

import {
  coveragePartBasis,
  coveragePartLabel,
  mapAccount,
  mapEndorsements,
  mapPolicy,
  parseMoneyCents,
  splitForm,
  type HarperPolicyRow,
} from "../src/lib/adapters/harper/policy-state";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— Parsing ————— */

check(parseMoneyCents("$1,139.88") === 113988, "Money parses to cents");
check(parseMoneyCents("$750,000") === 75000000, "Whole-dollar money parses");
check(parseMoneyCents(null) === null, "Missing money is null, not zero");
check(parseMoneyCents("n/a") === null, "Unreadable money is null, not zero");

const iso = splitForm("CG 00 01 04 13");
check(
  iso.form === "CG 00 01" && iso.edition === "04 13",
  "An ISO form splits into form and edition",
  `${iso.form} | ${iso.edition}`,
);
const proprietary = splitForm("NXUS-GL-0001.1-0619");
check(
  proprietary.form === "NXUS-GL-0001.1" && proprietary.edition === "06 19",
  "A carrier-proprietary form's trailing MMYY is read as its edition",
  JSON.stringify(proprietary),
);
check(splitForm(null).form === "—", "A missing form prints the em-dash, not a guess");

/* ————— The scoping rule ————— */

const gl: HarperPolicyRow = {
  policy_id: "1",
  policy_number: "TEST-GL-1",
  named_insured: "Fixture Co LLC",
  effective_date: "2026-11-05T00:00:00.000Z",
  expiration_date: "2027-11-05T00:00:00.000Z",
  company_id: "999",
  coverage_lines: [
    {
      canonical_coverage_type: "GENERAL_LIABILITY",
      source_coverage_label: "Commercial General Liability Coverage Part",
      coverage_form: "CG 00 01 04 13",
      coverage_basis: "OCCURRENCE",
      premium: "$593.88",
      carrier: { name: "Next Insurance US Company" },
      limits: [
        { canonical_limit_type: "EACH_OCCURRENCE_OR_CLAIM", amount: "$500,000.00" },
        { canonical_limit_type: "GENERAL_AGGREGATE", amount: "$1,000,000.00" },
        { canonical_limit_type: "MEDICAL_EXPENSE", amount: "$15,000.00" },
      ],
    },
    {
      canonical_coverage_type: "PROFESSIONAL_LIABILITY",
      source_coverage_label: "Professional Liability Coverage Part",
      coverage_form: "HSX-PL 100 06 22",
      coverage_basis: "CLAIMS_MADE",
      premium: "$210.00",
      limits: [
        { canonical_limit_type: "EACH_OCCURRENCE_OR_CLAIM", amount: "$1,000,000.00" },
        { canonical_limit_type: "GENERAL_AGGREGATE", amount: "$1,000,000.00" },
      ],
    },
  ],
};

const mapped = mapPolicy(gl, "acct-h-999")!;
check(mapped != null, "A complete row maps");
const slots = Object.fromEntries(
  mapped.set.limits.map((l) => [l.slot, l.amountCents]),
);
check(
  slots.gl_each_occurrence === 50000000,
  "EACH_OCCURRENCE_OR_CLAIM on a GL line is the occurrence box",
  JSON.stringify(slots),
);
check(
  slots.prof_each_claim === 100000000,
  "…and the SAME canonical type on a professional line is the each-claim box",
  JSON.stringify(slots),
);
check(
  slots.gl_general_aggregate === 100000000 && slots.prof_aggregate === 100000000,
  "GENERAL_AGGREGATE lands in the aggregate box of its own line, both times",
  JSON.stringify(slots),
);
check(
  mapped.policy.premiumCents === 80388,
  "Premium is the sum of the coverage lines",
  String(mapped.policy.premiumCents),
);
check(
  mapped.policy.coverages.join(",") === "GL,PL",
  "Coverage codes come off the canonical type",
  mapped.policy.coverages.join(","),
);

/* ————— Coverage basis ————— */

// Coterie writes its own forms with the edition spaced off the number.
// Reading only the unspaced MMYY dropped every one of them for want of an
// edition — including the blanket additional insured, which is the
// endorsement a certificate most often turns on.
{
  const aiol = splitForm("CTF CW AIOL 06 22");
  check(
    aiol.form === "CTF CW AIOL" && aiol.edition === "06 22",
    "A proprietary form with a spaced edition splits",
    `${aiol.form} | ${aiol.edition}`,
  );
  const iso = splitForm("BP 14 88 07 13");
  check(
    iso.form === "BP 14 88" && iso.edition === "07 13",
    "…and an ISO number still splits the same way",
    `${iso.form} | ${iso.edition}`,
  );
  // Four digits that are not a month are not an edition, spaced or not.
  const notMonth = splitForm("GL FORM 47 22");
  check(
    notMonth.form === "GL FORM 47 22" && notMonth.edition === "",
    "A trailing group that is not a month stays part of the number",
    `${notMonth.form} | ${notMonth.edition}`,
  );
}

check(
  coveragePartBasis(gl.coverage_lines![0]) === "occurrence",
  "An occurrence line states occurrence as a fact, not as prose in its label",
);
check(
  coveragePartBasis(gl.coverage_lines![1]) === "claims-made",
  "A claims-made line states claims-made as a fact",
);
check(
  coveragePartBasis({
    canonical_coverage_type: "GENERAL_LIABILITY",
    source_coverage_label: "Commercial General Liability",
    coverage_basis: "UNKNOWN",
  }) === undefined,
  "An UNKNOWN basis states nothing either way",
);
check(
  coveragePartBasis({
    canonical_coverage_type: "GENERAL_LIABILITY",
    source_coverage_label: "Commercial General Liability",
  }) === undefined,
  "A missing basis states nothing either way",
);
// The label carried the basis once, and real paper punished it: a part
// named for a claims-made product sits on a line the dec calls occurrence.
// The fact must survive the label saying otherwise.
check(
  coveragePartBasis({
    canonical_coverage_type: "PROFESSIONAL_LIABILITY",
    source_coverage_label: "Claims-Made Professional Package",
    coverage_basis: "OCCURRENCE",
  }) === "occurrence" &&
    /claims-made/i.test(
      coveragePartLabel({
        canonical_coverage_type: "PROFESSIONAL_LIABILITY",
        source_coverage_label: "Claims-Made Professional Package",
        coverage_basis: "OCCURRENCE",
      }),
    ),
  "The dec outranks the product name when the two disagree",
);

/* ————— What the desk cannot print ————— */

const withUnmappable = mapPolicy(
  {
    ...gl,
    policy_id: "2",
    coverage_lines: [
      {
        canonical_coverage_type: "AUTOMOBILE_LIABILITY",
        source_coverage_label: "Uninsured Motorist",
        limits: [
          { canonical_limit_type: "COMBINED_SINGLE_LIMIT", amount: "$750,000" },
          { canonical_limit_type: "OTHER", label: "each person", amount: "$50,000" },
        ],
      },
    ],
  },
  "acct-h-999",
)!;
check(
  withUnmappable.set.limits.length === 1 &&
    withUnmappable.set.limits[0].slot === "auto_combined_single",
  "A limit with no ACORD box is left out rather than forced into a near one",
);
check(
  withUnmappable.droppedLimits.length === 1 &&
    /each person/.test(withUnmappable.droppedLimits[0].label),
  "…and it is reported, so the gap is visible to the operator",
  JSON.stringify(withUnmappable.droppedLimits),
);

/* ————— Refusals ————— */

check(
  mapPolicy({ ...gl, policy_number: "  " }, "acct-h-999") === null,
  "A row with no policy number does not import",
);
check(
  mapPolicy({ ...gl, effective_date: null }, "acct-h-999") === null,
  "A row with no term does not import",
);
const noLines = mapPolicy({ ...gl, policy_id: "3", coverage_lines: [] }, "acct-h-999")!;
check(
  noLines.set.unscheduled === true,
  "A policy with no coverage lines imports as unscheduled, not as an empty schedule",
);

/* ————— The account ————— */

const acct = mapAccount({
  companyId: "999",
  prefill: {
    NamedInsured_FullName_A: "Fixture Co LLC",
    NamedInsured_MailingAddress_LineOne_A: "3595 Example Highway",
    NamedInsured_MailingAddress_LineTwo_A: "Ste 219",
    NamedInsured_MailingAddress_CityName_A: "Hiram",
    NamedInsured_MailingAddress_StateOrProvinceCode_A: "GA",
    NamedInsured_MailingAddress_PostalCode_A: "30141",
  },
  fallbackName: "ignored",
  underwriterId: "uw-unassigned",
});
check(
  acct.addressLine1 === "3595 Example Highway, Ste 219" &&
    acct.city === "Hiram" &&
    acct.state === "GA" &&
    acct.zip === "30141",
  "The insured's address comes off the ACORD 125 prefill",
  JSON.stringify(acct),
);
const noPrefill = mapAccount({
  companyId: "998",
  prefill: null,
  fallbackName: "Nameless Co",
  underwriterId: "uw-unassigned",
});
check(
  noPrefill.name === "Nameless Co" &&
    noPrefill.addressLine1 === null &&
    noPrefill.city === null,
  "No prefill means a blank address, never an invented one",
);

/* ————— Endorsements ————— */

const endt = mapEndorsements({
  extraction_data: {
    policy: {
      endorsements: [
        {
          form_number: "NXUS-GL-2037.2-0925",
          title: "BLANKET ADDITIONAL INSURED",
          additional_insured_name:
            "Blanket (Managers or Lessors of Premises as required by written contract)",
        },
        {
          form_number: "CG 20 10 04 13",
          title: "Additional Insured — Owners, Lessees or Contractors",
          additional_insured_name: "Desert Plaza Owners Association",
        },
        { form_number: "CG 24 04 05 09", title: "Waiver of Transfer of Rights" },
        { form_number: "CG 20 01 04 13", title: "Primary And Noncontributory" },
        { form_number: "CG 21 47 12 07", title: "EMPLOYMENT-RELATED PRACTICES EXCLUSION" },
        { form_number: "NXT-BROKEN-9999", title: "Additional Insured — No Readable Edition" },
      ],
    },
  },
});
const byForm = Object.fromEntries(endt.endorsements.map((e) => [e.form, e]));

check(
  byForm["NXUS-GL-2037.2"]?.edition === "09 25",
  "A carrier-proprietary form's trailing MMYY is its edition",
  JSON.stringify(byForm["NXUS-GL-2037.2"]),
);
check(
  byForm["NXUS-GL-2037.2"]?.kind === "ai" &&
    byForm["NXUS-GL-2037.2"]?.scope === "blanket",
  "Blanket wording earns blanket scope",
);
check(
  byForm["CG 20 10"]?.kind === "ai" && byForm["CG 20 10"]?.scope === "scheduled",
  "A named additional insured is scheduled, not blanket",
  JSON.stringify(byForm["CG 20 10"]),
);
check(
  byForm["CG 24 04"]?.kind === "wos" && byForm["CG 20 01"]?.kind === "pnc",
  "Waiver and primary-and-noncontributory are classified off their ISO numbers",
);
check(
  byForm["CG 21 47"]?.kind === "exclusion",
  "A CG 21 form is an exclusion, not something a certificate can claim",
);
check(
  endt.withoutIdentity.length === 1 &&
    /NXT-BROKEN-9999/.test(endt.withoutIdentity[0]),
  "An endorsement with no readable edition is reported, never filed as backing",
  JSON.stringify(endt.withoutIdentity),
);
check(
  !endt.endorsements.some((e) => e.form === "NXT-BROKEN-9999"),
  "…and it does not reach the schedule, so it cannot back a claim",
);
check(
  splitForm("NXUS-GL-2158.1-GA-1324").edition === "",
  "Four trailing digits that are not a month do not become an edition",
  JSON.stringify(splitForm("NXUS-GL-2158.1-GA-1324")),
);
check(
  mapEndorsements(null).endorsements.length === 0,
  "No extraction means no endorsements, not an assumed empty schedule",
);

console.log(failed === 0 ? "\nAll mapper checks passed." : `\n${failed} FAILURE(S).`);
process.exit(failed === 0 ? 0 : 1);
