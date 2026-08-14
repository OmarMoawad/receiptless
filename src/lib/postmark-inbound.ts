import { z } from "zod";
import { htmlToText } from "./html-to-text";
import type { InboundEmail } from "./inbound-email";

const MAX_BODY_LENGTH = 50_000;

const postmarkInboundSchema = z.object({
  MessageID: z.string().min(1).max(512),
  MailboxHash: z.string().min(1).max(256),
  From: z.string().min(1).max(512),
  Subject: z.string().max(2_000).nullish(),
  TextBody: z.string().optional().default(""),
  HtmlBody: z.string().optional().default(""),
  Date: z.string().max(200).nullish(),
});

/**
 * The Date header is sender-controlled, so it is bounded the same way the
 * body is: unparseable values become null (the caller falls back to its
 * own clock) rather than propagating an Invalid Date into a receipt.
 */
function parseHeaderDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizePostmarkInbound(input: unknown): InboundEmail {
  const parsed = postmarkInboundSchema.parse(input);
  const text = (parsed.TextBody.trim() ? parsed.TextBody : htmlToText(parsed.HtmlBody)).slice(0, MAX_BODY_LENGTH);
  return {
    provider: "postmark",
    providerMessageId: parsed.MessageID,
    mailboxToken: parsed.MailboxHash,
    from: parsed.From,
    subject: parsed.Subject ?? null,
    text,
    receivedAt: parseHeaderDate(parsed.Date),
  };
}
