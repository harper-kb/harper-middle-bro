/**
 * Legacy/spine vocabulary harness: canonical coverage against the captured
 * live vocabulary, count preservation, and twin suppression.
 * Run: npx tsx scripts/vocabulary-normalize-check.ts
 */
import {
  CANONICAL_TO_LANE,
  deduplicatedTotals,
  normalizeIssueCounts,
  normalizeIssueType,
  suppressTwins,
  TWIN_WINDOW_HOURS,
  unmappedIssueTypes,
  type IssueRef,
} from "../src/lib/retention/normalize";
import { OBSERVED_ISSUE_VOCABULARY } from "../src/lib/retention/vocabulary-snapshot";
import { podForLane } from "../src/lib/retention/pods";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

// ——— Coverage against the live vocabulary ———

const rawTypes = OBSERVED_ISSUE_VOCABULARY.map((r) => r.issueType);
const unmapped = unmappedIssueTypes(rawTypes);
check(
  "every observed issue type has a canonical name",
  unmapped.length === 0,
  unmapped,
);

const normalized = normalizeIssueCounts(OBSERVED_ISSUE_VOCABULARY);
const rawTotal = OBSERVED_ISSUE_VOCABULARY.reduce((n, r) => n + r.openCount, 0);
const normalizedTotal = normalized.reduce((n, r) => n + r.total, 0);
check(
  "normalization preserves the open count exactly",
  rawTotal === normalizedTotal,
  { rawTotal, normalizedTotal },
);
check(
  "the two stores stay separable after normalization",
  normalized.reduce((n, r) => n + r.spineOpen, 0) === 2690 &&
    normalized.reduce((n, r) => n + r.legacyOpen, 0) === 2524,
  {
    spine: normalized.reduce((n, r) => n + r.spineOpen, 0),
    legacy: normalized.reduce((n, r) => n + r.legacyOpen, 0),
  },
);

// ——— The twins themselves ———

check(
  "the two casings of policy delivery collapse into one row",
  normalizeIssueType("policy_delivery") === "policy_delivery" &&
    normalizeIssueType("POLICY_DELIVERY") === "policy_delivery",
);
const delivery = normalized.find((r) => r.canonical === "policy_delivery")!;
check(
  "policy delivery reports both stores under one canonical row",
  delivery.spineOpen === 290 && delivery.legacyOpen === 223 && delivery.total === 513,
  delivery,
);
check(
  "the canonical row names the raw values that folded into it",
  delivery.rawTypes.includes("policy_delivery") &&
    delivery.rawTypes.includes("POLICY_DELIVERY") &&
    delivery.rawTypes.includes("POLICY_DOCS_PENDING"),
  delivery.rawTypes,
);

const docusignSpellings = [
  "DOCUSIGN",
  "DocuSign",
  "docusign_chase",
  "DOCUSIGN_BUILD",
  "DOCUSIGN_SEND",
  "DOCUSIGN_SIGNED",
  "DOCUSIGN_VOIDED",
  "DOCUSIGN_COMPLETED_REVIEW",
];
check(
  "every DocuSign spelling lands on one canonical type",
  docusignSpellings.every((s) => normalizeIssueType(s) === "docusign"),
  docusignSpellings.map((s) => [s, normalizeIssueType(s)]),
);

check(
  "the cancellation lane is not split across its legacy and spine names",
  normalizeIssueType("CANCELLATION_ALERT") === "cancellation" &&
    normalizeIssueType("cancellation") === "cancellation" &&
    normalizeIssueType("CANCEL_NON_PAY") === "cancellation",
);
check(
  "subjectivity's four legacy variants collapse",
  ["MISC_SUBJECTIVITY", "COLLECT_SUBJECTIVITIES", "SUBJECTIVITY_MONITORING", "SUBJECTIVITY_SENSITIVE"].every(
    (s) => normalizeIssueType(s) === "subjectivity",
  ),
);
check(
  "COI's five send variants collapse",
  ["COI_REQUEST", "COI_SEND", "BROKER_COI_SEND", "IQ_COI_SEND", "CERTIFICATE_OF_INSURANCE"].every(
    (s) => normalizeIssueType(s) === "coi_request",
  ),
);

check(
  "legacy-only concepts get their own name rather than being dumped in general request",
  normalizeIssueType("PUSH_TO_UW") === "underwriting" &&
    normalizeIssueType("IQ_BIND_AND_ISSUE") === "binding" &&
    normalizeIssueType("ADDRESS_CHANGE") === "account_change",
);
check(
  "general request stays what it is and does not absorb the tail",
  normalized.find((r) => r.canonical === "general_request")!.total === 1031,
  normalized.find((r) => r.canonical === "general_request"),
);

check(
  "an unrecognized value is reported rather than silently bucketed",
  normalizeIssueType("WIDGET_ESCALATION_V2") === "unknown" &&
    unmappedIssueTypes(["WIDGET_ESCALATION_V2"]).length === 1,
);

// ——— Every canonical type reaches a pod ———

check(
  "every canonical type routes to a lane",
  Object.values(CANONICAL_TO_LANE).every((lane) => lane != null),
);
check(
  "normalized rows land in pods, except the front-door lane which has no pool",
  normalized.every(
    (r) => podForLane(r.lane) != null || r.lane === "communications",
  ),
  normalized.filter((r) => podForLane(r.lane) == null).map((r) => r.canonical),
);

// ——— Twin suppression ———

const issues: IssueRef[] = [
  {
    id: "spine-1",
    sourceStore: "spine",
    companyId: "acct-1",
    issueType: "cancellation",
    openedAt: "2026-07-02T12:00:00.000Z",
  },
  {
    id: "legacy-1",
    sourceStore: "legacy",
    companyId: "acct-1",
    issueType: "CANCELLATION_ALERT",
    openedAt: "2026-07-03T09:00:00.000Z",
  },
  {
    id: "legacy-2",
    sourceStore: "legacy",
    companyId: "acct-1",
    issueType: "CANCELLATION_ALERT",
    openedAt: "2026-04-01T09:00:00.000Z",
  },
  {
    id: "legacy-3",
    sourceStore: "legacy",
    companyId: "acct-2",
    issueType: "CANCELLATION_ALERT",
    openedAt: "2026-07-03T09:00:00.000Z",
  },
  {
    id: "spine-2",
    sourceStore: "spine",
    companyId: "acct-1",
    issueType: "coi_request",
    openedAt: "2026-07-03T09:00:00.000Z",
  },
];

const { kept, suppressed } = suppressTwins(issues);
check(
  "a legacy row twinned to a spine row is suppressed, not counted again",
  suppressed.length === 1 &&
    suppressed[0]!.issue.id === "legacy-1" &&
    suppressed[0]!.twinOf === "spine-1",
  suppressed,
);
check(
  "the spine row is the one kept, because it carries priority and SLA",
  kept.some((i) => i.id === "spine-1") && !kept.some((i) => i.id === "legacy-1"),
);
check(
  `a legacy row outside the ${TWIN_WINDOW_HOURS}-hour window is a separate event`,
  kept.some((i) => i.id === "legacy-2"),
);
check(
  "a legacy row on another account is never a twin",
  kept.some((i) => i.id === "legacy-3"),
);
check(
  "a legacy row of a different canonical type is never a twin",
  kept.some((i) => i.id === "spine-2"),
);

const oneSpineTwoLegacy: IssueRef[] = [
  issues[0]!,
  issues[1]!,
  {
    id: "legacy-4",
    sourceStore: "legacy",
    companyId: "acct-1",
    issueType: "CANCELLATION",
    openedAt: "2026-07-03T10:00:00.000Z",
  },
];
check(
  "one spine row absorbs at most one legacy twin",
  suppressTwins(oneSpineTwoLegacy).suppressed.length === 1 &&
    suppressTwins(oneSpineTwoLegacy).kept.length === 2,
  suppressTwins(oneSpineTwoLegacy),
);

const totals = deduplicatedTotals(issues);
check(
  "the published open count is lower than naive addition",
  totals.deduplicatedOpen === 4 &&
    totals.spineOpen + totals.legacyOpen === 5 &&
    totals.twinsSuppressed === 1,
  totals,
);

console.log("---");
if (failures > 0) {
  console.error(`${failures} vocabulary-normalize check(s) FAILED.`);
  process.exit(1);
}
console.log("All vocabulary-normalize checks passed.");
