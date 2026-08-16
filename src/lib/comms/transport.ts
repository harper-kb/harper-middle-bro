import { SERVICE_MAILBOX } from "../brand";

/**
 * The seam between Service and a real mailbox.
 *
 * Everything market-facing leaves through here, so swapping the simulated
 * transport for Gmail is one assignment at the bottom of this file rather
 * than a hunt through the app.
 */

export interface OutboundMessage {
  toName: string;
  toEmail: string | null;
  subject: string;
  body: string;
  /** Channel resolved at send time — portal tasks are logged, not mailed */
  channel: string;
  attachments: { name: string }[];
}

export interface SendResult {
  ok: boolean;
  messageId: string;
  sentAt: string;
  /** What actually happened, in operator language */
  note: string;
}

export interface Transport {
  send(msg: OutboundMessage): Promise<SendResult>;
}

const simulatedTransport: Transport = {
  async send(msg) {
    const sentAt = new Date().toISOString();
    const mailed = msg.channel === "email" && Boolean(msg.toEmail);
    return {
      ok: true,
      messageId: `sim-${Date.now().toString(36)}`,
      sentAt,
      note: mailed
        ? `Sent from ${SERVICE_MAILBOX} to ${msg.toEmail}`
        : `Logged as a ${msg.channel} task — complete it with the market, then confirm here`,
    };
  },
};

export const transport: Transport = simulatedTransport;
