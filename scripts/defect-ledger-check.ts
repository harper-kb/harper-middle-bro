/**
 * Origination Defect Ledger harness: classification, adjudication, the
 * coaching-feed mirror, producer defect rates, renewal transfers, SLA pauses,
 * and the per-rep disclosure scan.
 * Run: npx tsx scripts/defect-ledger-check.ts
 */
import Database from "better-sqlite3";
import {
  classifyIssue,
  canTransition,
  DEFECT_ATTRIBUTION_WINDOW_DAYS,
  DEFECT_RATE_ACCELERATOR_THRESHOLD,
  defectsAbsorbedByPod,
  isActionable,
  MIN_DEALS_FOR_GATE,
  summarizeProducerDefects,
  toCoachingFinding,
} from "../src/lib/retention/defects";
import {
  attachDefectEvidence,
  createRenewalTransfer,
  DefectTransitionError,
  listDefects,
  listDefectStateLog,
  listRenewalTransfers,
  migrateDefectTables,
  raiseDefect,
  setRenewalTransferState,
  transitionDefect,
} from "../src/lib/retention/defect-store";
import {
  isEffectiveAt,
  renewalDueDate,
  renewalTransferEligibility,
  summarizeProducerExposure,
} from "../src/lib/retention/renewal-transfer";
import {
  adjustSlaForDefect,
  computePodSlaAttainment,
  laneDueAt,
} from "../src/lib/retention/sla";
import {
  calibrateTaxonomy,
  scanDisclosure,
  topicsRaisedIn,
} from "../src/lib/retention/disclosure";
import {
  buildSampleTranscripts,
  SAMPLE_BOUND_DEALS_BY_PRODUCER,
  SAMPLE_DEFECTS,
  SAMPLE_SLA_ISSUES,
} from "../src/lib/retention/sample";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

// ——— Classification ———

const subjectivity = classifyIssue({
  issueId: "iss-1",
  text: "Insured says they were never told about the inspection requirement — subjectivity outstanding two weeks after bind.",
  issueOpenedAt: "2026-07-10T00:00:00.000Z",
  boundAt: "2026-06-25T00:00:00.000Z",
});
check(
  "an undisclosed subjectivity is proposed with its cues",
  subjectivity.proposal?.kind === "undisclosed_subjectivity" &&
    subjectivity.proposal.cues.length >= 2,
  subjectivity,
);
check(
  "two independent cues raise confidence above a single cue",
  (subjectivity.proposal?.confidence ?? 0) > 0.5,
  subjectivity.proposal,
);

const financed = classifyIssue({
  issueId: "iss-2",
  text: "Customer thought the card on file would auto-charge the carrier and didn't know the policy was financed.",
  issueOpenedAt: "2026-07-10T00:00:00.000Z",
  boundAt: "2026-06-25T00:00:00.000Z",
});
check(
  "payment structure never explained is caught",
  financed.proposal?.kind === "payment_structure_undisclosed",
  financed,
);

const freeEndorsement = classifyIssue({
  issueId: "iss-3",
  text: "They were told the additional insured would be free and it wasn't; we're eating the cost.",
  issueOpenedAt: "2026-07-10T00:00:00.000Z",
  boundAt: "2026-07-01T00:00:00.000Z",
});
check(
  "a promised free endorsement is caught",
  freeEndorsement.proposal?.kind === "promised_free_endorsement",
  freeEndorsement,
);

const ordinary = classifyIssue({
  issueId: "iss-4",
  text: "Insured added a vehicle to the fleet and needs an endorsement.",
  issueOpenedAt: "2026-07-10T00:00:00.000Z",
  boundAt: "2026-07-01T00:00:00.000Z",
});
check(
  "ordinary lifecycle work is not a defect",
  ordinary.proposal === null,
  ordinary,
);

const stale = classifyIssue({
  issueId: "iss-5",
  text: "Wrong limit on the policy versus what was quoted.",
  issueOpenedAt: "2026-07-10T00:00:00.000Z",
  boundAt: "2026-01-01T00:00:00.000Z",
});
check(
  `an issue opened past the ${DEFECT_ATTRIBUTION_WINDOW_DAYS}-day window is service, not origination`,
  stale.proposal === null && stale.reason.includes("outside"),
  stale,
);

const multi = classifyIssue({
  issueId: "iss-6",
  text: "Subjectivity never disclosed, and the named insured is the wrong entity.",
  issueOpenedAt: "2026-07-10T00:00:00.000Z",
  boundAt: "2026-07-01T00:00:00.000Z",
});
check(
  "competing classifications are offered as alternatives, not silently dropped",
  multi.proposal != null && multi.alternatives.length >= 1,
  multi,
);

// ——— Adjudication ———

check(
  "a proposal must be raised by a person before it can be confirmed",
  !canTransition("proposed", "confirmed") && canTransition("proposed", "raised"),
);
check(
  "sales can dispute a raised defect, and a dispute can go either way",
  canTransition("raised", "disputed") &&
    canTransition("disputed", "confirmed") &&
    canTransition("disputed", "rejected"),
);
check(
  "a confirmed defect is terminal",
  !canTransition("confirmed", "rejected") && isActionable("confirmed"),
);

const db = new Database(":memory:");
migrateDefectTables(db);

const raised = raiseDefect(db, {
  issueId: "iss-3150",
  accountId: "acct-tallgrass",
  policyId: "pol-t1",
  kind: "payment_structure_undisclosed",
  severity: "material",
  producerAgentId: "sales-reed",
  producerName: "Reed Vance",
  absorbingPodId: "cancellations_payments",
  absorbingAgentId: "svc-kai",
  boundAt: "2026-06-05T00:00:00.000Z",
  issueOpenedAt: "2026-07-14T08:00:00.000Z",
  raisedBy: "svc-kai",
  state: "raised",
  detail: "Insured believed the card on file paid the carrier.",
  at: "2026-07-16T09:00:00.000Z",
});
check("a raised defect persists", raised.state === "raised", raised);

raiseDefect(db, {
  issueId: "iss-3150",
  accountId: "acct-tallgrass",
  kind: "undisclosed_subjectivity",
  severity: "severe",
  issueOpenedAt: "2026-07-14T08:00:00.000Z",
});
check(
  "an issue cannot carry two competing defects",
  listDefects(db, { accountId: "acct-tallgrass" }).length === 1,
  listDefects(db),
);

let refused = false;
try {
  transitionDefect(db, raised.id, "confirmed", { actor: "mgr-sales" });
} catch (err) {
  refused = err instanceof DefectTransitionError;
}
check("a defect cannot be confirmed with no evidence attached", refused);

attachDefectEvidence(db, raised.id, ["transcript-5521", "quote-8890"]);
attachDefectEvidence(db, raised.id, ["transcript-5521"]);
check(
  "evidence is de-duplicated",
  listDefects(db)[0]!.evidenceRefs.length === 2,
  listDefects(db)[0]!.evidenceRefs,
);

const confirmed = transitionDefect(db, raised.id, "confirmed", {
  actor: "mgr-sales",
  note: "Transcript confirms financing was never mentioned",
  at: "2026-07-20T12:00:00.000Z",
});
check(
  "confirmation records who decided and when",
  confirmed.state === "confirmed" &&
    confirmed.adjudicatedBy === "mgr-sales" &&
    confirmed.adjudicatedAt === "2026-07-20T12:00:00.000Z",
  confirmed,
);
check(
  "every state move is logged",
  listDefectStateLog(db, raised.id).length === 1 &&
    listDefectStateLog(db, raised.id)[0]!.to === "confirmed",
  listDefectStateLog(db, raised.id),
);

let terminal = false;
try {
  transitionDefect(db, raised.id, "disputed");
} catch (err) {
  terminal = err instanceof DefectTransitionError;
}
check("a confirmed defect cannot be reopened by transition", terminal);

// ——— Coaching feed mirror ———

const finding = toCoachingFinding(confirmed);
check(
  "the coaching mirror uses the feed's own roster keys",
  finding.rep_slug === "reed-vance" &&
    finding.rep_canonical_name === "Reed Vance" &&
    finding.origin === "origination_defect_ledger",
  finding,
);
check(
  "a confirmed defect reads as verified and confirmed in the feed",
  finding.status === "verified" && finding.is_confirmed,
  finding,
);
check(
  "an unconfirmed defect never reads as verified",
  toCoachingFinding(SAMPLE_DEFECTS.find((d) => d.state === "disputed")!).status === "new",
);

// ——— Producer accountability ———

const rates = summarizeProducerDefects(SAMPLE_DEFECTS, SAMPLE_BOUND_DEALS_BY_PRODUCER);
const reed = rates.find((r) => r.producerAgentId === "sales-reed")!;
check(
  "only confirmed defects count against a producer",
  reed.confirmedDefects === 2 && reed.boundDeals === 14,
  reed,
);
check(
  "a producer over the threshold has their accelerator capped",
  reed.defectRate > DEFECT_RATE_ACCELERATOR_THRESHOLD && reed.acceleratorCapped,
  reed,
);
check(
  "a disputed defect does not cap anyone",
  rates.find((r) => r.producerAgentId === "sales-june")!.acceleratorCapped === false,
);
check(
  `a producer under ${MIN_DEALS_FOR_GATE} bound deals is not gated on a thin denominator`,
  rates.find((r) => r.producerAgentId === "sales-omar")!.acceleratorCapped === false,
  rates.find((r) => r.producerAgentId === "sales-omar"),
);

const absorbed = defectsAbsorbedByPod(SAMPLE_DEFECTS);
check(
  "absorbed defects are credited to the pod that ate the rework",
  absorbed.some((a) => a.podId === "cancellations_payments" && a.count === 1) &&
    absorbed.some((a) => a.podId === "subjectivities_docusign" && a.severeCount === 1),
  absorbed,
);

// ——— Renewal transfer ———

const severeConfirmed = SAMPLE_DEFECTS.find((d) => d.id === "def-2")!;
check(
  "a confirmed material defect is transferable",
  renewalTransferEligibility(severeConfirmed).eligible,
);
check(
  "an unconfirmed defect is a claim, not a sanction",
  !renewalTransferEligibility(SAMPLE_DEFECTS.find((d) => d.id === "def-4")!).eligible,
);
check(
  "a minor defect is a coaching finding, not a renewal transfer",
  !renewalTransferEligibility({ ...severeConfirmed, severity: "minor" }).eligible,
);
check(
  "renewal falls due twelve months after bind",
  renewalDueDate(severeConfirmed).startsWith("2027-06-20"),
  renewalDueDate(severeConfirmed),
);

const transfer = createRenewalTransfer(db, confirmed.id, {
  renewalCommissionCents: 346_500,
  at: "2026-07-20T13:00:00.000Z",
});
check(
  "the transfer moves renewal credit from producer to the absorbing pod",
  transfer.fromProducerAgentId === "sales-reed" &&
    transfer.toPodId === "cancellations_payments" &&
    transfer.state === "pending",
  transfer,
);
check(
  "a transfer is pending until the renewal date, so the dispute path has time to run",
  !isEffectiveAt(transfer, "2026-12-01T00:00:00.000Z") &&
    isEffectiveAt(transfer, "2027-07-01T00:00:00.000Z"),
);
createRenewalTransfer(db, confirmed.id, { at: "2026-07-21T13:00:00.000Z" });
check(
  "one defect produces at most one transfer",
  listRenewalTransfers(db, { defectId: confirmed.id }).length === 1,
);

const exposure = summarizeProducerExposure(
  listRenewalTransfers(db),
  "2026-08-01T00:00:00.000Z",
);
check(
  "producer exposure is visible before the renewal, not at it",
  exposure[0]!.producerAgentId === "sales-reed" &&
    exposure[0]!.pending === 1 &&
    exposure[0]!.commissionAtStakeCents === 346_500,
  exposure,
);

setRenewalTransferState(db, transfer.id, "reversed", "Appeal upheld");
check(
  "a reversed transfer never becomes effective",
  !isEffectiveAt(
    { ...transfer, state: "reversed" },
    "2027-07-01T00:00:00.000Z",
  ) && listRenewalTransfers(db)[0]!.state === "reversed",
);

// ——— SLA pause ———

const breachedIssue = SAMPLE_SLA_ISSUES.find((i) => i.issueId === "iss-3150")!;
const noDefect = adjustSlaForDefect(breachedIssue, null);
check(
  "an issue with no defect is measured against its lane clock",
  noDefect.kind === "none" && noDefect.effectiveDueAt === laneDueAt(breachedIssue),
  noDefect,
);

const reset = adjustSlaForDefect(breachedIssue, SAMPLE_DEFECTS[0]!);
check(
  "a confirmed defect restarts the clock at adjudication",
  reset.kind === "reset" && reset.effectiveDueAt > laneDueAt(breachedIssue),
  reset,
);
check(
  "the excluded time is reported rather than hidden",
  reset.excludedHours > 0,
  reset,
);

const pending = adjustSlaForDefect(
  breachedIssue,
  { ...SAMPLE_DEFECTS[0]!, state: "raised", adjudicatedAt: null },
  new Date("2026-07-18T09:00:00.000Z"),
);
check(
  "a pending defect pauses the clock provisionally",
  pending.kind === "paused" && pending.excludedHours > 0,
  pending,
);

const rejected = adjustSlaForDefect(breachedIssue, {
  ...SAMPLE_DEFECTS[0]!,
  state: "rejected",
});
check(
  "a rejected defect returns the excluded time — a bogus claim buys nothing",
  rejected.kind === "none" &&
    rejected.excludedHours === 0 &&
    rejected.effectiveDueAt === laneDueAt(breachedIssue),
  rejected,
);

const attainment = computePodSlaAttainment(
  SAMPLE_SLA_ISSUES,
  SAMPLE_DEFECTS,
  new Date("2026-08-01T00:00:00.000Z"),
);
const cancels = attainment.find((a) => a.podId === "cancellations_payments")!;
const subjectivities = attainment.find((a) => a.podId === "subjectivities_docusign")!;
check(
  "pod attainment is grouped by lane pod",
  cancels.total === 3 && subjectivities.total === 1,
  attainment,
);
check(
  "a breach caused by an origination defect does not count against the pod",
  subjectivities.breachesAvoidedByPause === 1 && subjectivities.breached === 0,
  subjectivities,
);
check(
  "a pod still late against the restarted clock is still late",
  cancels.breached > 0,
  cancels,
);
check(
  "a pod with no issues reads as unmeasured, not perfect",
  computePodSlaAttainment([], [], new Date()).length === 0 &&
    attainment.every((a) => a.total === 0 || a.attainment != null),
);
check(
  "absorbed defects show on the pod that absorbed them",
  cancels.defectsAbsorbed === 1,
  cancels,
);

// ——— Disclosure scan ———

check(
  "a call that raises subjectivities is detected",
  topicsRaisedIn(
    "Before the carrier can bind we'll need loss runs — that's a subjectivity.",
  ).includes("subjectivity"),
);
check(
  "a call that raises nothing is detected as raising nothing",
  topicsRaisedIn("Thanks for the time today, I'll send the quote over.").length === 0,
);

const distribution = scanDisclosure(buildSampleTranscripts(), { source: "sample" });
check(
  "the distribution separates reps by disclosure behavior",
  distribution.reps[0]!.repCanonicalName === "Reed Vance" &&
    (distribution.reps[0]!.zeroDisclosureRate ?? 0) > 0.5,
  distribution.reps.map((r) => [r.repCanonicalName, r.zeroDisclosureRate]),
);
check(
  "a rep's subjectivity rate reads at or near zero when they never raise it",
  distribution.reps.find((r) => r.repCanonicalName === "Reed Vance")!.topics.find(
    (t) => t.topic === "subjectivity",
  )!.rate === 0,
);
check(
  "sample output is labeled sample",
  distribution.source === "sample" && distribution.sourceNote.length > 0,
);

const thin = scanDisclosure([
  {
    id: "t1",
    repCanonicalName: "New Hire",
    repAgentId: "sales-new",
    occurredAt: "2026-07-01T00:00:00.000Z",
    text: "No topics here.",
  },
]);
check(
  "a rate is not published on a denominator too small to mean anything",
  thin.reps[0]!.zeroDisclosureRate === null &&
    thin.reps[0]!.topics.every((t) => t.rate === null),
  thin.reps[0],
);

const calibration = calibrateTaxonomy(distribution, { undisclosed_subjectivity: 1 });
check(
  "calibration flags a ledger catching far less than the transcripts predict",
  calibration.find((c) => c.kind === "undisclosed_subjectivity")!.captureRate! < 0.25,
  calibration,
);

db.close();

console.log("---");
if (failures > 0) {
  console.error(`${failures} defect-ledger check(s) FAILED.`);
  process.exit(1);
}
console.log("All defect-ledger checks passed.");
