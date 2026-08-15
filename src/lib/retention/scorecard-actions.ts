"use server";

import { revalidatePath } from "next/cache";
import {
  attachScorecardPeriodPay,
  publishScorecardPeriod,
  raiseScorecardDispute,
  saveScorecardPeriod,
  settleScorecardDispute,
} from "@/lib/db";
import { getSessionOperator } from "@/lib/session";
import { loadScorecard } from "./scorecard.server";
import type { DisputeSubject, ScorecardDispute } from "./period";

/**
 * The shadow-period ritual, as buttons.
 *
 * Publishing, disputing, and settling exist as scripts too, but a ritual only
 * runs if the people it is for can run it. A dispute that requires someone to
 * open a terminal is a dispute that gets raised in a hallway instead, where it
 * cannot be counted or answered.
 *
 * Publishing and attaching pay are manager-only. Raising a dispute is not —
 * the person whose number is wrong is usually not the manager.
 */

async function requireOperator() {
  const operator = await getSessionOperator();
  if (!operator) throw new Error("Sign in to work the desk.");
  return operator;
}

async function requireManager() {
  const operator = await requireOperator();
  if (operator.role !== "manager") throw new Error("Manager access only.");
  return operator;
}

function revalidateScorecard() {
  revalidatePath("/manager/scorecard");
  revalidatePath("/me");
}

export async function publishPeriodAction() {
  await requireManager();
  const view = await loadScorecard();
  saveScorecardPeriod(view.period);
  publishScorecardPeriod(view.period, { pods: view.pods, people: view.people });
  revalidateScorecard();
}

const DISPUTE_SUBJECTS: DisputeSubject[] = [
  "pod",
  "person",
  "window",
  "defect",
  "metric",
];

/** `pod:cancellations_payments` → what the dispute is against. */
function parseTarget(raw: string): { subject: DisputeSubject; subjectId: string } {
  const [head, ...rest] = raw.split(":");
  const subject = DISPUTE_SUBJECTS.includes(head as DisputeSubject)
    ? (head as DisputeSubject)
    : "metric";
  const subjectId = rest.join(":").trim();
  return { subject, subjectId: subjectId || "board" };
}

export async function raiseDisputeAction(formData: FormData) {
  const operator = await requireOperator();
  const claim = String(formData.get("claim") ?? "").trim();
  if (!claim) throw new Error("Say what is wrong — a dispute with no claim cannot be answered.");
  const { subject, subjectId } = parseTarget(String(formData.get("target") ?? ""));
  raiseScorecardDispute({
    periodId: String(formData.get("periodId") ?? ""),
    subject,
    subjectId,
    raisedBy: operator.id,
    claim,
  });
  revalidateScorecard();
}

export async function settleDisputeAction(formData: FormData) {
  const manager = await requireManager();
  const note = String(formData.get("resolutionNote") ?? "").trim();
  if (!note) {
    throw new Error(
      "A dispute cannot be settled without a reason — that is what teaches people to stop raising them.",
    );
  }
  settleScorecardDispute({
    disputeId: String(formData.get("disputeId") ?? ""),
    state: String(formData.get("state") ?? "rejected") as Exclude<
      ScorecardDispute["state"],
      "open"
    >,
    resolvedBy: manager.id,
    resolutionNote: note,
    correctionApplied: formData.get("correctionApplied") === "1",
  });
  revalidateScorecard();
}

export async function attachPayAction(formData: FormData) {
  const manager = await requireManager();
  attachScorecardPeriodPay(String(formData.get("periodId") ?? ""), manager.id);
  revalidateScorecard();
}
