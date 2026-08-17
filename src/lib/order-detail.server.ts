import "server-only";

import { executeAgentToolsCommand } from "@/lib/adapters/agent-tools";
import { readOrderDigest } from "@/lib/db/book-digest";
import { getDb } from "@/lib/db/connection";
import type {
  OrderDetailBoundPolicy,
  OrderDetailInitialPayment,
  OrderDetailQuote,
  OrderDetailResponse,
} from "@/lib/order-detail-types";
import { runSupabaseManagementQuery } from "@/lib/supabase-management.server";

/** Age under which a digest-matching payload is served with no refetch. */
const DETAIL_TTL_MS = 60_000;
/**
 * Age under which a digest-matching payload is served instantly while a
 * background refetch replaces it. The digest proves the order's book-visible
 * content (deals, documents, gate, notes) is unchanged; the payment leg of
 * the payload lives outside the digest, which is why this window is bounded
 * instead of serving a matching digest forever.
 */
const DETAIL_SWR_TTL_MS = 30 * 60_000;
/** Sweep horizon for persisted detail payloads. */
const REMOTE_CACHE_PRUNE_MS = 7 * 24 * 60 * 60_000;
const QUOTE_URL_TTL_SECONDS = 5 * 60;

export type QuoteCandidateSource =
  | "deal_quote_selection"
  | "deal_document_selection"
  | "invoice_selection"
  | "deal_quote"
  | "order_document";

export interface QuoteCandidate {
  source: QuoteCandidateSource;
  sourceRank: number;
  sourcePrecedence: number;
  designatedAt: string | null;
  documentAt: string | null;
  quoteId: number | null;
  originalQuoteId: number | null;
  isPrimary: boolean;
  artifactId: string | null;
  legacyDocumentId: number | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  classificationType: string;
}

export interface InitialPaymentCandidate {
  orderId: number;
  paymentId: number;
  status: string;
  paymentPurpose: string | null;
  amountCents: number | null;
  currency: string | null;
  settledAt: string | null;
  postedAt: string | null;
  initiatedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  invoiceCancelledAt: string | null;
  invoiceVoidedAt: string | null;
  invoiceSupersededById: number | null;
  hasCompletedRefund: boolean;
  orderCorroborated: boolean;
  instrumentType: string | null;
  cardType: string | null;
  paymentMethod: string | null;
}

interface RawOrderDetailRow {
  order_id: number | string;
  client_initial_payment: number | string | null;
  harper_service_fee: number | string | null;
  payment_type: string | null;
  quote_candidates: unknown;
  payment_candidates: unknown;
  bound_policy_candidates: unknown;
}

export interface ResolvedOrderDetail extends OrderDetailResponse {
  /** Server-only. API responses are projected through `publicOrderDetail`. */
  quoteArtifactId: string | null;
}

/**
 * Detail payloads persist in SQLite (remote_cache), each stamped with the
 * order's book digest at fetch time. The digest, kept current by the
 * two-minute refresh, is the validity token: a match means the drawer opens
 * instantly — including across process restarts — and a mismatch means the
 * order really changed and the payload is refetched. Only the in-flight
 * dedupe stays in memory.
 */
type PersistedOrderDetail = {
  digest: string | null;
  detail: ResolvedOrderDetail;
};

const inFlight = new Map<string, Promise<ResolvedOrderDetail>>();

function trim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function decimalToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const thousandths = `${fraction}000`.slice(0, 3);
  let cents = Number(whole) * 100 + Number(thousandths.slice(0, 2));
  if (Number(thousandths[2]) >= 5) cents += 1;
  if (sign === "-") cents *= -1;
  return Number.isSafeInteger(cents) ? cents : null;
}

function boolean(value: unknown): boolean {
  return value === true || value === "true";
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const POLICY_NUMBER_PLACEHOLDERS = new Set([
  "unknown",
  "pending",
  "n/a",
  "na",
  "none",
  "null",
]);

const COVERAGE_LABELS: Readonly<Record<string, string>> = {
  GL: "General Liability",
  BOP: "Businessowners",
  WC: "Workers’ Compensation",
  PL: "Professional Liability",
  E_O: "Errors & Omissions",
  CYBER: "Cyber",
  PROPERTY: "Property",
};

function safePolicyNumber(value: unknown): string | null {
  const number = trim(value);
  if (!number || POLICY_NUMBER_PLACEHOLDERS.has(number.toLowerCase())) {
    return null;
  }
  return number.slice(0, 120);
}

function dateOnly(value: unknown): string | null {
  const date = trim(value);
  if (!date) return null;
  const match = date.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  return match?.[1] ?? null;
}

function validInstant(value: unknown): string | null {
  const timestamp = trim(value);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function readableCoverageLabel(value: unknown): string | null {
  const raw = trim(value);
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/[\s/-]+/g, "_");
  const known = COVERAGE_LABELS[key];
  if (known) return known;
  const readable = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!readable) return null;
  return (/^[A-Z0-9 &/-]+$/.test(readable)
    ? readable
        .toLowerCase()
        .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    : readable
  ).slice(0, 80);
}

function coverageLabels(
  policyCoverageLines: unknown,
  dealCoverageType: unknown,
): string[] {
  const values: unknown[] = [];
  for (const line of arrayValue(policyCoverageLines)) {
    if (line && typeof line === "object") {
      const row = line as Record<string, unknown>;
      values.push(
        row.coverage_type ??
          row.canonical_coverage_type ??
          row.source_coverage_label,
      );
    } else {
      values.push(line);
    }
  }
  values.push(...arrayValue(dealCoverageType));
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const label = readableCoverageLabel(value);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 10) break;
  }
  return labels;
}

function normalizeBoundPolicyCandidate(
  value: unknown,
): OrderDetailBoundPolicy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const dealId = positiveInteger(row.dealId);
  if (!dealId || trim(row.dealStage)?.toLowerCase() !== "bound") return null;
  const currency = trim(row.currency)?.toUpperCase() ?? "USD";
  return {
    dealId,
    policyId: positiveInteger(row.policyId),
    policyNumber: safePolicyNumber(row.policyNumber),
    status: trim(row.status)?.toLowerCase() ?? "bound",
    carrierName: trim(row.carrierName)?.slice(0, 160) ?? null,
    wholesalerName: trim(row.wholesalerName)?.slice(0, 160) ?? null,
    coverageLabels: coverageLabels(
      row.policyCoverageLines,
      row.dealCoverageType,
    ),
    effectiveDate: dateOnly(row.effectiveDate),
    expirationDate: dateOnly(row.expirationDate),
    premiumCents:
      nonNegativeInteger(row.policyPremiumCents) ??
      decimalToCents(row.dealPremium),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    boundAt: validInstant(row.boundAt),
  };
}

export function resolveBoundPolicies(value: unknown): OrderDetailBoundPolicy[] {
  const seen = new Set<string>();
  return arrayValue(value).flatMap((candidate) => {
    const policy = normalizeBoundPolicyCandidate(candidate);
    if (!policy) return [];
    const key = policy.policyId
      ? `policy:${policy.policyId}`
      : `deal:${policy.dealId}:${policy.policyNumber ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [policy];
  });
}

function safeFileName(value: unknown): string | null {
  const name = trim(value)?.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "");
  return name?.trim() || null;
}

function safeMimeType(value: unknown): string | null {
  const mime = trim(value)?.toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(
    mime,
  )
    ? mime
    : null;
}

function normalizeQuoteCandidate(value: unknown): QuoteCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = trim(row.source);
  if (
    source !== "deal_quote_selection" &&
    source !== "deal_document_selection" &&
    source !== "invoice_selection" &&
    source !== "deal_quote" &&
    source !== "order_document"
  ) {
    return null;
  }
  const classificationType = trim(row.classificationType)?.toUpperCase();
  if (classificationType !== "QUOTE") return null;
  const artifactId = trim(row.artifactId);
  const legacyDocumentId = positiveInteger(row.legacyDocumentId);
  if (!artifactId && !legacyDocumentId) return null;
  return {
    source,
    sourceRank: nonNegativeInteger(row.sourceRank) ?? 0,
    sourcePrecedence: nonNegativeInteger(row.sourcePrecedence) ?? 0,
    designatedAt: trim(row.designatedAt),
    documentAt: trim(row.documentAt),
    quoteId: positiveInteger(row.quoteId),
    originalQuoteId: positiveInteger(row.originalQuoteId),
    isPrimary: boolean(row.isPrimary),
    artifactId:
      artifactId?.startsWith("harper:artifact:") === true ? artifactId : null,
    legacyDocumentId,
    fileName: safeFileName(row.fileName),
    mimeType: safeMimeType(row.mimeType),
    sizeBytes: nonNegativeInteger(row.sizeBytes),
    classificationType,
  };
}

function instant(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function candidateIdentity(candidate: QuoteCandidate): string {
  return [
    candidate.quoteId ?? 0,
    candidate.artifactId ?? "",
    candidate.legacyDocumentId ?? 0,
  ].join(":");
}

/**
 * A deal/document/invoice selection is an explicit designation and outranks a
 * fallback document. Within the same designation, `is_primary` is the current
 * revision marker. The live table currently has no revision rows, so the final
 * ordering is intentionally deterministic for the first revision that arrives:
 * newest designation/document timestamp, then stable IDs.
 */
export function selectOrderQuote(
  candidates: readonly QuoteCandidate[],
): QuoteCandidate | null {
  const valid = candidates.filter(
    (candidate) =>
      candidate.classificationType === "QUOTE" &&
      Boolean(candidate.artifactId || candidate.legacyDocumentId),
  );
  valid.sort((left, right) => {
    if (left.sourceRank !== right.sourceRank) {
      return right.sourceRank - left.sourceRank;
    }
    if (left.isPrimary !== right.isPrimary) {
      return Number(right.isPrimary) - Number(left.isPrimary);
    }
    if (left.sourcePrecedence !== right.sourcePrecedence) {
      return right.sourcePrecedence - left.sourcePrecedence;
    }
    const leftTime = Math.max(
      instant(left.designatedAt),
      instant(left.documentAt),
    );
    const rightTime = Math.max(
      instant(right.designatedAt),
      instant(right.documentAt),
    );
    if (leftTime !== rightTime) return rightTime - leftTime;
    return candidateIdentity(right).localeCompare(candidateIdentity(left));
  });
  return valid[0] ?? null;
}

export function quoteFileType(
  mimeType: string | null,
  fileName: string | null,
): string {
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) {
    return mime.slice("image/".length).replace("jpeg", "JPG").toUpperCase();
  }
  const extension = fileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  return extension ? extension.toUpperCase() : "Document";
}

function normalizeInitialPaymentCandidate(
  value: unknown,
): InitialPaymentCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const orderId = positiveInteger(row.orderId);
  const paymentId = positiveInteger(row.paymentId);
  if (!orderId || !paymentId) return null;
  return {
    orderId,
    paymentId,
    status: trim(row.status)?.toLowerCase() ?? "",
    paymentPurpose: trim(row.paymentPurpose)?.toLowerCase() ?? null,
    amountCents: decimalToCents(row.amount),
    currency: trim(row.currency)?.toUpperCase() ?? null,
    settledAt: trim(row.settledAt),
    postedAt: trim(row.postedAt),
    initiatedAt: trim(row.initiatedAt),
    failedAt: trim(row.failedAt),
    cancelledAt: trim(row.cancelledAt),
    invoiceCancelledAt: trim(row.invoiceCancelledAt),
    invoiceVoidedAt: trim(row.invoiceVoidedAt),
    invoiceSupersededById: positiveInteger(row.invoiceSupersededById),
    hasCompletedRefund: boolean(row.hasCompletedRefund),
    orderCorroborated: boolean(row.orderCorroborated),
    instrumentType: trim(row.instrumentType)?.toUpperCase() ?? null,
    cardType: trim(row.cardType)?.toUpperCase() ?? null,
    paymentMethod: trim(row.paymentMethod)?.toLowerCase() ?? null,
  };
}

export function paymentMethodLabel(
  candidate: Pick<
    InitialPaymentCandidate,
    "instrumentType" | "cardType" | "paymentMethod"
  >,
): string | null {
  // The normalized revenue instrument wins. `paymentMethod` is populated only
  // from cpq.payment.payment_method_id -> cpq.payment_method.method_type; the
  // legacy cpq.payment.payment_method scalar is intentionally ignored because
  // live Finix bank transfers were verified carrying the stale value "card".
  if (candidate.instrumentType === "BANK_ACCOUNT") return "ACH";
  if (candidate.instrumentType === "APPLE_PAY") return "Apple Pay";
  if (candidate.instrumentType === "GOOGLE_PAY") return "Google Pay";
  if (candidate.instrumentType === "PAYMENT_CARD") {
    if (candidate.cardType?.includes("DEBIT")) return "Debit card";
    if (candidate.cardType?.includes("CREDIT")) return "Credit card";
    if (candidate.cardType?.includes("PREPAID")) return "Prepaid card";
    return "Card";
  }
  const method = candidate.paymentMethod?.replace(/[\s-]+/g, "_") ?? "";
  if (["ach", "bank", "bank_account", "echeck"].includes(method)) return "ACH";
  if (method === "credit_card") return "Credit card";
  if (method === "debit_card") return "Debit card";
  if (method === "card") return "Card";
  if (method === "check") return "Check";
  if (method === "financing" || method === "financed") return "Financing";
  return null;
}

/**
 * The order's payment plan — whether the term was paid up front or financed.
 * A different fact from the instrument the money arrived on, and the only one
 * available for roughly a sixth of settled payments, which carry neither a
 * stored payment method nor a normalized instrument to name. Unrecognized
 * values return null: an empty card beats inventing a plan.
 */
export function paymentPlanLabel(value: unknown): string | null {
  const plan = trim(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (plan === "full_pay" || plan === "full") return "Full pay";
  if (plan === "financed" || plan === "financing") return "Financed";
  return null;
}

export function isEligibleInitialPayment(
  candidate: InitialPaymentCandidate,
  orderId: number,
): boolean {
  return (
    candidate.orderId === orderId &&
    candidate.status === "settled" &&
    candidate.amountCents !== null &&
    candidate.settledAt !== null &&
    candidate.failedAt === null &&
    candidate.cancelledAt === null &&
    candidate.invoiceCancelledAt === null &&
    candidate.invoiceVoidedAt === null &&
    candidate.invoiceSupersededById === null &&
    !candidate.hasCompletedRefund &&
    candidate.orderCorroborated
  );
}

function paymentOccurredAt(candidate: InitialPaymentCandidate): number {
  return Math.max(
    instant(candidate.settledAt),
    instant(candidate.postedAt),
    instant(candidate.initiatedAt),
  );
}

/**
 * `payment_purpose = down_payment` is the explicit initial-payment
 * designation. If an older producer flow omitted it, a valid payment matching
 * `orders_temp.client_initial_payment` wins; otherwise the earliest valid
 * settled payment for this exact legacy order is the deterministic fallback.
 */
export function selectInitialPayment(
  candidates: readonly InitialPaymentCandidate[],
  orderId: number,
  designatedAmountCents: number | null,
): OrderDetailInitialPayment | null {
  const eligible = candidates.filter((candidate) =>
    isEligibleInitialPayment(candidate, orderId),
  );
  eligible.sort((left, right) => {
    const leftPurpose = left.paymentPurpose === "down_payment" ? 0 : 1;
    const rightPurpose = right.paymentPurpose === "down_payment" ? 0 : 1;
    if (leftPurpose !== rightPurpose) return leftPurpose - rightPurpose;
    const leftMatches =
      designatedAmountCents !== null &&
      left.amountCents === designatedAmountCents
        ? 0
        : 1;
    const rightMatches =
      designatedAmountCents !== null &&
      right.amountCents === designatedAmountCents
        ? 0
        : 1;
    if (leftMatches !== rightMatches) return leftMatches - rightMatches;
    const occurred = paymentOccurredAt(left) - paymentOccurredAt(right);
    if (occurred !== 0) return occurred;
    return left.paymentId - right.paymentId;
  });
  const selected = eligible[0];
  if (!selected || selected.amountCents === null) return null;
  return {
    paymentId: selected.paymentId,
    amountCents: selected.amountCents,
    currency: selected.currency ?? "USD",
    method: paymentMethodLabel(selected),
    status: "settled",
    statusLabel: "Settled",
  };
}

function buildOrderDetailQuery(companyId: number, orderId: number): string {
  return `
    WITH RECURSIVE
    target_order AS (
      SELECT
        ot.id,
        ot.company_id,
        ot.client_initial_payment,
        ot.harper_service_fee,
        ot.payment_type,
        ot.order_documents
      FROM public.orders_temp ot
      JOIN public.companies company ON company.id = ot.company_id
      WHERE ot.id = ${orderId}
        AND ot.company_id = ${companyId}
        AND COALESCE(ot.is_deleted, false) = false
        AND COALESCE(company.is_testing_user, false) = false
      LIMIT 1
    ),
    order_deals AS (
      SELECT deal.*
      FROM public.deals_v2 deal
      JOIN target_order target ON target.id = deal.order_number
      WHERE COALESCE(deal.is_deleted, false) = false
    ),
    bound_policy_candidates AS (
      SELECT
        deal.id AS deal_id,
        deal.deal_stage,
        policy.id AS policy_id,
        COALESCE(
          CASE
            WHEN LOWER(TRIM(COALESCE(policy.policy_number, ''))) NOT IN (
              'unknown', 'pending', 'n/a', 'na', 'none', 'null'
            )
            THEN NULLIF(TRIM(policy.policy_number), '')
          END,
          CASE
            WHEN LOWER(TRIM(COALESCE(deal.policy_number, ''))) NOT IN (
              'unknown', 'pending', 'n/a', 'na', 'none', 'null'
            )
            THEN NULLIF(TRIM(deal.policy_number), '')
          END
        ) AS policy_number,
        COALESCE(
          NULLIF(TRIM(policy.status), ''),
          NULLIF(TRIM(deal.policy_status), ''),
          'bound'
        ) AS status,
        COALESCE(
          CASE
            WHEN JSONB_TYPEOF(policy.coverage_lines) = 'array'
            THEN NULLIF(
              policy.coverage_lines->0->'carrier'->>'name',
              ''
            )
          END,
          NULLIF(carrier.name, ''),
          NULLIF(deal.carrier, ''),
          NULLIF(deal.ai_carrier, '')
        ) AS carrier_name,
        COALESCE(
          NULLIF(wholesaler.name, ''),
          NULLIF(deal.wholesaler, ''),
          NULLIF(deal.ai_wholesaler, '')
        ) AS wholesaler_name,
        policy.coverage_lines AS policy_coverage_lines,
        deal.coverage_type AS deal_coverage_type,
        COALESCE(policy.effective_date, deal.effective_date)::text
          AS effective_date,
        COALESCE(policy.expiration_date, deal.expiration_date)::text
          AS expiration_date,
        policy.premium_amount_cents,
        deal.premium AS deal_premium,
        COALESCE(NULLIF(policy.premium_currency, ''), 'USD') AS currency,
        COALESCE(policy.bound_at, deal.ai_bound_at, deal.bound_at)
          AS bound_at
      FROM order_deals deal
      LEFT JOIN insurance.policy policy
        ON policy.source_quote_id = deal.quote_id
        AND policy.cancelled_at IS NULL
        AND LOWER(COALESCE(policy.status, '')) NOT IN (
          'cancelled', 'canceled', 'voided'
        )
      LEFT JOIN public.insurance_carriers carrier
        ON carrier.code = deal.carrier
      LEFT JOIN public.general_agents wholesaler
        ON wholesaler.code = deal.wholesaler
      WHERE LOWER(COALESCE(deal.deal_stage, '')) = 'bound'
        AND deal.cancelled_date IS NULL
    ),
    order_invoices AS (
      SELECT invoice.*
      FROM insurance.invoice invoice
      JOIN target_order target ON target.id = invoice.legacy_order_id
    ),
    -- Payments reach their invoice by a wider path than quotes do. Three
    -- quarters of invoices carry no legacy_order_id at all, so joining on it
    -- alone loses a settled payment the order's own deal already points at.
    -- Membership is tested by id rather than UNIONed, because the invoice row
    -- carries JSON columns that have no equality operator to dedupe on.
    -- Deliberately separate from order_invoices: widening that one would move
    -- active_invoices and the quote seeds too, and quote selection is right.
    payment_invoices AS (
      SELECT invoice.*
      FROM insurance.invoice invoice
      WHERE invoice.legacy_order_id IN (SELECT id FROM target_order)
         OR invoice.id IN (
           SELECT line.invoice_id
           FROM insurance.invoice_line_item line
           JOIN order_deals deal
             ON deal.invoice_line_item_id = line.id
             OR (deal.quote_id IS NOT NULL AND deal.quote_id = line.quote_id)
         )
    ),
    active_invoices AS (
      SELECT invoice.*
      FROM order_invoices invoice
      WHERE invoice.cancelled_at IS NULL
        AND invoice.voided_at IS NULL
        AND invoice.superseded_by_invoice_id IS NULL
        AND LOWER(COALESCE(invoice.status, '')) NOT IN (
          'cancelled', 'canceled', 'voided'
        )
    ),
    quote_seeds AS (
      SELECT
        'deal_quote_selection'::text AS source,
        500::integer AS source_rank,
        selection.source_precedence::integer AS source_precedence,
        selection.occurred_at AS designated_at,
        selection.quote_id
      FROM order_deals deal
      JOIN backwards_compatibility.deal_quote_selection selection
        ON selection.deal_id = deal.id

      UNION ALL

      SELECT
        'invoice_selection',
        400,
        0,
        COALESCE(invoice.accepted_at, invoice.updated_at, invoice.created_at),
        line.quote_id
      FROM active_invoices invoice
      JOIN insurance.invoice_line_item line ON line.invoice_id = invoice.id
      WHERE line.quote_id IS NOT NULL
        AND line.status = 'included'
        AND line.selection_status = 'selected'

      UNION ALL

      SELECT
        'deal_quote',
        300,
        0,
        deal.created_at,
        deal.quote_id
      FROM order_deals deal
      WHERE deal.quote_id IS NOT NULL
    ),
    quote_tree AS (
      SELECT
        seed.source,
        seed.source_rank,
        seed.source_precedence,
        seed.designated_at,
        quote.quote_id,
        quote.original_quote_id,
        quote.is_primary,
        quote.artifact_id,
        quote.received_at,
        quote.quoted_at,
        quote.created_at,
        quote.updated_at,
        ARRAY[quote.quote_id]::bigint[] AS path
      FROM quote_seeds seed
      JOIN insurance.quote quote ON quote.quote_id = seed.quote_id

      UNION ALL

      SELECT
        tree.source,
        tree.source_rank,
        tree.source_precedence,
        tree.designated_at,
        child.quote_id,
        child.original_quote_id,
        child.is_primary,
        child.artifact_id,
        child.received_at,
        child.quoted_at,
        child.created_at,
        child.updated_at,
        tree.path || child.quote_id
      FROM quote_tree tree
      JOIN insurance.quote child ON child.original_quote_id = tree.quote_id
      WHERE NOT child.quote_id = ANY(tree.path)
    ),
    quote_record_candidates AS (
      SELECT
        tree.source,
        tree.source_rank,
        tree.source_precedence,
        tree.designated_at,
        COALESCE(
          tree.received_at,
          tree.quoted_at,
          tree.updated_at,
          tree.created_at
        ) AS document_at,
        tree.quote_id,
        tree.original_quote_id,
        tree.is_primary,
        artifact.artifact_id,
        NULL::bigint AS legacy_document_id,
        COALESCE(
          NULLIF(artifact.metadata->>'original_filename', ''),
          NULLIF(classification.classification_subtype, '')
        ) AS file_name,
        COALESCE(
          NULLIF(artifact.metadata->>'content_type', ''),
          NULLIF(artifact.metadata->>'mime_type', '')
        ) AS mime_type,
        CASE
          WHEN COALESCE(artifact.metadata->>'size_bytes', '') ~ '^\\d+$'
          THEN (artifact.metadata->>'size_bytes')::bigint
          ELSE NULL
        END AS size_bytes,
        classification.classification_type
      FROM quote_tree tree
      JOIN artifacts.artifacts artifact
        ON artifact.artifact_id = tree.artifact_id
        AND artifact.artifact_type = 'DOCUMENT'
      JOIN artifacts.artifact_classification classification
        ON classification.artifact_id = artifact.artifact_id
        AND classification.classification_type = 'QUOTE'
    ),
    deal_document_candidates AS (
      SELECT
        'deal_document_selection'::text AS source,
        450::integer AS source_rank,
        selection.source_precedence::integer AS source_precedence,
        selection.occurred_at AS designated_at,
        COALESCE(artifact.created_at, document.event_at, document.created_at)
          AS document_at,
        NULL::bigint AS quote_id,
        NULL::bigint AS original_quote_id,
        false AS is_primary,
        CASE
          WHEN artifact_classification.classification_type = 'QUOTE'
          THEN artifact.artifact_id
          ELSE NULL
        END AS artifact_id,
        document.id AS legacy_document_id,
        COALESCE(
          NULLIF(artifact.metadata->>'original_filename', ''),
          NULLIF(document.metadata->>'filename', ''),
          REGEXP_REPLACE(document.object_name, '^.*/', ''),
          NULLIF(artifact_classification.classification_subtype, ''),
          NULLIF(document_classification.document_subtype, '')
        ) AS file_name,
        COALESCE(
          NULLIF(artifact.metadata->>'content_type', ''),
          NULLIF(artifact.metadata->>'mime_type', ''),
          NULLIF(document.metadata->>'content_type', '')
        ) AS mime_type,
        COALESCE(
          CASE
            WHEN COALESCE(artifact.metadata->>'size_bytes', '') ~ '^\\d+$'
            THEN (artifact.metadata->>'size_bytes')::bigint
          END,
          CASE
            WHEN COALESCE(document.metadata->>'file_size', '') ~ '^\\d+$'
            THEN (document.metadata->>'file_size')::bigint
          END
        ) AS size_bytes,
        'QUOTE'::text AS classification_type
      FROM order_deals deal
      JOIN backwards_compatibility.deal_document_selection selection
        ON selection.deal_id = deal.id
        AND selection.role::text = 'QUOTE'
      LEFT JOIN public.documents document
        ON document.id = selection.attachment_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(latest.manual_category_classification, ''),
            NULLIF(latest.category, '')
          ) AS classification_type,
          latest.document_subtype
        FROM public.documents_classification latest
        WHERE latest.attachment_id = document.id
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT 1
      ) document_classification ON true
      LEFT JOIN artifacts.artifacts artifact
        ON artifact.artifact_id = selection.artifact_id
        AND artifact.artifact_type = 'DOCUMENT'
      LEFT JOIN artifacts.artifact_classification artifact_classification
        ON artifact_classification.artifact_id = artifact.artifact_id
      WHERE (
        artifact_classification.classification_type = 'QUOTE'
        OR UPPER(COALESCE(document_classification.classification_type, '')) = 'QUOTE'
      )
    ),
    order_document_base AS (
      SELECT
        target.id AS order_id,
        target.company_id,
        document.id AS legacy_document_id,
        COALESCE(
          NULLIF(entry.value->>'filename', ''),
          NULLIF(document.metadata->>'filename', ''),
          REGEXP_REPLACE(document.object_name, '^.*/', ''),
          NULLIF(classification.document_subtype, '')
        ) AS file_name,
        NULLIF(document.metadata->>'content_type', '') AS mime_type,
        CASE
          WHEN COALESCE(document.metadata->>'file_size', '') ~ '^\\d+$'
          THEN (document.metadata->>'file_size')::bigint
          ELSE NULL
        END AS size_bytes,
        COALESCE(document.event_at, document.created_at) AS document_at
      FROM target_order target
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
        CASE
          WHEN JSONB_TYPEOF(target.order_documents) = 'array'
          THEN target.order_documents
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY entry(value, position)
      JOIN public.documents document
        ON document.id = CASE
          WHEN COALESCE(entry.value->>'attachment_id', '') ~ '^\\d+$'
          THEN (entry.value->>'attachment_id')::bigint
          ELSE NULL
        END
      JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(latest.manual_category_classification, ''),
            NULLIF(latest.category, '')
          ) AS classification_type,
          latest.document_subtype
        FROM public.documents_classification latest
        WHERE latest.attachment_id = document.id
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT 1
      ) classification
        ON UPPER(COALESCE(classification.classification_type, '')) = 'QUOTE'
    ),
    legacy_artifact_match_rows AS (
      -- Legacy order filenames embed the first eight characters of the Aether
      -- content ID. Require that token plus company, QUOTE classification,
      -- exact byte size, MIME type, and a unique match; size alone is unsafe.
      SELECT DISTINCT
        document.order_id,
        document.legacy_document_id,
        artifact.artifact_id
      FROM order_document_base document
      JOIN artifacts.artifact_entities entity
        ON entity.entity_type = 'COMPANY'
        AND entity.entity_id = document.company_id
      JOIN artifacts.artifacts artifact
        ON artifact.artifact_id = entity.artifact_id
        AND artifact.artifact_type = 'DOCUMENT'
      JOIN artifacts.artifact_classification classification
        ON classification.artifact_id = artifact.artifact_id
        AND classification.classification_type = 'QUOTE'
      WHERE document.file_name ILIKE (
          '%' || LEFT(SPLIT_PART(artifact.artifact_id, ':', 3), 8) || '%'
        )
        AND document.size_bytes IS NOT NULL
        AND COALESCE(artifact.metadata->>'size_bytes', '') ~ '^\\d+$'
        AND (artifact.metadata->>'size_bytes')::bigint = document.size_bytes
        AND (
          document.mime_type IS NULL
          OR LOWER(COALESCE(
            artifact.metadata->>'content_type',
            artifact.metadata->>'mime_type',
            ''
          )) = LOWER(document.mime_type)
        )
    ),
    legacy_artifact_matches AS (
      SELECT
        order_id,
        legacy_document_id,
        MIN(artifact_id) AS artifact_id,
        COUNT(*) AS candidate_count
      FROM legacy_artifact_match_rows
      GROUP BY order_id, legacy_document_id
    ),
    order_document_candidates AS (
      SELECT
        'order_document'::text AS source,
        100::integer AS source_rank,
        0::integer AS source_precedence,
        NULL::timestamptz AS designated_at,
        document.document_at,
        NULL::bigint AS quote_id,
        NULL::bigint AS original_quote_id,
        false AS is_primary,
        CASE
          WHEN mapping.candidate_count = 1 THEN mapping.artifact_id
          ELSE NULL
        END AS artifact_id,
        document.legacy_document_id,
        COALESCE(
          NULLIF(artifact.metadata->>'original_filename', ''),
          document.file_name
        ) AS file_name,
        COALESCE(
          NULLIF(artifact.metadata->>'content_type', ''),
          NULLIF(artifact.metadata->>'mime_type', ''),
          document.mime_type
        ) AS mime_type,
        COALESCE(
          CASE
            WHEN COALESCE(artifact.metadata->>'size_bytes', '') ~ '^\\d+$'
            THEN (artifact.metadata->>'size_bytes')::bigint
          END,
          document.size_bytes
        ) AS size_bytes,
        'QUOTE'::text AS classification_type
      FROM order_document_base document
      LEFT JOIN legacy_artifact_matches mapping
        ON mapping.order_id = document.order_id
        AND mapping.legacy_document_id = document.legacy_document_id
      LEFT JOIN artifacts.artifacts artifact
        ON mapping.candidate_count = 1
        AND artifact.artifact_id = mapping.artifact_id
    ),
    quote_candidates AS (
      SELECT * FROM quote_record_candidates
      UNION ALL
      SELECT * FROM deal_document_candidates
      UNION ALL
      SELECT * FROM order_document_candidates
    ),
    payment_candidates AS (
      SELECT
        target.id AS order_id,
        payment.id AS payment_id,
        payment.status,
        payment.payment_purpose,
        payment.amount,
        payment.currency,
        payment.settled_at,
        payment.posted_at,
        payment.initiated_at,
        payment.failed_at,
        payment.cancelled_at,
        invoice.cancelled_at AS invoice_cancelled_at,
        invoice.voided_at AS invoice_voided_at,
        invoice.superseded_by_invoice_id,
        EXISTS (
          SELECT 1
          FROM cpq.refund refund
          WHERE refund.payment_id = payment.id
            AND LOWER(COALESCE(refund.status, '')) IN (
              'completed', 'settled', 'succeeded'
            )
            AND refund.failed_at IS NULL
        ) AS has_completed_refund,
        -- legacy_order_id can be stamped onto an older invoice during a later
        -- order migration. Require independent transfer/quote/line evidence,
        -- or an exact match to the order's designated initial-payment amount.
        (
          EXISTS (
            SELECT 1
            FROM order_deals deal
            WHERE deal.transfer_id = payment.payment_reference
          )
          OR EXISTS (
            SELECT 1
            FROM insurance.invoice_line_item line
            WHERE line.invoice_id = invoice.id
              AND (
                EXISTS (
                  SELECT 1
                  FROM order_deals deal
                  WHERE deal.invoice_line_item_id = line.id
                    OR (
                      deal.quote_id IS NOT NULL
                      AND deal.quote_id = line.quote_id
                    )
                )
                OR EXISTS (
                  SELECT 1
                  FROM backwards_compatibility.deal_quote_selection selection
                  JOIN order_deals deal ON deal.id = selection.deal_id
                  WHERE selection.invoice_line_item_id = line.id
                    OR selection.quote_id = line.quote_id
                )
                OR EXISTS (
                  SELECT 1
                  FROM backwards_compatibility.deal_quote_link link
                  JOIN order_deals deal ON deal.id = link.deal_id
                  WHERE link.invoice_line_item_id = line.id
                    OR link.quote_id = line.quote_id
                )
              )
          )
          OR (
            target.client_initial_payment IS NOT NULL
            AND payment.amount = target.client_initial_payment
          )
        ) AS order_corroborated,
        instrument.instrument_type,
        instrument.card_type,
        stored_method.method_type AS payment_method
      FROM target_order target
      JOIN payment_invoices invoice ON true
      JOIN cpq.payment payment ON payment.invoice_id = invoice.id
      LEFT JOIN cpq.payment_method stored_method
        ON stored_method.id = payment.payment_method_id
        AND stored_method.account_id = payment.account_id
      LEFT JOIN LATERAL (
        SELECT
          payment_instrument.type AS instrument_type,
          payment_instrument.card_type
        FROM revenue.payment_silver normalized_payment
        LEFT JOIN revenue.payment_instrument_silver payment_instrument
          ON payment_instrument.processor = normalized_payment.processor
          AND payment_instrument.source_id = normalized_payment.instrument_key
        WHERE normalized_payment.processor = payment.processor
          AND normalized_payment.payment_transaction_id =
            payment.payment_reference
        ORDER BY normalized_payment.updated_at DESC, normalized_payment.id DESC
        LIMIT 1
      ) instrument ON true
    ),
    link_payment_candidates AS (
      -- Settled payment-link registry rows (public.payments) that never
      -- produced a CLS payment row. The registry's completed flag is written
      -- by the processor's transfer-succeeded webhook, so these are real
      -- money movements; corroborate them to this exact order through a
      -- non-deleted deal's transfer_id or the order's designated
      -- initial-payment amount.
      SELECT
        target.id AS order_id,
        registry.id AS payment_id,
        'settled'::text AS status,
        NULL::text AS payment_purpose,
        registry."amount_USD"::numeric AS amount,
        'USD'::text AS currency,
        COALESCE(registry.updated_at, registry.created_at) AS settled_at,
        NULL::timestamptz AS posted_at,
        COALESCE(registry.created_at, registry.updated_at) AS initiated_at,
        NULL::timestamptz AS failed_at,
        NULL::timestamptz AS cancelled_at,
        NULL::timestamptz AS invoice_cancelled_at,
        NULL::timestamptz AS invoice_voided_at,
        NULL::bigint AS superseded_by_invoice_id,
        false AS has_completed_refund,
        (
          EXISTS (
            SELECT 1
            FROM order_deals deal
            WHERE deal.transfer_id = registry.transfer_id
          )
          OR (
            target.client_initial_payment IS NOT NULL
            AND registry."amount_USD"::numeric = target.client_initial_payment
          )
        ) AS order_corroborated,
        UPPER(COALESCE(
          NULLIF(registry.payment_details->>'instrument_type', ''),
          NULLIF(registry.payment_details->>'type', '')
        )) AS instrument_type,
        UPPER(NULLIF(registry.payment_details->>'card_type', ''))
          AS card_type,
        NULLIF(registry.payment_details->>'payment_method', '')
          AS payment_method
      FROM target_order target
      JOIN public.payments registry ON registry.company_id = target.company_id
      WHERE registry.completed = true
        AND NULLIF(TRIM(registry.transfer_id), '') IS NOT NULL
        AND registry."amount_USD" ~ '^[0-9]+(\\.[0-9]+)?$'
        AND NOT EXISTS (
          SELECT 1
          FROM cpq.payment cls
          WHERE cls.processor_reference_id = registry.payment_link_id
        )
    ),
    all_payment_candidates AS (
      SELECT * FROM payment_candidates
      UNION ALL
      SELECT * FROM link_payment_candidates
    )
    SELECT
      target.id AS order_id,
      target.client_initial_payment,
      target.harper_service_fee,
      target.payment_type,
      COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'source', candidate.source,
          'sourceRank', candidate.source_rank,
          'sourcePrecedence', candidate.source_precedence,
          'designatedAt', candidate.designated_at,
          'documentAt', candidate.document_at,
          'quoteId', candidate.quote_id,
          'originalQuoteId', candidate.original_quote_id,
          'isPrimary', candidate.is_primary,
          'artifactId', candidate.artifact_id,
          'legacyDocumentId', candidate.legacy_document_id,
          'fileName', candidate.file_name,
          'mimeType', candidate.mime_type,
          'sizeBytes', candidate.size_bytes,
          'classificationType', candidate.classification_type
        ))
        FROM quote_candidates candidate
      ), '[]'::jsonb) AS quote_candidates,
      COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'orderId', candidate.order_id,
          'paymentId', candidate.payment_id,
          'status', candidate.status,
          'paymentPurpose', candidate.payment_purpose,
          'amount', candidate.amount,
          'currency', candidate.currency,
          'settledAt', candidate.settled_at,
          'postedAt', candidate.posted_at,
          'initiatedAt', candidate.initiated_at,
          'failedAt', candidate.failed_at,
          'cancelledAt', candidate.cancelled_at,
          'invoiceCancelledAt', candidate.invoice_cancelled_at,
          'invoiceVoidedAt', candidate.invoice_voided_at,
          'invoiceSupersededById', candidate.superseded_by_invoice_id,
          'hasCompletedRefund', candidate.has_completed_refund,
          'orderCorroborated', candidate.order_corroborated,
          'instrumentType', candidate.instrument_type,
          'cardType', candidate.card_type,
          'paymentMethod', candidate.payment_method
        ))
        FROM all_payment_candidates candidate
      ), '[]'::jsonb) AS payment_candidates,
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'dealId', candidate.deal_id,
            'dealStage', candidate.deal_stage,
            'policyId', candidate.policy_id,
            'policyNumber', candidate.policy_number,
            'status', candidate.status,
            'carrierName', candidate.carrier_name,
            'wholesalerName', candidate.wholesaler_name,
            'policyCoverageLines', candidate.policy_coverage_lines,
            'dealCoverageType', candidate.deal_coverage_type,
            'effectiveDate', candidate.effective_date,
            'expirationDate', candidate.expiration_date,
            'policyPremiumCents', candidate.premium_amount_cents,
            'dealPremium', candidate.deal_premium,
            'currency', candidate.currency,
            'boundAt', candidate.bound_at
          )
          ORDER BY candidate.deal_id, candidate.policy_id
        )
        FROM bound_policy_candidates candidate
      ), '[]'::jsonb) AS bound_policy_candidates
    FROM target_order target
  `;
}

function resolveOrderDetailRow(
  row: RawOrderDetailRow,
  expectedOrderId: number,
): ResolvedOrderDetail {
  const orderId = positiveInteger(row.order_id);
  if (!orderId || orderId !== expectedOrderId) {
    throw new Error("order_detail_not_found");
  }
  const quoteCandidates = arrayValue(row.quote_candidates).flatMap((candidate) => {
    const normalized = normalizeQuoteCandidate(candidate);
    return normalized ? [normalized] : [];
  });
  const selectedQuote = selectOrderQuote(quoteCandidates);
  const paymentCandidates = arrayValue(row.payment_candidates).flatMap(
    (candidate) => {
      const normalized = normalizeInitialPaymentCandidate(candidate);
      return normalized ? [normalized] : [];
    },
  );
  const initialPayment = selectInitialPayment(
    paymentCandidates,
    orderId,
    decimalToCents(row.client_initial_payment),
  );
  const quote: OrderDetailQuote | null = selectedQuote
    ? {
        fileName: selectedQuote.fileName ?? "Uploaded quote",
        mimeType: selectedQuote.mimeType,
        fileType: quoteFileType(
          selectedQuote.mimeType,
          selectedQuote.fileName,
        ),
        sizeBytes: selectedQuote.sizeBytes,
        canView: selectedQuote.artifactId !== null,
      }
    : null;
  return {
    orderId,
    quote,
    quoteArtifactId: selectedQuote?.artifactId ?? null,
    initialPayment,
    paymentPlan: paymentPlanLabel(row.payment_type),
    // Null stays unavailable; an explicit database zero stays $0.00.
    harperFeeCents: decimalToCents(row.harper_service_fee),
    boundPolicies: resolveBoundPolicies(row.bound_policy_candidates),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchOrderDetail(
  companyId: number,
  orderId: number,
): Promise<ResolvedOrderDetail> {
  const rows = await runSupabaseManagementQuery<RawOrderDetailRow>(
    buildOrderDetailQuery(companyId, orderId),
    25_000,
  );
  const row = rows[0];
  if (!row) throw new Error("order_detail_not_found");
  return resolveOrderDetailRow(row, orderId);
}

function assertIds(companyId: number, orderId: number): void {
  if (
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !Number.isSafeInteger(orderId) ||
    orderId <= 0
  ) {
    throw new Error("invalid_order_detail_ids");
  }
}

function detailCacheKey(companyId: number, orderId: number): string {
  // v2: payments now reach their invoice through the order's deals, and the
  // payload carries the order's payment plan. Payloads written by the old
  // query would otherwise keep serving a payment it could not see.
  return `order-detail:v2:${companyId}:${orderId}`;
}

function readPersistedDetail(
  key: string,
): { entry: PersistedOrderDetail; ageMs: number } | null {
  const row = getDb()
    .prepare(`SELECT payload, fetched_at FROM remote_cache WHERE cache_key = ?`)
    .get(key) as { payload: string; fetched_at: number } | undefined;
  if (!row) return null;
  try {
    return {
      entry: JSON.parse(row.payload) as PersistedOrderDetail,
      ageMs: Math.max(0, Date.now() - row.fetched_at),
    };
  } catch {
    return null;
  }
}

function persistDetail(key: string, entry: PersistedOrderDetail): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_cache (cache_key, payload, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`,
  ).run(key, JSON.stringify(entry), Date.now());
  db.prepare(`DELETE FROM remote_cache WHERE fetched_at <= ?`).run(
    Date.now() - REMOTE_CACHE_PRUNE_MS,
  );
}

/** One shared live refetch per order, persisted with its digest on success. */
function revalidateOrderDetail(
  companyId: number,
  orderId: number,
  digest: string | null,
): Promise<ResolvedOrderDetail> {
  const key = `${companyId}:${orderId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const request = fetchOrderDetail(companyId, orderId)
    .then((value) => {
      persistDetail(detailCacheKey(companyId, orderId), {
        digest,
        detail: value,
      });
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export async function loadOrderDetail({
  companyId,
  orderId,
}: {
  companyId: number;
  orderId: number;
}): Promise<ResolvedOrderDetail> {
  assertIds(companyId, orderId);
  // The digest read before the fetch is deliberately the one stored with the
  // payload: if a refresh tick lands mid-fetch, the next open sees a mismatch
  // and refetches — a redundant fetch, never a payload wrongly marked current.
  const currentDigest = readOrderDigest(getDb(), orderId);
  const persisted = readPersistedDetail(detailCacheKey(companyId, orderId));
  const digestMatches =
    persisted !== null && persisted.entry.digest === currentDigest;
  if (persisted && digestMatches && persisted.ageMs < DETAIL_TTL_MS) {
    return persisted.entry.detail;
  }
  if (persisted && digestMatches && persisted.ageMs < DETAIL_SWR_TTL_MS) {
    void revalidateOrderDetail(companyId, orderId, currentDigest).catch(
      (cause) => {
        console.warn("order_detail_revalidate_failed", {
          companyId,
          orderId,
          errorCategory:
            cause instanceof Error ? cause.message : "unknown_order_detail_error",
        });
      },
    );
    return persisted.entry.detail;
  }
  return revalidateOrderDetail(companyId, orderId, currentDigest);
}

export function publicOrderDetail(
  detail: ResolvedOrderDetail,
): OrderDetailResponse {
  return {
    orderId: detail.orderId,
    quote: detail.quote,
    initialPayment: detail.initialPayment,
    paymentPlan: detail.paymentPlan,
    harperFeeCents: detail.harperFeeCents,
    boundPolicies: detail.boundPolicies,
    fetchedAt: detail.fetchedAt,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export async function mintOrderQuoteUrl({
  companyId,
  orderId,
}: {
  companyId: number;
  orderId: number;
}): Promise<string> {
  const detail = await loadOrderDetail({ companyId, orderId });
  const artifactId = detail.quoteArtifactId;
  if (!artifactId) throw new Error("order_quote_unavailable");

  const result = await executeAgentToolsCommand("documents document get", {
    artifact_id: artifactId,
    expires_in: QUOTE_URL_TTL_SECONDS,
    include_classification: true,
    include_entities: false,
  });
  if (!result.ok) throw new Error("order_quote_access_failed");
  const outer = object(result.data) ?? {};
  const payload = object(outer.data) ?? outer;
  if (
    trim(payload.artifact_id) !== artifactId ||
    trim(payload.classification_type)?.toUpperCase() !== "QUOTE"
  ) {
    throw new Error("order_quote_access_mismatch");
  }
  const signedUrl = trim(payload.signed_url);
  if (!signedUrl) throw new Error("order_quote_access_missing_url");
  const url = new URL(signedUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("order_quote_access_invalid_url");
  }
  return url.toString();
}

export function _resetOrderDetailCacheForTests(): void {
  inFlight.clear();
  getDb()
    .prepare(`DELETE FROM remote_cache WHERE cache_key LIKE 'order-detail:%'`)
    .run();
}
