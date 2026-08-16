import type { RequestTypeId } from "../types";

/** How we reach the market for service work. */
export type ChannelPrimary = "portal" | "email" | "phone" | "hybrid";

export interface ChannelRoute {
  primary: ChannelPrimary;
  /** Operator-facing one-liner */
  instruction: string;
  /** Prefer opening this URL when primary is portal/hybrid */
  portalUrl: string | null;
  /** Prefer this address when email is involved */
  email: string | null;
  /** Prefer call when phone path */
  phone: string | null;
  /** True when compose should send a tracked email */
  sendEmail: boolean;
  /** True when CTA should open portal first */
  openPortal: boolean;
  /** True when CTA should emphasize calling */
  callFirst: boolean;
}

/**
 * Channel logic — always request-type aware.
 *
 * DocuSign / signature packets are for binds & apps — NOT for routine
 * endorsement requests like Additional Insured.
 *
 * Portal-first markets still keep exception emails (subjectivities, notices).
 */
export function resolveChannel(input: {
  carrier: string;
  requestType: RequestTypeId;
  uwEmail: string;
  uwPhone: string | null;
  uwPortal: string | null;
  serviceEmail: string | null;
}): ChannelRoute {
  const carrier = input.carrier.toLowerCase();
  const email = input.serviceEmail || input.uwEmail;
  const portal = input.uwPortal;
  const phone = input.uwPhone;
  const rt = input.requestType;

  const endorsementLike =
    rt === "additional_insured" ||
    rt === "waiver_of_subrogation" ||
    rt === "primary_non_contributory" ||
    rt === "blanket_ai_wos" ||
    rt === "limit_change" ||
    rt === "additional_named_insured" ||
    rt === "coverage_extension" ||
    rt === "named_insured_correction" ||
    rt === "business_change" ||
    rt === "notice_cancellation_30";

  // --- ISC: MGA hybrid (not a flattened direct-carrier path) ---
  if (carrier === "isc") {
    const emailException =
      rt === "subjectivity_response" ||
      rt === "general_uw_question" ||
      rt === "notice_cancellation_30" ||
      rt === "business_change";
    if (emailException) {
      return {
        primary: "email",
        instruction:
          rt === "notice_cancellation_30"
            ? "ISC (MGA): 30-day notices do not go through the portal. Prepare the certificate and email it to the ISC certs desk (certs@iscmga.com); ISC replies with an endorsement charge — about $100 in desk history — that must be approved before the endorsement issues."
            : "ISC (MGA) exception path — email the ISC certs desk (subjectivities / material changes).",
        portalUrl: portal,
        email,
        phone,
        sendEmail: true,
        openPortal: false,
        callFirst: false,
      };
    }
    return {
      primary: "hybrid",
      instruction: endorsementLike
        ? "ISC (MGA): file this endorsement in the Instant Specialty portal (AI, name, address). Email only if the portal cannot take it."
        : "ISC (MGA): prefer the portal; email the named UW for notices/subjectivities.",
      portalUrl: portal,
      email,
      phone,
      sendEmail: false,
      openPortal: true,
      callFirst: false,
    };
  }

  // --- NEXT ---
  if (carrier.includes("next")) {
    if (rt === "blanket_ai_wos") {
      return {
        primary: "phone",
        instruction:
          "NEXT blanket waiver is not self-serve — insured must call NEXT. Portal only does per-cert (~$10).",
        portalUrl: portal,
        email,
        phone,
        sendEmail: false,
        openPortal: false,
        callFirst: true,
      };
    }
    if (endorsementLike) {
      return {
        primary: "portal",
        instruction:
          "NEXT: add this endorsement in the portal (per certificate). No DocuSign for AI/WOS requests.",
        portalUrl: portal,
        email,
        phone,
        sendEmail: false,
        openPortal: true,
        callFirst: false,
      };
    }
    return {
      primary: "portal",
      instruction: "NEXT: use the portal first; support email only for tickets.",
      portalUrl: portal,
      email,
      phone,
      sendEmail: false,
      openPortal: true,
      callFirst: false,
    };
  }

  // --- Coterie (direct carrier — not MGA) ---
  if (carrier === "coterie") {
    if (endorsementLike) {
      return {
        primary: "portal",
        instruction:
          "Coterie (direct): check whether blanket AI / WOS is already on the policy before requesting. No signature packet for endorsement requests.",
        portalUrl: portal,
        email,
        phone,
        sendEmail: false,
        openPortal: true,
        callFirst: false,
      };
    }
    return {
      primary: "hybrid",
      instruction:
        "Coterie (direct): prefer partners portal / self-serve; email only if the portal cannot complete it.",
      portalUrl: portal,
      email,
      phone,
      sendEmail: false,
      openPortal: true,
      callFirst: false,
    };
  }

  // --- RT Specialty (wholesale — not a direct carrier path) ---
  if (carrier.includes("rt specialty") || carrier === "rt specialty") {
    return {
      primary: "portal",
      instruction:
        "RT Specialty (wholesale): use RTConnect, and route to the named underwriter on the account — not a shared default desk. Email/call only when the portal errors.",
      portalUrl: portal,
      email,
      phone,
      sendEmail: false,
      openPortal: true,
      callFirst: false,
    };
  }

  // --- USLI: email for endorsements; DocuSign only for bind packets ---
  if (carrier === "usli") {
    if (rt === "binder_confirmation" || rt === "subjectivity_response") {
      return {
        primary: "email",
        instruction:
          "USLI bind / subjectivity path often includes a DocuSign packet — that is for binding paperwork, not for AI endorsements.",
        portalUrl: portal,
        email: input.uwEmail,
        phone,
        sendEmail: true,
        openPortal: false,
        callFirst: false,
      };
    }
    return {
      primary: "email",
      instruction: endorsementLike
        ? "USLI: email the underwriter to request this endorsement. You do not need a DocuSign packet for Additional Insured / WOS / limits."
        : "USLI: email the underwriter on the account.",
      portalUrl: portal,
      email: input.uwEmail,
      phone,
      sendEmail: true,
      openPortal: false,
      callFirst: false,
    };
  }

  // --- Default email markets ---
  return {
    primary: "email",
    instruction: endorsementLike
      ? "Email the underwriter matched to this policy/carrier. No signature packet for this endorsement type."
      : "Email the underwriter matched to this policy/carrier.",
    portalUrl: portal,
    email: input.uwEmail,
    phone,
    sendEmail: true,
    openPortal: false,
    callFirst: false,
  };
}

export function channelLabel(c: ChannelPrimary): string {
  switch (c) {
    case "portal":
      return "Portal";
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    case "hybrid":
      return "Portal + Email";
  }
}
