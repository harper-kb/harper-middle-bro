import type { Message, ThreadDetail } from "../types";

/**
 * What the client actually asked for, recovered from the outbound request.
 *
 * The first agent message is a rendered template, so the useful part is the
 * detail block in the middle. Everything here is a best guess the operator
 * can overwrite — it seeds fields, it doesn't decide anything.
 */

export interface RequestSummary {
  holderName: string;
  holderAddress: string;
  wording: string;
  /** The detail block verbatim, minus template scaffolding */
  raw: string;
}

const SCAFFOLD = [
  /^hi\b/i,
  /^dear\b/i,
  /^please process\b/i,
  /^policy:/i,
  /^carrier:/i,
  /^coverages:/i,
  /^insured:/i,
  /^request details:/i,
  /^please confirm/i,
  /^please reply/i,
  /^kindly advise/i,
  /^we respectfully request/i,
  /^channel:/i,
  /^request:/i,
  /^details:/i,
  /^operator:/i,
  /^portal:/i,
  /^phone:/i,
  /^logged /i,
  /^—\s*verification\s*—/i,
  /^\[(block|warn|info)\]/i,
  /^matched uw:/i,
  /^please add the following/i,
  /^•/,
];

const ENTITY_HINT =
  /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|plc|partners|properties|authority|group|holdings|hoa|association|trust|university|district|city of|county of)\b/i;

const ADDRESS_HINT = /\d{1,6}\s+\S+|\b[A-Z]{2}\s+\d{5}\b|\bsuite\b|\bste\b|\bp\.?o\.? box\b/i;

function isScaffold(line: string): boolean {
  return SCAFFOLD.some((re) => re.test(line.trim()));
}

/** Strip greeting, field lines, and the signature block from a rendered draft. */
export function extractDetailBlock(body: string): string {
  const lines = body.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push("");
      continue;
    }
    if (isScaffold(t)) continue;
    // Signature block starts at the sign-off — everything after is ours, not theirs.
    if (/^(thanks|thank you|best|regards|sincerely)[,.! ]*$/i.test(t)) break;
    kept.push(t);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function summarizeRequest(
  thread: Pick<ThreadDetail, "messages">,
): RequestSummary {
  const first: Message | undefined = thread.messages.find((m) => m.role === "agent");
  const raw = first ? extractDetailBlock(first.body) : "";
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  const holderIdx = lines.findIndex((l) => ENTITY_HINT.test(l) && l.length < 90);
  const holderName = holderIdx >= 0 ? lines[holderIdx] : "";

  const addressLine = lines.find(
    (l, i) => i !== holderIdx && ADDRESS_HINT.test(l) && l.length < 120,
  );

  const wording = lines
    .filter((l, i) => i !== holderIdx && l !== addressLine)
    .join(" ")
    .trim();

  return {
    holderName,
    holderAddress: addressLine ?? "",
    wording: wording || raw,
    raw,
  };
}
