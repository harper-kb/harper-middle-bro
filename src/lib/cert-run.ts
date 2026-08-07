import {
  certDescription,
  resolveCertSheet,
  type CertFormKey,
  type PlacementMap,
} from "./acord25";
import { buildCertificatePacket } from "./certificate";
import { findEndorsement, type PolicyFormSet } from "./forms";
import type { Account, Policy } from "./types";

/**
 * Certificate run — one client ask, several holders, N certificates. Each
 * certificate is identical except the Certificate Holder block and the
 * holder-specific Description Of Operations wording (the blanket-AI line
 * names the holder), built through the exact same packet + resolver path
 * the studio renders. Pure and deterministic: same inputs, same run.
 *
 * The pre-bind gate applies to the whole run: a pre-bind account prepares
 * nothing here — payment activates issuance, same as the single-cert path.
 */

export interface RunHolder {
  name: string;
  address: string;
  /** Requester email off the ticket that asked, when one is on file */
  requesterEmail?: string | null;
}

export interface RunCertificate {
  holderName: string;
  holderAddress: string;
  /** The full Description Of Operations text, holder-specific wording included */
  description: string;
  policyNumbers: string[];
  carriers: string[];
  /** "CG 20 33 04 13" etc. when a blanket AI form backs this holder's wording */
  blanketBasis: string | null;
  /** The packet verifier's out-of-the-box verdict for this holder */
  okToIssue: boolean;
  rejectIds: string[];
  requesterEmail: string | null;
}

export interface CertificateRun {
  /** Pre-bind accounts prepare nothing — the run is blocked, not built */
  blocked: boolean;
  blockedReason: string | null;
  certificates: RunCertificate[];
}

export function buildCertificateRun(input: {
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
  holders: RunHolder[];
  formKey: CertFormKey;
  placements?: PlacementMap;
  projectWording?: string;
}): CertificateRun {
  if (input.account.status === "pre_bind") {
    return {
      blocked: true,
      blockedReason: "Pre-Bind — Payment Activates Issuance",
      certificates: [],
    };
  }

  const blanket = input.policies
    .map((p) => {
      const ai = findEndorsement(input.formSets[p.id] ?? { coverages: [], limits: [], endorsements: [] }, "ai");
      return ai ? `${ai.form} ${ai.edition}`.trim() : null;
    })
    .find((x): x is string => Boolean(x));

  const certificates = input.holders.map((holder) => {
    // Each holder gets its own packet — the description is rebuilt from the
    // schedule with only this holder's name, so wording can never carry a
    // neighbor's holder over.
    const packet = buildCertificatePacket({
      account: input.account,
      policies: input.policies,
      formSets: input.formSets,
      holderName: holder.name,
      holderAddress: holder.address,
      projectWording: input.projectWording,
    });
    const sheet = resolveCertSheet(input.formKey, packet.sections, input.placements);
    return {
      holderName: holder.name,
      holderAddress: holder.address,
      description: certDescription(packet, sheet),
      policyNumbers: input.policies.map((p) => p.policyNumber),
      carriers: [...new Set(input.policies.map((p) => p.carrier))],
      blanketBasis: blanket ?? null,
      okToIssue: packet.okToIssue,
      rejectIds: packet.rejects.map((r) => r.finding.id),
      requesterEmail: holder.requesterEmail ?? null,
    };
  });

  return { blocked: false, blockedReason: null, certificates };
}

/* ————————————————— Prepared outbound emails ————————————————— */

export interface PreparedEmail {
  /** Requester email when the ask carried one; null = not on file, never invented */
  to: string | null;
  subject: string;
  body: string;
  holderName: string;
}

/**
 * One outbound email per issued certificate. Prepared text only — the studio
 * has no live send path (transport is outside the cert domain), so these
 * render as a reviewable Ready To Send list, never a fabricated sent status.
 */
export function prepareRunEmails(
  run: CertificateRun,
  ctx: { accountName: string; formNumber: string },
): PreparedEmail[] {
  return run.certificates.map((cert) => {
    const lines: string[] = [];
    lines.push("Hello,");
    lines.push("");
    lines.push(
      `Please find attached the Certificate of Insurance (${ctx.formNumber}) issued for ${ctx.accountName}, naming ${cert.holderName} as the certificate holder.`,
    );
    lines.push("");
    lines.push(
      `The certificate evidences the following ${cert.policyNumbers.length === 1 ? "policy" : "policies"}: ${cert.policyNumbers.join(", ")} (${cert.carriers.join(", ")}).`,
    );
    if (cert.blanketBasis) {
      lines.push("");
      lines.push(
        `${cert.holderName} is included as additional insured on a blanket basis per ${cert.blanketBasis}, as required by written contract.`,
      );
    }
    lines.push("");
    lines.push(
      "Please review and let us know if the holder details or wording need any correction.",
    );
    lines.push("");
    lines.push("Best regards,");
    lines.push("Harper Insurance Service Desk");
    return {
      to: cert.requesterEmail,
      subject: `Certificate Of Insurance — ${ctx.accountName} — ${cert.holderName}`,
      body: lines.join("\n"),
      holderName: cert.holderName,
    };
  });
}
