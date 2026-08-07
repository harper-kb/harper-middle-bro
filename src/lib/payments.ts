/**
 * Payment link seam.
 *
 * Everything downstream (the client email, the thread record) only touches
 * `PaymentLink`, so swapping this stub for a real processor later is a
 * one-file change. Links are derived deterministically from the thread so
 * server and client render the same string.
 */

export interface PaymentLink {
  url: string;
  reference: string;
  amountCents: number;
  memo: string;
  /** ISO date the link stops working */
  expiresAt: string;
  status: "unpaid" | "paid" | "expired";
}

const PAY_HOST = "https://pay.harperinsure.com";
const DEFAULT_WINDOW_DAYS = 14;

/** Stable short token — same thread + amount always yields the same link. */
function token(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

export function createPaymentLink(input: {
  threadId: string;
  accountName: string;
  policyNumber: string;
  amountCents: number;
  memo: string;
  /** Anchor date — pass the thread's timestamp so the value is stable across renders */
  issuedAt: string;
  windowDays?: number;
}): PaymentLink {
  const reference = `HP-${token(`${input.threadId}:${input.amountCents}`).toUpperCase()}`;
  const expires = new Date(input.issuedAt);
  expires.setDate(expires.getDate() + (input.windowDays ?? DEFAULT_WINDOW_DAYS));

  return {
    url: `${PAY_HOST}/${token(input.threadId)}/${input.amountCents}`,
    reference,
    amountCents: input.amountCents,
    memo: input.memo,
    expiresAt: expires.toISOString(),
    status: "unpaid",
  };
}
