import {
  findBlanketForm,
  type EndorsementForm,
  type PolicyFormSet,
} from "./forms";
import type { Policy, RequestTypeId } from "./types";

/**
 * The blanket fast path: when the paper already grants AI or WOS by blanket
 * endorsement and the holder accepts wording, the certificate issues without
 * touching the market. The fork is requester intent, not just the schedule —
 * some holders contractually require being *named on the policy*, and that is
 * an underwriter ask even when blanket exists (sometimes charged, sometimes
 * not).
 *
 * Pure and deterministic: the same ticket + schedule always resolves the same
 * way, and every eligible result cites the exact form it stands on.
 */

/** Request wording that means the holder must be scheduled on the policy. */
export const NAMED_ON_POLICY_PATTERN =
  /must be named|named (?:directly )?on the policy|scheduled endorsement|specifically named|name (?:us|them|our company) on the policy/i;

export function wantsNamedOnPolicy(wording: string): boolean {
  return NAMED_ON_POLICY_PATTERN.test(wording);
}

/** Which blanket kind satisfies this request type, if any. */
export function blanketKindFor(
  requestType: RequestTypeId,
): "ai" | "wos" | null {
  if (requestType === "additional_insured") return "ai";
  if (requestType === "waiver_of_subrogation") return "wos";
  return null;
}

export type FastPathDecision =
  | {
      eligible: true;
      form: EndorsementForm;
      policy: Policy;
      /** Human-facing reason chip, citing the exact form */
      basis: string;
    }
  | {
      eligible: false;
      reason:
        | "not_wording_kind"
        | "named_on_policy"
        | "no_blanket"
        /** An active red alert stands the whole account down — callers refuse
            the fast path before evaluating the schedule at all. */
        | "red_alert";
    };

export function evaluateBlanketFastPath(input: {
  requestType: RequestTypeId;
  wording: string;
  namedOnPolicyRequired: boolean;
  policies: { policy: Policy; formSet: PolicyFormSet }[];
}): FastPathDecision {
  const kind = blanketKindFor(input.requestType);
  if (!kind) return { eligible: false, reason: "not_wording_kind" };

  if (input.namedOnPolicyRequired || wantsNamedOnPolicy(input.wording)) {
    return { eligible: false, reason: "named_on_policy" };
  }

  for (const { policy, formSet } of input.policies) {
    const form = findBlanketForm(formSet, kind);
    if (form) {
      return {
        eligible: true,
        form,
        policy,
        basis: `Blanket Applies — ${form.form} ${form.edition} On ${policy.policyNumber} — Wording Only, No Quote Needed`,
      };
    }
  }
  return { eligible: false, reason: "no_blanket" };
}
