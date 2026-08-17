export interface OrderDetailQuote {
  fileName: string;
  mimeType: string | null;
  fileType: string;
  sizeBytes: number | null;
  canView: boolean;
}

export interface OrderDetailInitialPayment {
  paymentId: number;
  amountCents: number;
  currency: string;
  method: string | null;
  status: "settled";
  statusLabel: "Settled";
}

export interface OrderDetailBoundPolicy {
  dealId: number;
  policyId: number | null;
  policyNumber: string | null;
  status: string | null;
  carrierName: string | null;
  wholesalerName: string | null;
  coverageLabels: string[];
  effectiveDate: string | null;
  expirationDate: string | null;
  premiumCents: number | null;
  currency: string;
  boundAt: string | null;
}

export interface OrderDetailResponse {
  orderId: number;
  quote: OrderDetailQuote | null;
  initialPayment: OrderDetailInitialPayment | null;
  /** Order-level plan (Full pay / Financed), shown when no instrument resolves. */
  paymentPlan: string | null;
  harperFeeCents: number | null;
  boundPolicies: OrderDetailBoundPolicy[];
  fetchedAt: string;
}
