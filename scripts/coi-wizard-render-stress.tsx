/**
 * Guided-confirm wizard render stress — run with:
 *   npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/coi-wizard-render-stress.tsx
 * (server-only is stubbed by the render-check tsconfig; see run-checks.sh)
 *
 * Server-renders the REAL CertificateStudio (initial client state: wizard
 * open, nothing confirmed, empty holder) and asserts the batch-confirm /
 * sign-merge surface:
 *
 *   W1. Clean multi-policy account (acct-meridian, 6 policies / 4 carriers):
 *       record step renders with Confirm All ENABLED, no reject chip, the
 *       header Sign & Issue button blocked on pending areas, and NO
 *       "Signature Needed" blocked reason anywhere.
 *   W2. Insurer-letter exhaustion (7 carriers, synthetic): the insurers area
 *       carries a reject → Confirm All DISABLED + "Carries A Reject" chip +
 *       the header button counts the reject. (Regression guard: the
 *       insurer-overflow finding used to carry no fieldId and slipped past
 *       the batch gate.)
 *   W3. Carrier-knowledge reject inside a coverage section (ISC excess +
 *       blanket AI): same refusal through the fieldId-mapped path.
 *   W4. Area order: Certificate Holder confirms BEFORE Description in the
 *       area list (desc wording depends on holder).
 *   W5. Pre-bind account (acct-beacon): Prepare Only — no Sign & Issue
 *       button, pre-bind blocked reason present.
 *   W6. Garage account (acct-northstar): ACORD 30 selected by default, form
 *       toggle present (form switching entry point intact).
 *   W7. CoverageLockPanel: collapses to a one-line <details> with no
 *       endorsement tickets; expands with unlock buttons when tickets exist.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { CertificateStudio } from "../src/components/CertificateStudio";
import { getAccountDetail } from "../src/lib/db";
import { getPolicyFormSet, type PolicyFormSet } from "../src/lib/forms";
import type { Account, Policy } from "../src/lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

function renderSeedStudio(accountId: string): string {
  const account = getAccountDetail(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);
  const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
    account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
  );
  return renderToStaticMarkup(
    <CertificateStudio
      account={account}
      policies={account.policies}
      formSets={formSets}
      guidance={{}}
    />,
  );
}

/**
 * The wizard's Confirm All button disabled state. Static markup renders the
 * boolean attribute as `disabled=""` — the `disabled:opacity-45` utility
 * class would false-match a bare substring check.
 */
function confirmAllDisabled(html: string): boolean | null {
  const at = html.indexOf("Confirm All (");
  if (at < 0) return null;
  const open = html.lastIndexOf("<button", at);
  if (open < 0) return null;
  return html.slice(open, at).includes('disabled=""');
}

/** Area chip labels in list order (the ○/●/✓ marker span precedes each). */
function areaChipLabels(html: string): string[] {
  const out: string[] = [];
  const re = /font-mono text-\[9px\]">[○●✓]<\/span>([^<]+)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1].trim());
  return out;
}

/* ————— W1 + W4 + W7a: clean multi-policy stress account ————— */
{
  const html = renderSeedStudio("acct-meridian");

  check(
    "W1 wizard opens on the batched record step",
    html.includes("Confirm From The File") &&
      html.includes("read them once and confirm them together"),
  );
  check(
    "W1 Confirm All renders ENABLED on a clean sheet",
    confirmAllDisabled(html) === false,
    String(confirmAllDisabled(html)),
  );
  check(
    "W1 no reject chip on a clean sheet",
    !html.includes("Carries A Reject"),
  );
  check(
    "W1 header button blocked on pending areas (not on a signature)",
    /Blocked — \d+ Areas To Confirm/.test(html),
  );
  check(
    "W1 'Signature Needed' blocked reason is gone everywhere",
    !html.includes("Signature Needed"),
  );
  check(
    "W1 step pill reads Sign &amp; Issue (merged)",
    html.includes("Sign &amp; Issue"),
  );
  check(
    "W1 sheet renders as Specimen until the ledger issues",
    html.includes("Print Specimen"),
  );

  const chips = areaChipLabels(html);
  const holderAt = chips.indexOf("Certificate Holder");
  const descAt = chips.indexOf("Description Of Operations");
  check(
    "W4 Certificate Holder confirms before Description Of Operations",
    holderAt >= 0 && descAt >= 0 && holderAt < descAt,
    `chip order: ${chips.join(" → ")}`,
  );
  check(
    "W4 record areas precede the per-certificate pair",
    holderAt === chips.length - 2 && descAt === chips.length - 1,
    `chip order: ${chips.join(" → ")}`,
  );

  check(
    "W7 lock panel collapses to one line with no endorsement tickets",
    html.includes("<details") &&
      html.includes("Coverage Data — Locked To The Record"),
  );
}

/* ————— W2: insurer-letter exhaustion refuses the batch confirm ————— */

const stressAccount: Account = {
  id: "acct-wizard-stress",
  name: "Sevenfold Logistics Holdings LLC",
  dba: null,
  industry: "Transportation",
  addressLine1: "77 Interchange Pkwy",
  city: "Memphis",
  state: "TN",
  zip: "38118",
  primaryUwId: "uw-stress",
  backupUwId: null,
  notes: null,
  status: "active",
  paymentReceivedAt: "2026-01-15T00:00:00.000Z",
};

const glSet: PolicyFormSet = {
  coverages: [
    { code: "GL", label: "Commercial General Liability", form: "CG 00 01", edition: "04 13" },
  ],
  limits: [
    { slot: "gl_each_occurrence", amountCents: 1_000_000_00 },
    { slot: "gl_general_aggregate", amountCents: 2_000_000_00 },
  ],
  endorsements: [],
};

function carrierPolicy(i: number, carrier: string): Policy {
  return {
    id: `pol-wiz-${i}`,
    accountId: stressAccount.id,
    policyNumber: `WIZ-${carrier.toUpperCase().slice(0, 3)}-000${i}`,
    carrier,
    coverages: ["GL"],
    effectiveDate: "2026-04-01",
    expirationDate: "2027-04-01",
    premiumCents: 150_000,
    quoteInsuredName: null,
    quoteCarrier: null,
    issuingCarrier: null,
  };
}

{
  const carriers = ["Kinsale", "Hiscox", "Markel", "Chubb", "Travelers", "CNA", "Zurich"];
  const policies = carriers.map((c, i) => carrierPolicy(i, c));
  const formSets = Object.fromEntries(policies.map((p) => [p.id, glSet]));
  const html = renderToStaticMarkup(
    <CertificateStudio
      account={stressAccount}
      policies={policies}
      formSets={formSets}
      guidance={{}}
    />,
  );
  check(
    "W2 seventh carrier raises the reject chip on the record step",
    html.includes("Carries A Reject"),
  );
  check(
    "W2 Confirm All renders DISABLED while the insurers area carries the reject",
    confirmAllDisabled(html) === true,
    String(confirmAllDisabled(html)),
  );
  check(
    "W2 blocked note points at the Checks panel",
    html.includes("resolve it in the") && html.includes("Checks panel"),
  );
  // The empty initial holder adds its own reject, so assert presence, not count.
  check(
    "W2 header button counts rejects among the blocked reasons",
    /Blocked — [^<]*Reject/.test(html),
  );
}

/* ————— W3: carrier-knowledge reject inside a coverage section ————— */
{
  const excess: Policy = {
    ...carrierPolicy(9, "ISC"),
    id: "pol-wiz-excess",
    policyNumber: "SUT-XS-778100",
    coverages: ["EXCESS_UMB"],
    issuingCarrier: "Sutton National Insurance Company",
  };
  const excessSet: PolicyFormSet = {
    coverages: [
      { code: "EXCESS_UMB", label: "Excess / Umbrella Liability", form: "CU 00 01", edition: "04 13" },
    ],
    limits: [
      { slot: "umb_each_occurrence", amountCents: 5_000_000_00 },
      { slot: "umb_aggregate", amountCents: 5_000_000_00 },
    ],
    endorsements: [
      {
        form: "CG 20 33",
        edition: "04 13",
        title: "Additional Insured — Blanket (excess follow form)",
        kind: "ai",
        scope: "blanket",
      },
    ],
  };
  const html = renderToStaticMarkup(
    <CertificateStudio
      account={stressAccount}
      policies={[excess]}
      formSets={{ [excess.id]: excessSet }}
      guidance={{}}
    />,
  );
  check(
    "W3 forbidden AI on ISC excess raises the reject chip (fieldId-mapped path)",
    html.includes("Carries A Reject"),
  );
  check(
    "W3 Confirm All renders DISABLED for the section-level reject",
    confirmAllDisabled(html) === true,
    String(confirmAllDisabled(html)),
  );
}

/* ————— W5: pre-bind account prepares, never signs ————— */
{
  const html = renderSeedStudio("acct-beacon");
  check(
    "W5 pre-bind banner renders (Prepare Only)",
    html.includes("Pre-Bind — Prepare Only"),
  );
  check(
    "W5 primary action is Prepare Certificate, not Sign &amp; Issue Certificate",
    html.includes("Prepare Certificate") &&
      !html.includes("Sign &amp; Issue Certificate"),
  );
  check(
    "W5 pre-bind blocked reason on the button title",
    html.includes("Pre-Bind — Payment Activates Issuance"),
  );
}

/* ————— W6: garage account defaults to ACORD 30, toggle present ————— */
{
  const html = renderSeedStudio("acct-northstar");
  check(
    "W6 garage account opens on ACORD 30",
    html.includes("ACORD 30 — Confirm &amp; Issue"),
  );
  check(
    "W6 the form toggle offers both forms",
    html.includes('aria-label="Certificate Form"') && html.includes("ACORD 25"),
  );
}

/* ————— W7b: endorsement tickets expand the lock panel ————— */
{
  const account = getAccountDetail("acct-meridian");
  if (!account) throw new Error("acct-meridian not found");
  const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
    account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
  );
  const html = renderToStaticMarkup(
    <CertificateStudio
      account={account}
      policies={account.policies}
      formSets={formSets}
      guidance={{}}
      endorsementTickets={[
        {
          id: "tkt-wiz-1",
          label: "Endorsement",
          status: "working",
          subject: "Raise GL each occurrence to $2M",
        },
      ]}
    />,
  );
  check(
    "W7 open endorsement expands the lock panel with an Unlock affordance",
    html.includes("Open Endorsements That Can Unlock Editing") &&
      html.includes(">Unlock<"),
  );
}

console.log(
  failures === 0 ? "\nAll wizard render checks passed." : `\n${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
