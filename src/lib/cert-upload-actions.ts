"use server";

import { resolveCertSheet } from "./acord25";
import { buildCertificatePacket } from "./certificate";
import { displayLimit } from "./cert-review";
import {
  parseCertificateText,
  verifyAgainstRecord,
  type ExtractedCert,
  type VerifyReport,
} from "./cert-verify";
import { fileAccountDocument, getAccountDetail } from "./db";
import { getPolicyFormSet, type PolicyFormSet } from "./forms";
import { extractPdfText } from "./pdf-text.server";
import { getSessionOperator } from "./session";

/**
 * Read a certificate someone else issued, then answer one question: what
 * would OUR certificate say for the same policies?
 *
 * The upload is evidence of what is being ASKED for — which policies, which
 * holder, which endorsements — and is never a source of coverage facts. That
 * is not a style preference: `source-document-trust` in the presend registry
 * refuses to issue off a prior certificate, precisely so wrong language on
 * one cert cannot propagate to the next. So the recreated sheet below is
 * resolved from the schedule of record, and the upload only ever appears in
 * the "on the cert" column of the comparison.
 */

/** One limit box our own sheet would print for the matched policies. */
export interface RecreatedLine {
  section: string;
  label: string;
  /** What the schedule of record states: an amount, Included, or Excluded */
  onRecord: string;
}

export interface CertUploadResult {
  ok: boolean;
  /** Why the read failed, when it did — never a silent empty result */
  error?: string;
  fileName: string;
  /** How the text was obtained, so the operator knows what was trusted */
  source: "pdf-text-layer" | "plain-text";
  text: string;
  extracted: ExtractedCert;
  report: VerifyReport;
  /** Policies on file that the uploaded cert names, by policy number */
  matchedPolicyIds: string[];
  /** Policy numbers printed on the cert that match nothing on this account */
  unmatchedPolicyNumbers: string[];
  /** What our certificate states for the matched policies */
  recreated: RecreatedLine[];
  /** Ledger id of the filed upload */
  documentId: string | null;
}

const normalizePolicyNumber = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function failure(fileName: string, error: string): CertUploadResult {
  return {
    ok: false,
    error,
    fileName,
    source: "plain-text",
    text: "",
    extracted: {
      insuredName: null,
      carriers: [],
      policies: [],
      limits: [],
      holderName: null,
      additionalInsured: null,
      subrogationWaived: null,
      couldNotRead: [],
    },
    report: { rows: [], recommendation: "Deny", reasons: [error] },
    matchedPolicyIds: [],
    unmatchedPolicyNumbers: [],
    recreated: [],
    documentId: null,
  };
}

export async function verifyCertificateUploadAction(
  formData: FormData,
): Promise<CertUploadResult> {
  const operator = await getSessionOperator();
  if (!operator) throw new Error("Sign in to verify a certificate.");

  const accountId = String(formData.get("accountId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return failure("", "No file received.");
  }
  const account = getAccountDetail(accountId);
  if (!account) return failure(file.name, "Account not found.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const isPdf =
    file.type === "application/pdf" ||
    /\.pdf$/i.test(file.name) ||
    bytes.subarray(0, 4).toString("latin1") === "%PDF";

  let text: string;
  let source: CertUploadResult["source"];
  if (isPdf) {
    source = "pdf-text-layer";
    try {
      text = await extractPdfText(bytes);
    } catch (e) {
      return failure(
        file.name,
        `Could not read the PDF — ${e instanceof Error ? e.message : "unknown error"}.`,
      );
    }
    if (!text.replace(/\s/g, "")) {
      // A scan or a photo. Reading nothing is not the same as a cert that
      // claims nothing, and the difference decides whether a desk approves.
      return failure(
        file.name,
        "This PDF carries no text layer — it is a scan or a photograph. Nothing was read, so nothing can be verified. Paste the certificate text instead.",
      );
    }
  } else {
    source = "plain-text";
    text = bytes.toString("utf-8");
    if (!text.replace(/\s/g, "")) return failure(file.name, "The file is empty.");
  }

  const formSets: Record<string, PolicyFormSet> = Object.fromEntries(
    account.policies.map((p) => [p.id, getPolicyFormSet(p)]),
  );
  const extracted = parseCertificateText(text);
  const report = verifyAgainstRecord(extracted, {
    account,
    policies: account.policies,
    formSets,
  });

  // Which of our policies is this certificate about? Policy number is the
  // only identifier on a cert that ties back to the book without guessing.
  const onCert = extracted.policies.map((p) => p.policyNumber);
  const matched = account.policies.filter((p) =>
    onCert.some(
      (n) => normalizePolicyNumber(n) === normalizePolicyNumber(p.policyNumber),
    ),
  );
  const unmatchedPolicyNumbers = onCert.filter(
    (n) =>
      !account.policies.some(
        (p) => normalizePolicyNumber(p.policyNumber) === normalizePolicyNumber(n),
      ),
  );

  // The recreation: our sheet, for the policies the upload names, resolved
  // from the schedule of record. When the cert names nothing we recognize,
  // there is nothing to recreate — we do not fall back to the whole book.
  const recreated: RecreatedLine[] = [];
  if (matched.length > 0) {
    const packet = buildCertificatePacket({
      account,
      policies: matched,
      formSets,
      holderName: extracted.holderName ?? "",
      holderAddress: "",
    });
    const hasGarage = matched.some((p) =>
      (formSets[p.id]?.coverages ?? []).some((c) => /garage/i.test(c.label)),
    );
    const sheet = resolveCertSheet(
      hasGarage ? "acord30" : "acord25",
      packet.sections,
    );
    for (const rs of sheet.sections) {
      if (!rs.feeder) continue;
      for (const box of rs.def.limitBoxes) {
        const onRecord = displayLimit(rs.limits[box.key]);
        if (!onRecord) continue;
        recreated.push({ section: rs.def.name, label: box.label, onRecord });
      }
    }
    for (const row of sheet.others) {
      for (const line of row.lines) {
        const onRecord = displayLimit(line.value);
        if (!onRecord) continue;
        recreated.push({
          section: row.label || "Additional Coverage",
          label: line.label,
          onRecord,
        });
      }
    }
  }

  // The upload itself goes on the record. A certificate someone sent us is
  // an account document like any other — and an untrusted one: it is not a
  // source of coverage facts.
  let documentId: string | null = null;
  try {
    documentId = fileAccountDocument({
      accountId: account.id,
      accountName: account.name,
      originalName: file.name,
      bytes,
      trusted: false,
      kindHint: "coi",
    }).id;
  } catch {
    // Filing is bookkeeping — a failure here must not lose the verdict the
    // operator is waiting on.
  }

  return {
    ok: true,
    fileName: file.name,
    source,
    text,
    extracted,
    report,
    matchedPolicyIds: matched.map((p) => p.id),
    unmatchedPolicyNumbers,
    recreated,
    documentId,
  };
}
