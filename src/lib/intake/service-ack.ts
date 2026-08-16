import type { IntakeEvent, Ticket } from "../types";

/**
 * The service-inbox acknowledgment: "we got it, here's your ticket number,
 * track it on the portal." Accuracy doctrine applies hard here — the summary
 * QUOTES the request back verbatim instead of paraphrasing, because a wrong
 * paraphrase in a client-facing email is worse than no summary at all.
 * Deterministic: same event + ticket always renders the same body.
 */

const CHANNEL_NOUN: Record<IntakeEvent["channel"], string> = {
  email: "email",
  text: "text message",
  call: "call",
};

function firstName(fromName: string): string {
  const first = fromName.trim().split(/\s+/)[0];
  return first && first !== "Unknown" ? first : "there";
}

/** Verbatim excerpt — whole body if short, cleanly cut at a word otherwise. */
export function verbatimExcerpt(body: string, max = 280): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export function buildServiceAck(input: {
  event: IntakeEvent;
  ticket: Pick<Ticket, "id" | "srNumber">;
}): { subject: string; body: string } {
  const { event, ticket } = input;
  const quoted = [
    ...(event.subject ? [`> ${event.subject}`] : []),
    `> ${verbatimExcerpt(event.body)}`,
  ].join("\n");

  const subject = `We Got It — ${ticket.srNumber} Opened${event.subject ? ` (Re: ${event.subject})` : ""}`;

  const body = [
    `Hi ${firstName(event.fromName)},`,
    "",
    `We received your ${CHANNEL_NOUN[event.channel]} — here is your request exactly as it reached us:`,
    "",
    quoted,
    "",
    `We opened service request ${ticket.srNumber} and it's with the desk now. Track it any time on the portal: /tickets/${ticket.id}`,
    "",
    "If anything above reads wrong, reply here and an operator will pick it up directly.",
    "",
    "— Harper Service Desk",
  ].join("\n");

  return { subject, body };
}
