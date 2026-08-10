"use server";

import type { KnowledgeKind } from "./carrier-knowledge";
import { addOperatorCarrierKnowledge } from "./db";
import { getSessionOperator } from "./session";

const KINDS: KnowledgeKind[] = [
  "restriction",
  "state_law",
  "past_issue",
  "practice_note",
];

const SOURCES = ["Desk Experience", "Carrier Documentation", "State Regulation"];

/**
 * File a carrier knowledge entry the desk just learned. Operator entries
 * render as cards immediately and can warn — they never hard-block. Turning
 * a learned fact into enforcement means moving it into the committed
 * registry (`carrier-knowledge.ts`) through code review; that is by design,
 * and the form says so.
 */
export async function addCarrierKnowledgeAction(formData: FormData) {
  const operator = await getSessionOperator();
  if (!operator) {
    throw new Error("Sign in before adding a knowledge entry.");
  }

  const carrier = String(formData.get("carrier") ?? "").trim();
  const kind = String(formData.get("kind") ?? "") as KnowledgeKind;
  const severity = String(formData.get("severity") ?? "note");
  const title = String(formData.get("title") ?? "").trim();
  const detail = String(formData.get("detail") ?? "").trim();
  const consequence = String(formData.get("consequence") ?? "").trim() || null;
  const source = String(formData.get("source") ?? "").trim();
  const writingCompany =
    String(formData.get("writingCompany") ?? "").trim() || null;
  const coverageLine = String(formData.get("coverageLine") ?? "").trim() || null;
  const industryVertical =
    String(formData.get("industryVertical") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;

  if (!carrier || !title || !detail) {
    throw new Error("Carrier, title, and detail are required.");
  }
  if (!KINDS.includes(kind)) {
    throw new Error("Pick a valid entry kind.");
  }
  if (severity !== "warning" && severity !== "note") {
    throw new Error(
      "Operator entries are notes or warnings — a blocker ships through code review.",
    );
  }
  if (!SOURCES.includes(source)) {
    throw new Error("Pick a source for the fact.");
  }
  if (state && !/^[A-Za-z]{2}$/.test(state)) {
    throw new Error("State is a two-letter code (e.g. CO).");
  }

  addOperatorCarrierKnowledge({
    carrier,
    writingCompany,
    coverageLine,
    industryVertical,
    state,
    kind,
    severity,
    title,
    detail,
    consequence,
    source,
    createdBy: operator.id,
  });
}
